import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { deriveInvoiceStatusAfterRecalc } from "@/lib/boardingInvoiceLineUtils";
import { roundAed } from "@/lib/money";
import { invoiceAmountDue } from "@/lib/vatConfig";
import {
  invoicePaymentMethodToTransactionType,
  type ExternalPaymentMethod,
  type PaymentMethod,
} from "@/lib/paymentMethod";
import { recordPayment } from "@/services/invoiceService";

/**
 * How recently a same-amount payment on the same invoice counts as a likely
 * duplicate. Staff retries / double-clicks happen within minutes; legitimate
 * second payments are rare and confirmed with an override.
 */
export const DUPLICATE_PAYMENT_WINDOW_MINUTES = 10;

/** DB hard-reject window (must match trg_reject_short_window_duplicate_invoice_payment). */
export const DUPLICATE_PAYMENT_HARD_REJECT_SECONDS = 5;

export const DUPLICATE_PAYMENT_REJECTED_MARKER = "DUPLICATE_PAYMENT_REJECTED";

export function isDuplicatePaymentRejectedError(message?: string | null): boolean {
  return !!message && message.includes(DUPLICATE_PAYMENT_REJECTED_MARKER);
}

export type DuplicatePaymentInfo = {
  paymentId: string;
  amount: number;
  method: PaymentMethod;
  recordedBy: string | null;
  createdAt: string;
};

export type RecordExternalPaymentResult = {
  success: boolean;
  error?: string;
  ownerId?: string;
  amountRecorded?: number;
  newAmountPaid?: number;
  partial?: boolean;
  /** Set when a recent same-amount payment exists and the caller did not confirm. */
  duplicate?: DuplicatePaymentInfo;
};

/**
 * Look for a recent payment of the same amount already recorded on this invoice.
 * Used to warn staff before recording what is likely the same payment twice.
 * Alert-only: callers decide whether to proceed with an override.
 */
export async function findRecentDuplicateExternalPayment(
  supabase: SupabaseClient<Database>,
  params: {
    invoiceId: string;
    amountAed: number;
    method?: PaymentMethod;
    windowMinutes?: number;
  },
): Promise<DuplicatePaymentInfo | null> {
  const amount = roundAed(params.amountAed);
  const windowMinutes = params.windowMinutes ?? DUPLICATE_PAYMENT_WINDOW_MINUTES;
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  let query = supabase
    .from("invoice_payments")
    .select("id, amount, payment_method, recorded_by, created_at")
    .eq("invoice_id", params.invoiceId)
    .eq("amount", amount)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);

  if (params.method) {
    query = query.eq("payment_method", params.method);
  }

  const { data, error } = await query;

  if (error || !data || data.length === 0) return null;
  const row = data[0];
  return {
    paymentId: row.id,
    amount: row.amount,
    method: row.payment_method,
    recordedBy: row.recorded_by,
    createdAt: row.created_at,
  };
}

export async function recordExternalInvoicePayment(
  supabase: SupabaseClient<Database>,
  params: {
    invoiceId: string;
    method: ExternalPaymentMethod;
    performedBy: string;
    amountAed?: number;
    note?: string;
    /** Skip the recent-duplicate guard (staff explicitly confirmed). */
    confirmDuplicate?: boolean;
  },
): Promise<RecordExternalPaymentResult> {
  const { invoiceId, method, performedBy, note } = params;

  const { data: invoice, error: invoiceErr } = await supabase
    .from("invoices")
    .select(
      "id, owner_id, total, vat_aed, service_type, notes, amount_paid, status",
    )
    .eq("id", invoiceId)
    .single();
  if (invoiceErr) return { success: false, error: invoiceErr.message };

  const grandTotal = invoiceAmountDue({
    total: invoice.total,
    vat_aed: invoice.vat_aed,
    service_type: invoice.service_type,
    notes: invoice.notes,
  });

  const alreadyPaid = roundAed(Math.max(0, invoice.amount_paid ?? 0));
  const outstanding = roundAed(Math.max(0, grandTotal - alreadyPaid));
  if (outstanding <= 0) {
    return { success: false, error: "Invoice has no outstanding balance." };
  }

  const requested = params.amountAed ?? outstanding;
  const amount = roundAed(Math.min(Math.max(0, requested), outstanding));
  if (amount <= 0) {
    return { success: false, error: "Payment amount must be greater than zero." };
  }

  // Alert-only duplicate guard: warn (don't block) when an identical payment was
  // recorded on this invoice moments ago. Bypassed once staff confirm.
  if (!params.confirmDuplicate) {
    const duplicate = await findRecentDuplicateExternalPayment(supabase, {
      invoiceId,
      amountAed: amount,
      method,
    });
    if (duplicate) {
      return { success: false, ownerId: invoice.owner_id, duplicate };
    }
  }

  const { data: owner, error: ownerErr } = await supabase
    .from("owners")
    .select("wallet_balance")
    .eq("id", invoice.owner_id)
    .single();
  if (ownerErr) return { success: false, error: ownerErr.message };

  const txType = invoicePaymentMethodToTransactionType(method);
  const newAmountPaid = roundAed(alreadyPaid + amount);
  const partial = newAmountPaid < grandTotal;
  const newStatus = deriveInvoiceStatusAfterRecalc(invoice.status, newAmountPaid, grandTotal);

  // Write invoice_payments first (DB short-window reject + advisory lock). If a
  // concurrent double-click loses the race, we fail before the legacy audit row.
  const dual = await recordPayment({
    invoiceId: invoice.id,
    amount: roundAed(amount),
    method,
    recordedBy: performedBy.trim() || "system",
    notes: note?.trim() || undefined,
    skipWalletDeduction: true,
    confirmDuplicate: params.confirmDuplicate,
    client: supabase,
  });
  if (!dual.success) {
    const err = dual.error || "Could not record payment.";
    if (isDuplicatePaymentRejectedError(err)) {
      return {
        success: false,
        ownerId: invoice.owner_id,
        error:
          "A matching payment was just recorded on this invoice. Refresh to confirm before trying again.",
      };
    }
    return { success: false, ownerId: invoice.owner_id, error: err };
  }

  const { error: txErr } = await supabase.from("wallet_transactions").insert({
    owner_id: invoice.owner_id,
    invoice_id: invoice.id,
    transaction_type: txType,
    amount,
    balance_after: owner.wallet_balance ?? 0,
    payment_method: method,
    performed_by: performedBy.trim(),
    notes: note?.trim() || (partial ? `Partial invoice payment by ${method}` : `Invoice paid by ${method}`),
  });
  if (txErr) {
    return {
      success: false,
      ownerId: invoice.owner_id,
      error: `Payment recorded but audit log failed: ${txErr.message}`,
    };
  }

  // amount_paid / status / paid_at are owned by the
  // trg_update_invoice_status_on_payment trigger (fires on the invoice_payments
  // insert above). We still set status/paid_at/payment_method here as a
  // best-effort sync of payment_method on the invoice header.
  const { error: payErr } = await supabase
    .from("invoices")
    .update({
      status: newStatus as Database["public"]["Enums"]["invoice_status"],
      // TODO: deprecate after invoice_payments migration
      payment_method: method,
      paid_at: partial ? null : new Date().toISOString(),
    })
    .eq("id", invoice.id);

  if (payErr) {
    return {
      success: false,
      ownerId: invoice.owner_id,
      error: `Payment recorded but invoice update failed: ${payErr.message}`,
    };
  }

  return {
    success: true,
    ownerId: invoice.owner_id,
    amountRecorded: amount,
    newAmountPaid,
    partial,
  };
}
