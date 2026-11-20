import { supabase as defaultClient } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isInactiveInvoiceStatus } from "@/lib/invoiceStatus";
import { roundAed } from "@/lib/money";
import { loadInvoiceWalletBalanceDue } from "@/lib/invoiceWalletBalance";
import { invoiceAmountDue } from "@/lib/vatConfig";
import { type PaymentMethod } from "@/lib/paymentMethod";
import {
  orphanWalletDeductions,
  syntheticWalletPaymentsFromDeductions,
} from "@/lib/walletDeductionPayments";

type Client = SupabaseClient<Database>;
type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];
type LineRow = Database["public"]["Tables"]["invoice_line_items"]["Row"];
type PaymentRow = Database["public"]["Tables"]["invoice_payments"]["Row"];
type AmendmentRow = Database["public"]["Tables"]["invoice_amendments"]["Row"];
type TopupReceiptRow = Database["public"]["Tables"]["wallet_topup_receipts"]["Row"];

/**
 * Service / trigger-moment mapping. Packages become `outstanding` the moment
 * they are sold; every other service starts life as a `draft` invoice that
 * becomes outstanding at checkout. See the locked invoicing business rules.
 */
export type InvoiceServiceType =
  | "daycare_package"
  | "grooming_package"
  | "daycare_hourly"
  | "daycare_daily"
  | "boarding"
  | "grooming";

const PACKAGE_SERVICES: ReadonlySet<InvoiceServiceType> = new Set([
  "daycare_package",
  "grooming_package",
]);

/** Initial invoice status for a given service per the locked lifecycle rules. */
export function initialInvoiceStatusForService(
  service: InvoiceServiceType,
): Extract<InvoiceStatus, "draft" | "outstanding"> {
  return PACKAGE_SERVICES.has(service) ? "outstanding" : "draft";
}

export interface CreateInvoiceParams {
  ownerId: string;
  serviceType: string;
  /** Service row id (booking_id, session id, appointment id, package id…). */
  serviceId?: string | null;
  bookingId?: string | null;
  /** Explicit status override; otherwise derived from `service`. */
  service?: InvoiceServiceType;
  status?: InvoiceStatus;
  subtotal?: number;
  total?: number;
  vatAed?: number | null;
  notes?: string | null;
  receiptOnly?: boolean;
  client?: Client;
}

export interface CreateInvoiceResult {
  success: boolean;
  error?: string;
  invoice?: InvoiceRow;
}

/**
 * Insert an invoice with the correct initial status for its service.
 * `opening_balance` is populated by the `trg_invoice_opening_balance` DB
 * trigger from the owner's wallet balance — never set it here.
 */
export async function createInvoice(
  params: CreateInvoiceParams,
): Promise<CreateInvoiceResult> {
  const supabase = params.client ?? defaultClient;

  const status: InvoiceStatus =
    params.status ??
    (params.service
      ? initialInvoiceStatusForService(params.service)
      : "draft");

  const insert: Database["public"]["Tables"]["invoices"]["Insert"] = {
    owner_id: params.ownerId,
    service_type: params.serviceType,
    service_id: params.serviceId ?? null,
    booking_id: params.bookingId ?? null,
    status,
    subtotal: params.subtotal ?? 0,
    total: params.total ?? params.subtotal ?? 0,
    vat_aed: params.vatAed ?? null,
    notes: params.notes ?? null,
    receipt_only: params.receiptOnly ?? false,
  };

  const { data, error } = await supabase
    .from("invoices")
    .insert(insert)
    .select("*")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, invoice: data as InvoiceRow };
}

export interface RecordPaymentParams {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  recordedBy: string;
  notes?: string;
  client?: Client;
  /**
   * When the wallet has already been debited by the caller (e.g. the
   * process_wallet_payment RPC, or a legacy wallet flow), skip creating the
   * wallet_transactions deduction and decrementing owner.wallet_balance here.
   * Only the invoice_payments row is written. Default false.
   */
  skipWalletDeduction?: boolean;
  /** Link an existing wallet_transactions row to the payment. Default null. */
  walletTransactionId?: string | null;
  /**
   * Staff confirmed a recent same-amount payment is intentional. Passed through
   * to insert_invoice_payment so the short-window DB guard allows the insert.
   */
  confirmDuplicate?: boolean;
}

export interface RecordPaymentResult {
  success: boolean;
  error?: string;
  paymentId?: string;
  openingBalance?: number;
  closingBalance?: number;
  walletTransactionId?: string | null;
}

/**
 * Record a single payment against an invoice in the unified `invoice_payments`
 * table. The `trg_update_invoice_status_on_payment` DB trigger then updates the
 * invoice's amount_paid / status / paid_at automatically.
 *
 * Wallet payments additionally write a `wallet_transactions` deduction and
 * decrement the owner's `wallet_balance`; the resulting transaction id is
 * linked on the payment row.
 */
