import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { invoiceAdjustmentDiscountTotal } from "@/lib/invoiceRecalc";
import { combinedInvoiceDiscount, invoiceWalletBalanceDue, invoiceWalletChargeTotal, roundWalletChargeAed } from "@/lib/invoiceWalletCharge";

type ChargeClient = SupabaseClient<Database>;

/** Remaining wallet charge: invoice total after discount, minus amount already paid. */
export async function loadInvoiceWalletBalanceDue(
  supabase: ChargeClient,
  invoiceId: string,
): Promise<{
  balanceDue: number;
  ownerId: string;
  chargeTotal: number;
  storedTotal: number;
  amountPaid: number;
}> {
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, owner_id, total, subtotal, discount_amount, amount_paid")
    .eq("id", invoiceId)
    .single();
  if (error) throw error;

  const { data: adjustments, error: adjErr } = await supabase
    .from("billing_adjustments")
    .select("adjustment_type, adjusted_amount")
    .eq("invoice_id", invoiceId);
  if (adjErr) throw adjErr;

  const discountAmount = combinedInvoiceDiscount(
    invoice.discount_amount ?? 0,
    invoiceAdjustmentDiscountTotal(adjustments ?? []),
  );
  const chargeTotal = invoiceWalletChargeTotal({
    total: invoice.total ?? 0,
    subtotal: invoice.subtotal ?? 0,
    discountAmount,
  });
  return {
    ownerId: invoice.owner_id,
    chargeTotal,
    storedTotal: roundWalletChargeAed(invoice.total ?? 0),
    amountPaid: roundWalletChargeAed(invoice.amount_paid ?? 0),
    balanceDue: invoiceWalletBalanceDue({
      total: invoice.total ?? 0,
      subtotal: invoice.subtotal ?? 0,
      discountAmount,
      amountPaid: invoice.amount_paid ?? 0,
    }),
  };
}
