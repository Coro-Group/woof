import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { deriveInvoiceStatusAfterRecalc } from "@/lib/boardingInvoiceLineUtils";
import { isInactiveInvoiceStatus } from "@/lib/invoiceStatus";
import { amountPaidFromPaymentRows } from "@/lib/amountPaidFromPayments";
import { roundAed } from "@/lib/money";
import { invoiceDisplayTotals, vatAmountFromGrossInclusive } from "@/lib/vatConfig";

export { amountPaidFromPaymentRows } from "@/lib/amountPaidFromPayments";

type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
type LineRow = Database["public"]["Tables"]["invoice_line_items"]["Row"];
type AdjustmentRow = Database["public"]["Tables"]["billing_adjustments"]["Row"];

const DISCOUNT_ADJUSTMENT_TYPES = new Set([
  "discount_override",
  "double_occupancy_discount",
  "fee_waived",
  "goodwill_credit",
  "adjustment",
]);

function isDiscountAdjustment(type: string): boolean {
  return DISCOUNT_ADJUSTMENT_TYPES.has(type);
}

export function isDiscountAdjustmentType(type: string): boolean {
  return isDiscountAdjustment(type);
}

export function canEditInvoiceLineItems(status: string): boolean {
  return !isInactiveInvoiceStatus(status) && status !== "paid";
}

export function canDeleteInvoiceLineItems(status: string): boolean {
  return status === "draft";
}

export function canDeleteInvoiceAdjustments(status: string): boolean {
  return !isInactiveInvoiceStatus(status) && status !== "paid";
}

/** Shared by invoiceRecalc + boardingInvoiceSync. */
export async function resolveInvoiceAmountPaid(
  invoice: Pick<InvoiceRow, "id" | "amount_paid">,
  client: SupabaseClient<Database> = supabase,
): Promise<number> {
  const { data, error } = await client
    .from("invoice_payments")
    .select("amount")
    .eq("invoice_id", invoice.id);
  if (error) throw error;
  return amountPaidFromPaymentRows(
    invoice.amount_paid,
    (data ?? []).map((r) => Number(r.amount) || 0),
  );
}

function totalsFromLines(
  lines: Pick<LineRow, "quantity" | "unit_price">[],
  discountAmount: number,
): { subtotal: number; grossTotal: number; vatAed: number } {
  const subtotal = lines.reduce(
    (s, li) => s + li.unit_price * Math.max(1, li.quantity),
    0,
  );
  const grossTotal = Math.max(0, roundAed(subtotal - discountAmount));
  const vatAed = vatAmountFromGrossInclusive(grossTotal);
  return { subtotal: roundAed(subtotal), grossTotal, vatAed };
}

/** Recompute invoice header totals from line items; preserves discount_amount. */
export async function recalculateInvoiceTotals(
  invoiceId: string,
  client: SupabaseClient<Database> = supabase,
): Promise<void> {
  const { data: invoice, error: invErr } = await client
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (invErr) throw invErr;

  const { data: lines, error: linesErr } = await client
    .from("invoice_line_items")
    .select("quantity, unit_price")
    .eq("invoice_id", invoiceId);
  if (linesErr) throw linesErr;

  const discountAmount = roundAed(invoice.discount_amount ?? 0);
  const { subtotal, grossTotal, vatAed } = totalsFromLines(lines ?? [], discountAmount);
  const amountPaid = await resolveInvoiceAmountPaid(invoice, client);
  const { grandTotal } = invoiceDisplayTotals({
    total: grossTotal,
    vat_aed: vatAed,
  });
  const status = deriveInvoiceStatusAfterRecalc(invoice.status, amountPaid, grandTotal);

  const updatePayload: Database["public"]["Tables"]["invoices"]["Update"] = {
    subtotal,
    total: grossTotal,
    vat_aed: vatAed,
    status: status as Database["public"]["Enums"]["invoice_status"],
    amount_paid: amountPaid,
    updated_at: new Date().toISOString(),
  };

  if (status === "paid" && !invoice.paid_at) {
    updatePayload.paid_at = new Date().toISOString();
  }
  if (status !== "paid") {
    updatePayload.paid_at = null;
  }

  const { error: updErr } = await client
    .from("invoices")
    .update(updatePayload)
    .eq("id", invoiceId);
  if (updErr) throw updErr;
}

function lineAmounts(lines: Pick<LineRow, "quantity" | "unit_price" | "total_price" | "line_total">[]) {
  const lineSubtotal = lines.reduce(
    (s, li) => s + li.unit_price * Math.max(1, li.quantity),
    0,
  );
  const lineTotal = lines.reduce(
    (s, li) => s + (li.total_price ?? li.line_total ?? li.unit_price * Math.max(1, li.quantity)),
    0,
  );
  return {
    lineSubtotal: roundAed(lineSubtotal),
    lineDiscount: roundAed(Math.max(0, lineSubtotal - lineTotal)),
  };
}