export async function recordPayment(
  params: RecordPaymentParams,
): Promise<RecordPaymentResult> {
  const supabase = params.client ?? defaultClient;
  let amount = roundAed(params.amount);

  if (!(amount > 0)) {
    return { success: false, error: "Payment amount must be greater than zero." };
  }

  if (params.method === "wallet" && !params.skipWalletDeduction) {
    try {
      const { balanceDue } = await loadInvoiceWalletBalanceDue(supabase, params.invoiceId);
      amount = roundAed(Math.min(amount, balanceDue));
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Could not load invoice.",
      };
    }
    if (!(amount > 0)) {
      return { success: false, error: "This invoice has no outstanding balance." };
    }
  }

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, owner_id, status")
    .eq("id", params.invoiceId)
    .single();
  if (invErr) return { success: false, error: invErr.message };

  if (isInactiveInvoiceStatus(invoice.status)) {
    return { success: false, error: "Cannot record a payment on a closed invoice." };
  }

  const { data: owner, error: ownerErr } = await supabase
    .from("owners")
    .select("wallet_balance")
    .eq("id", invoice.owner_id)
    .single();
  if (ownerErr) return { success: false, error: ownerErr.message };

  const openingBalance = roundAed(owner.wallet_balance ?? 0);
  const closingBalance = roundAed(openingBalance - amount);
  const recordedBy = params.recordedBy.trim() || "system";

  let walletTransactionId: string | null = params.walletTransactionId ?? null;

  if (params.method === "wallet" && !params.skipWalletDeduction) {
    const { data: tx, error: txErr } = await supabase
      .from("wallet_transactions")
      .insert({
        owner_id: invoice.owner_id,
        transaction_type: "deduction",
        amount: -amount,
        balance_after: closingBalance,
        invoice_id: params.invoiceId,
        reference_type: "invoice",
        reference_id: params.invoiceId,
        payment_method: "wallet",
        performed_by: recordedBy,
        notes: params.notes?.trim() || "Invoice payment via wallet",
      })
      .select("id")
      .single();
    if (txErr) return { success: false, error: txErr.message };
    walletTransactionId = tx.id;

    const { error: balErr } = await supabase
      .from("owners")
      .update({ wallet_balance: closingBalance })
      .eq("id", invoice.owner_id);
    if (balErr) {
      return {
        success: false,
        error: `Wallet ledger written but balance update failed: ${balErr.message}`,
      };
    }
  }

  const { data: paymentId, error: payErr } = await supabase.rpc("insert_invoice_payment", {
    p_invoice_id: params.invoiceId,
    p_owner_id: invoice.owner_id,
    p_amount: amount,
    p_payment_method: params.method,
    p_opening_balance: openingBalance,
    p_closing_balance: closingBalance,
    p_recorded_by: recordedBy,
    p_notes: params.notes?.trim() || null,
    p_wallet_transaction_id: walletTransactionId,
    p_confirm_duplicate: params.confirmDuplicate ?? false,
  });

  if (payErr) return { success: false, error: payErr.message };

  return {
    success: true,
    paymentId: paymentId as string,
    openingBalance,
    closingBalance,
    walletTransactionId,
  };
}

// applyWalletThenExternal removed — use PaymentSplitDialog for wallet-first
// split payments. recordPayment handles individual legs.

export interface AmendInvoiceParams {
  invoiceId: string;
  amendedBy: string;
  fieldChanged: string;
  oldValue?: string | null;
  newValue?: string | null;
  reason: string;
  client?: Client;
}

/**
 * Log an amendment to an OUTSTANDING invoice. Throws if the 24hr amendment
 * window has closed (now() >= amendment_locked_at). DRAFT invoices are freely
 * editable and do not need to go through this path.
 */
export async function amendInvoice(
  params: AmendInvoiceParams,
): Promise<{ success: boolean; error?: string; locked?: boolean }> {
  const supabase = params.client ?? defaultClient;
  const reason = params.reason.trim();
  if (!reason) return { success: false, error: "An amendment reason is mandatory." };

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, status, amendment_locked_at")
    .eq("id", params.invoiceId)
    .single();
  if (invErr) return { success: false, error: invErr.message };

  if (invoice.status === "draft") {
    // Draft invoices are fully editable without an audit log.
    return { success: true };
  }

  if (invoice.status !== "outstanding") {
    return {
      success: false,
      error: "Only draft or outstanding invoices can be amended; void and reissue instead.",
    };
  }

  const lockedAt = invoice.amendment_locked_at
    ? new Date(invoice.amendment_locked_at).getTime()
    : null;
  if (lockedAt != null && Date.now() >= lockedAt) {
    return { success: false, locked: true, error: "Amendment window has closed." };
  }

  const { error: logErr } = await supabase.from("invoice_amendments").insert({
    invoice_id: params.invoiceId,
    amended_by: params.amendedBy.trim() || "reception",
    field_changed: params.fieldChanged,
    old_value: params.oldValue ?? null,
    new_value: params.newValue ?? null,
    reason,
  });
  if (logErr) return { success: false, error: logErr.message };
  return { success: true };
}

