import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { LedgerStatementRow } from "@/hooks/useStatement";
import { isSoaInvoiceStatus } from "@/lib/invoiceStatus";
import { invoicePaymentMethodToTransactionType } from "@/lib/paymentMethod";
import { roundAed } from "@/lib/money";
import { invoiceDisplayTotals } from "@/lib/vatConfig";
import {
  orphanWalletDeductions,
  syntheticWalletPaymentsFromDeductions,
} from "@/lib/walletDeductionPayments";
import {
  isPaidWithoutSettlement,
  PAID_WITHOUT_SETTLEMENT_NOTE,
} from "@/lib/paidWithoutSettlement";

type Client = SupabaseClient<Database>;

const STANDALONE_WALLET_TYPES = new Set([
  "top_up",
  "manual_topup",
  "refund",
  "adjustment",
  "membership_fee",
]);

type RawEvent = {
  row_id: string;
  event_at: string;
  sort_seq: number;
  amount: number;
  is_visible: boolean;
  transaction_type: string;
  invoice_id: string | null;
  invoice_number: string | null;
  service_type: string | null;
  due_date: string | null;
  payment_method: string | null;
  notes: string | null;
};

function invoiceGross(invoice: {
  total: number;
  vat_aed: number | null;
  service_type: string | null;
  notes: string | null;
}): number {
  return invoiceDisplayTotals({
    total: invoice.total,
    vat_aed: invoice.vat_aed,
    service_type: invoice.service_type,
    notes: invoice.notes,
  }).grandTotal;
}