function adjustmentDiscountTotal(adjustments: Pick<AdjustmentRow, "adjustment_type" | "adjusted_amount">[]) {
  return roundAed(
    adjustments
      .filter((row) => isDiscountAdjustment(row.adjustment_type))
      .reduce((sum, row) => sum + Math.abs(Number(row.adjusted_amount) || 0), 0),
  );
}

/** Sum discount adjustments, optionally excluding types recomputed elsewhere (e.g. double occupancy RPC). */
export function invoiceAdjustmentDiscountTotal(
  adjustments: Pick<AdjustmentRow, "adjustment_type" | "adjusted_amount">[],
  options?: { excludeTypes?: string[] },
): number {
  const exclude = new Set(options?.excludeTypes ?? []);
  return roundAed(
    adjustments
      .filter(
        (row) => isDiscountAdjustment(row.adjustment_type) && !exclude.has(row.adjustment_type),
      )
      .reduce((sum, row) => sum + Math.abs(Number(row.adjusted_amount) || 0), 0),
  );
}

/** Recompute invoice discount_amount from line-item discounts plus billing adjustments. */
export async function syncInvoiceDiscountTotals(invoiceId: string): Promise<void> {
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (invErr) throw invErr;

  const [{ data: lines, error: linesErr }, { data: adjustments, error: adjErr }] =
    await Promise.all([
      supabase
        .from("invoice_line_items")
        .select("quantity, unit_price, total_price, line_total")
        .eq("invoice_id", invoiceId),
      supabase
        .from("billing_adjustments")
        .select("adjustment_type, adjusted_amount")
        .eq("invoice_id", invoiceId),
    ]);
  if (linesErr) throw linesErr;
  if (adjErr) throw adjErr;

  const { lineSubtotal, lineDiscount } = lineAmounts(lines ?? []);
  const discountAmount = roundAed(lineDiscount + adjustmentDiscountTotal(adjustments ?? []));
  const grossTotal = Math.max(0, roundAed(lineSubtotal - discountAmount));
  const vatAed = vatAmountFromGrossInclusive(grossTotal);
  const amountPaid = await resolveInvoiceAmountPaid(invoice);
  const { grandTotal } = invoiceDisplayTotals({ total: grossTotal, vat_aed: vatAed });
  const status = deriveInvoiceStatusAfterRecalc(invoice.status, amountPaid, grandTotal);

  const { error: updErr } = await supabase
    .from("invoices")
    .update({
      subtotal: lineSubtotal,
      discount_amount: discountAmount,
      discount_pct: lineSubtotal > 0 ? roundAed((discountAmount / lineSubtotal) * 100) : 0,
      total: grossTotal,
      vat_aed: vatAed,
      status: status as Database["public"]["Enums"]["invoice_status"],
      amount_paid: amountPaid,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);
  if (updErr) throw updErr;
}

/** After adding a discount adjustment, sync invoice header totals. */
export async function applyInvoiceDiscountAdjustment(
  invoiceId: string,
  addedAmount: number,
): Promise<void> {
  const amount = roundAed(Math.abs(addedAmount));
  if (!amount) return;

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (invErr) throw invErr;

  const [{ data: lines, error: linesErr }, { data: adjustments, error: adjErr }] =
    await Promise.all([
      supabase
        .from("invoice_line_items")
        .select("quantity, unit_price, total_price, line_total")
        .eq("invoice_id", invoiceId),
      supabase
        .from("billing_adjustments")
        .select("adjustment_type, adjusted_amount")
        .eq("invoice_id", invoiceId),
    ]);
  if (linesErr) throw linesErr;
  if (adjErr) throw adjErr;

  const { lineSubtotal, lineDiscount } = lineAmounts(lines ?? []);
  const adjustmentDiscount = adjustmentDiscountTotal(adjustments ?? []);
  const storedDiscount = roundAed(invoice.discount_amount ?? 0);
  const discountAmount =
    storedDiscount >= adjustmentDiscount
      ? roundAed(storedDiscount + amount)
      : roundAed(lineDiscount + adjustmentDiscount);
  const grossTotal = Math.max(0, roundAed(lineSubtotal - discountAmount));
  const vatAed = vatAmountFromGrossInclusive(grossTotal);
  const amountPaid = await resolveInvoiceAmountPaid(invoice);
  const { grandTotal } = invoiceDisplayTotals({ total: grossTotal, vat_aed: vatAed });
  const status = deriveInvoiceStatusAfterRecalc(invoice.status, amountPaid, grandTotal);

  const { error: updErr } = await supabase
    .from("invoices")
    .update({
      subtotal: lineSubtotal,
      discount_amount: discountAmount,
      discount_pct: lineSubtotal > 0 ? roundAed((discountAmount / lineSubtotal) * 100) : 0,
      total: grossTotal,
      vat_aed: vatAed,
      status: status as Database["public"]["Enums"]["invoice_status"],
      amount_paid: amountPaid,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);
  if (updErr) throw updErr;
}