export interface CreateTopupReceiptParams {
  ownerId: string;
  walletTransactionId: string;
  amount: number;
  issuedBy: string;
  receiptNumber?: string;
  notes?: string;
  client?: Client;
}

/**
 * Record a wallet top-up receipt. Wallet top-ups NEVER create an invoice — this
 * is receipt-only bookkeeping for the printable receipt.
 *
 * Normal staff top-ups must use the `credit_wallet_topup` RPC (via useWallet
 * hooks), which creates the receipt atomically with the wallet transaction.
 * This helper remains for one-off admin/backfill tooling only.
 */
export async function createTopupReceipt(
  params: CreateTopupReceiptParams,
): Promise<{ success: boolean; error?: string; receipt?: TopupReceiptRow }> {
  const supabase = params.client ?? defaultClient;

  const receiptNumber = params.receiptNumber?.trim() || `RCP-${Date.now()}`;

  const { data, error } = await supabase
    .from("wallet_topup_receipts")
    .insert({
      owner_id: params.ownerId,
      wallet_transaction_id: params.walletTransactionId,
      amount: roundAed(params.amount),
      issued_by: params.issuedBy.trim() || "reception",
      receipt_number: receiptNumber,
      notes: params.notes?.trim() || null,
    })
    .select("*")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, receipt: data as TopupReceiptRow };
}

export interface InvoiceLedger {
  invoice: InvoiceRow;
  lines: LineRow[];
  payments: PaymentRow[];
  amendments: AmendmentRow[];
  openingBalance: number;
  charges: number;
  totalPaid: number;
  /** opening_balance - charges + payments. Positive = owner in credit. */
  closingBalance: number;
}

/**
 * Aggregate everything needed for the invoice ledger view: line items, unified
 * payments, the opening balance snapshot, amendment history, and the computed
 * closing balance (opening - charges + payments).
 */
export async function getInvoiceLedger(
  invoiceId: string,
  client?: Client,
): Promise<InvoiceLedger | null> {
  const supabase = client ?? defaultClient;

  const [invoiceRes, linesRes, paymentsRes, amendmentsRes, walletDeductionsRes] =
    await Promise.all([
    supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle(),
    supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("sort_order", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("invoice_amendments")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("amended_at", { ascending: false }),
    supabase
      .from("wallet_transactions")
      .select("id, invoice_id, amount, created_at, notes, payment_method, transaction_type")
      .eq("invoice_id", invoiceId)
      .eq("transaction_type", "deduction")
      .order("created_at", { ascending: true }),
  ]);

  if (invoiceRes.error) throw invoiceRes.error;
  if (linesRes.error) throw linesRes.error;
  if (paymentsRes.error) throw paymentsRes.error;
  if (amendmentsRes.error) throw amendmentsRes.error;
  if (walletDeductionsRes.error) throw walletDeductionsRes.error;

  const invoice = invoiceRes.data as InvoiceRow | null;
  if (!invoice) return null;

  const lines = (linesRes.data ?? []) as LineRow[];
  const basePayments = (paymentsRes.data ?? []) as PaymentRow[];
  const orphanDeductions = orphanWalletDeductions(
    basePayments,
    walletDeductionsRes.data ?? [],
  );
  const syntheticPayments = syntheticWalletPaymentsFromDeductions(
    orphanDeductions,
  ) as PaymentRow[];
  const payments = [...basePayments, ...syntheticPayments].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const amendments = (amendmentsRes.data ?? []) as AmendmentRow[];

  const openingBalance = roundAed(invoice.opening_balance ?? 0);
  const charges = invoiceAmountDue({
    total: invoice.total,
    vat_aed: invoice.vat_aed,
    service_type: invoice.service_type,
    notes: invoice.notes,
  });
  // Prefer the unified invoice_payments rows; fall back to the legacy
  // invoices.amount_paid when no rows exist yet (un-backfilled legacy invoices
  // and the rare best-effort dual-write miss). Avoids showing AED 0 paid / full
  // balance due on invoices that were actually paid before invoice_payments.
  const paymentsSum = roundAed(payments.reduce((sum, p) => sum + (p.amount ?? 0), 0));
  const totalPaid =
    payments.length > 0 ? paymentsSum : roundAed(invoice.amount_paid ?? 0);
  const closingBalance = roundAed(openingBalance - charges + totalPaid);

  return {
    invoice,
    lines,
    payments,
    amendments,
    openingBalance,
    charges,
    totalPaid,
    closingBalance,
  };
}