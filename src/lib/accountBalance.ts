import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { roundAed } from "@/lib/money";
import { paidAmountForVoid, unpaidRemainderForVoid } from "@/lib/voidInvoiceMath";
import { invoiceDisplayTotals } from "@/lib/vatConfig";

type Client = SupabaseClient<Database>;

/** Collectable debt only — draft/finalised are not outstanding in the Phase 2 model. */
const OUTSTANDING_INVOICE_STATUSES = [
  "outstanding",
  "overdue",
  "partially_paid",
] as const;

export interface AccountBalance {
  walletBalance: number;
  outstandingDebt: number;
  /** wallet_balance - outstanding debt. Positive = in credit, negative = owes. */
  accountBalance: number;
}

/** Open-invoice remainder: max(0, gross − paid). Voided, cancelled, and draft are not passed in. */
export function outstandingInvoiceRemainder(input: {
  total: number;
  vatAed: number | null;
  serviceType: string | null;
  notes: string | null;
  paymentAmounts: number[];
  amountPaid: number;
}): number {
  const gross = invoiceDisplayTotals({
    total: input.total,
    vat_aed: input.vatAed,
    service_type: input.serviceType,
    notes: input.notes,
  }).grandTotal;
  const paid = paidAmountForVoid(input.paymentAmounts, input.amountPaid);
  return unpaidRemainderForVoid(gross, paid);
}

/**
 * Account balance = wallet_balance - sum of outstanding invoice balances.
 * This is always computed live, never stored.
 */
export async function getAccountBalance(
  supabase: Client,
  ownerId: string,
): Promise<AccountBalance> {
  const { data: owner } = await supabase
    .from("owners")
    .select("wallet_balance")
    .eq("id", ownerId)
    .single();

  const walletBalance = roundAed(owner?.wallet_balance ?? 0);

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, total, amount_paid, vat_aed, service_type, notes")
    .eq("owner_id", ownerId)
    .in("status", [...OUTSTANDING_INVOICE_STATUSES])
    .or("receipt_only.is.null,receipt_only.eq.false");

  const invoiceIds = (invoices ?? []).map((invoice) => invoice.id);
  const paymentsByInvoice = new Map<string, number[]>();
  if (invoiceIds.length > 0) {
    const { data: payments } = await supabase
      .from("invoice_payments")
      .select("invoice_id, amount")
      .in("invoice_id", invoiceIds);
    for (const payment of payments ?? []) {
      const amounts = paymentsByInvoice.get(payment.invoice_id) ?? [];
      amounts.push(Number(payment.amount));
      paymentsByInvoice.set(payment.invoice_id, amounts);
    }
  }

  const outstandingDebt = roundAed(
    (invoices ?? []).reduce((sum, invoice) => {
      return (
        sum +
        outstandingInvoiceRemainder({
          total: invoice.total,
          vatAed: invoice.vat_aed,
          serviceType: invoice.service_type,
          notes: invoice.notes,
          paymentAmounts: paymentsByInvoice.get(invoice.id) ?? [],
          amountPaid: Number(invoice.amount_paid ?? 0),
        })
      );
    }, 0),
  );

  return {
    walletBalance,
    outstandingDebt,
    accountBalance: roundAed(walletBalance - outstandingDebt),
  };
}

export interface PaymentSplit {
  fromWallet: number;
  fromCard: number;
  totalToCollect: number;
}

/**
 * Given an account balance and a new invoice total, returns how much comes from
 * wallet (account credit) and how much must be collected by card/cash.
 */
export function calculatePaymentSplit(
  accountBalance: number,
  invoiceTotal: number,
): PaymentSplit {
  const walletAvailable = Math.max(accountBalance, 0);
  const fromWallet = roundAed(Math.min(walletAvailable, invoiceTotal));
  const fromCard = roundAed(invoiceTotal - fromWallet);

  return {
    fromWallet,
    fromCard,
    totalToCollect: roundAed(invoiceTotal),
  };
}

/** Seed editable wallet + card fields for a single-invoice payment dialog. */
export function seedInvoicePaymentSplit(walletBalance: number, invoiceTotal: number) {
  const walletSeed = roundAed(Math.min(Math.max(walletBalance, 0), invoiceTotal));
  const cardSeed = roundAed(Math.max(0, invoiceTotal - walletSeed));
  return { walletSeed, cardSeed };
}

/** Wallet charge capped by available wallet and outstanding balance. */
export function resolveWalletChargeAmount(
  requestedAed: number | undefined,
  walletBalance: number,
  balanceDue: number,
): number {
  const requested = requestedAed ?? balanceDue;
  return roundAed(Math.min(Math.max(0, requested), walletBalance, balanceDue));
}