/** Client-side reconstruction when get_ledger_statement RPC is unavailable. */
export async function loadLedgerStatementClient(
  supabase: Client,
  ownerId: string,
  fromIso: string,
  toIso: string,
): Promise<LedgerStatementRow[]> {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();

  const [invoicesRes, paymentsRes, walletRes] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, invoice_number, status, total, vat_aed, service_type, notes, created_at, issue_date, became_outstanding_at, due_date, amount_paid, paid_at, updated_at, payment_method, receipt_only",
      )
      .eq("owner_id", ownerId)
      .or("receipt_only.is.null,receipt_only.eq.false"),
    supabase
      .from("invoice_payments")
      .select(
        "id, invoice_id, owner_id, amount, created_at, payment_method, notes, wallet_transaction_id",
      )
      .eq("owner_id", ownerId),
    supabase
      .from("wallet_transactions")
      .select(
        "id, owner_id, amount, created_at, transaction_type, invoice_id, payment_method, notes, service_type",
      )
      .eq("owner_id", ownerId),
  ]);

  if (invoicesRes.error) throw invoicesRes.error;
  if (paymentsRes.error) throw paymentsRes.error;
  if (walletRes.error) throw walletRes.error;

  const invoices = invoicesRes.data ?? [];
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const paymentRows = paymentsRes.data ?? [];
  const walletDeductions = (walletRes.data ?? []).filter(
    (wt) => wt.invoice_id != null && wt.transaction_type === "deduction",
  );
  const orphanDeductions = orphanWalletDeductions(paymentRows, walletDeductions);
  const syntheticPayments = syntheticWalletPaymentsFromDeductions(orphanDeductions);
  const allPayments = [...paymentRows, ...syntheticPayments];
  const invoicesWithPayments = new Set(allPayments.map((p) => p.invoice_id));

  const events: RawEvent[] = [];

  for (const i of invoices) {
    if (!isSoaInvoiceStatus(i.status)) continue;
    const gross = roundAed(invoiceGross(i));
    if (gross <= 0) continue;
    const eventAt = i.issue_date
      ? `${i.issue_date}T00:00:00.000Z`
      : (i.became_outstanding_at ?? i.created_at);
    events.push({
      row_id: `inv:${i.id}`,
      event_at: eventAt,
      sort_seq: 1,
      amount: -gross,
      is_visible: true,
      transaction_type: "invoice",
      invoice_id: i.id,
      invoice_number: i.invoice_number,
      service_type: i.service_type,
      due_date: i.due_date,
      payment_method: null,
      notes: i.notes ?? "",
    });
  }

  for (const p of allPayments) {
    const inv = invoiceById.get(p.invoice_id);
    if (!inv || inv.receipt_only) continue;
    // Pair with invoice debits: exclude payments on voided/consolidated/cancelled/draft
    if (!isSoaInvoiceStatus(inv.status)) continue;
    const isWallet = p.payment_method === "wallet";
    events.push({
      row_id: `pay:${p.id}`,
      event_at: p.created_at,
      sort_seq: 2,
      amount: roundAed(p.amount),
      is_visible: !isWallet,
      transaction_type: isWallet
        ? "wallet_payment"
        : invoicePaymentMethodToTransactionType(p.payment_method),
      invoice_id: p.invoice_id,
      invoice_number: inv.invoice_number,
      service_type: inv.service_type,
      due_date: inv.due_date,
      payment_method: p.payment_method,
      notes: p.notes ?? "",
    });
  }

  for (const i of invoices) {
    if (!isSoaInvoiceStatus(i.status)) continue;
    if (i.receipt_only) continue;
    if (invoicesWithPayments.has(i.id)) continue;
    const paid = roundAed(Number(i.amount_paid ?? 0));
    if (paid > 0) {
      const isWallet = i.payment_method === "wallet";
      events.push({
        row_id: `legacy_pay:${i.id}`,
        event_at: i.paid_at ?? i.updated_at ?? i.created_at,
        sort_seq: 2,
        amount: paid,
        is_visible: !isWallet,
        transaction_type: isWallet
          ? "wallet_payment"
          : i.payment_method
            ? invoicePaymentMethodToTransactionType(i.payment_method)
            : "manual_topup",
        invoice_id: i.id,
        invoice_number: i.invoice_number,
        service_type: i.service_type,
        due_date: i.due_date,
        payment_method: i.payment_method,
        notes: "Legacy settled amount",
      });
      continue;
    }

    // status=paid + amount_paid=0 + no invoice_payments (legacy import): credit
    // the gross so SOA K is not inflated. Do not invent amount_paid — flag for review.
    const gross = roundAed(invoiceGross(i));
    if (
      isPaidWithoutSettlement({
        status: i.status,
        amountPaid: i.amount_paid,
        grossTotal: gross,
        hasPaymentRows: false,
      })
    ) {
      events.push({
        row_id: `paid_no_settle:${i.id}`,
        event_at: i.paid_at ?? i.updated_at ?? i.created_at,
        sort_seq: 2,
        amount: gross,
        is_visible: true,
        transaction_type: "manual_topup",
        invoice_id: i.id,
        invoice_number: i.invoice_number,
        service_type: i.service_type,
        due_date: i.due_date,
        payment_method: i.payment_method,
        notes: PAID_WITHOUT_SETTLEMENT_NOTE,
      });
    }
  }

  for (const wt of walletRes.data ?? []) {
    if (wt.invoice_id != null) continue;
    if (!STANDALONE_WALLET_TYPES.has(wt.transaction_type)) continue;
    const inv = wt.invoice_id ? invoiceById.get(wt.invoice_id) : undefined;
    events.push({
      row_id: `wt:${wt.id}`,
      event_at: wt.created_at,
      sort_seq: 3,
      amount: roundAed(wt.amount),
      is_visible: true,
      transaction_type: wt.transaction_type,
      invoice_id: wt.invoice_id,
      invoice_number: inv?.invoice_number ?? null,
      service_type: wt.service_type ?? inv?.service_type ?? null,
      due_date: inv?.due_date ?? null,
      payment_method: wt.payment_method,
      notes: wt.notes ?? "",
    });
  }

  events.sort((a, b) => {
    const t = a.event_at.localeCompare(b.event_at);
    if (t !== 0) return t;
    if (a.sort_seq !== b.sort_seq) return a.sort_seq - b.sort_seq;
    return a.row_id.localeCompare(b.row_id);
  });

  // Visible events only: wallet top-ups are credited when received, so
  // wallet-paid invoices must not credit the same money a second time.
  let running = 0;
  const withBalance = events
    .filter((e) => e.is_visible)
    .map((e) => {
      running = roundAed(running + e.amount);
      return { ...e, balance_after: running };
    });

  const openingK = (() => {
    const before = withBalance.filter((e) => new Date(e.event_at).getTime() < fromMs);
    return before.length > 0 ? before[before.length - 1].balance_after : 0;
  })();

  const windowRows = withBalance.filter((e) => {
    const ms = new Date(e.event_at).getTime();
    return ms >= fromMs && ms <= toMs;
  });

  const rows: LedgerStatementRow[] = [];

  if (openingK !== 0 || windowRows.length > 0) {
    rows.push({
      row_id: "opening",
      created_at: fromIso,
      amount: 0,
      balance_after: openingK,
      is_opening_balance: true,
      is_visible: true,
      transaction_type: "opening_balance",
      invoice_id: null,
      invoice_number: null,
      service_type: null,
      due_date: null,
      payment_method: null,
      notes: "Opening balance",
    });
  }

  for (const e of windowRows) {
    rows.push({
      row_id: e.row_id,
      created_at: e.event_at,
      amount: e.amount,
      balance_after: e.balance_after,
      is_opening_balance: false,
      is_visible: e.is_visible,
      transaction_type: e.transaction_type,
      invoice_id: e.invoice_id,
      invoice_number: e.invoice_number,
      service_type: e.service_type,
      due_date: e.due_date,
      payment_method: e.payment_method,
      notes: e.notes,
    });
  }

  return rows;
}
