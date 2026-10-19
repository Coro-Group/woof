import { supabase } from "@/integrations/supabase/client";
import { invoiceDisplayTotals } from "@/lib/vatConfig";
import {
  canVoidInvoiceStatus,
  paidAmountForVoid,
  roundVoidAed,
  unpaidRemainderForVoid,
} from "@/lib/voidInvoiceMath";

export {
  canVoidInvoiceStatus,
  formatVoidAed,
  paidAmountForVoid,
  roundVoidAed,
  unpaidRemainderForVoid,
  voidInvoicePreviewText,
  voidInvoiceRefusal,
} from "@/lib/voidInvoiceMath";

export type InvoiceVoidPreview = {
  id: string;
  ownerId: string;
  invoiceNumber: string | null;
  status: string;
  gross: number;
  paid: number;
  unpaid: number;
  canVoid: boolean;
};

export async function loadInvoiceVoidPreview(invoiceId: string): Promise<InvoiceVoidPreview> {
  const [invoiceRes, paymentsRes] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, owner_id, invoice_number, status, total, amount_paid, vat_aed, service_type, notes")
      .eq("id", invoiceId)
      .single(),
    supabase.from("invoice_payments").select("amount").eq("invoice_id", invoiceId),
  ]);
  if (invoiceRes.error) throw invoiceRes.error;
  if (paymentsRes.error) throw paymentsRes.error;

  const invoice = invoiceRes.data;
  const gross = roundVoidAed(
    invoiceDisplayTotals({
      total: invoice.total,
      vat_aed: invoice.vat_aed,
      service_type: invoice.service_type,
      notes: invoice.notes,
    }).grandTotal,
  );
  const paid = paidAmountForVoid(
    (paymentsRes.data ?? []).map((row) => Number(row.amount)),
    Number(invoice.amount_paid ?? 0),
  );

  return {
    id: invoice.id,
    ownerId: invoice.owner_id,
    invoiceNumber: invoice.invoice_number,
    status: invoice.status,
    gross,
    paid,
    unpaid: unpaidRemainderForVoid(gross, paid),
    canVoid: canVoidInvoiceStatus(invoice.status),
  };
}

/** Credits whatever was paid back to the wallet and marks the invoice voided. */
export async function voidInvoice(input: {
  invoiceId: string;
  reason: string;
  staff: string;
}): Promise<number> {
  const reason = input.reason.trim();
  const staff = input.staff.trim();
  if (!reason) throw new Error("A void reason is required.");
  if (!staff) throw new Error("Staff name is required.");

  const { data, error } = await supabase.rpc("void_invoice", {
    p_invoice: input.invoiceId,
    p_reason: reason,
    p_staff: staff,
  });
  if (error) throw error;
  return roundVoidAed(Number(data ?? 0));
}
