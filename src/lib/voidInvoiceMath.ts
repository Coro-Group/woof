import { isInactiveInvoiceStatus } from "@/lib/invoiceStatus";

/** Matches void_invoice's ROUND(..., 2). */
export function roundVoidAed(amount: number): number {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

export function formatVoidAed(amount: number): string {
  return `AED ${roundVoidAed(amount).toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Amount void_invoice will credit: sum of invoice_payments when any rows
 * exist, otherwise amount_paid.
 */
export function paidAmountForVoid(paymentAmounts: number[], amountPaid: number): number {
  if (paymentAmounts.length > 0) {
    return roundVoidAed(paymentAmounts.reduce((sum, amount) => sum + Number(amount), 0));
  }
  return roundVoidAed(Math.max(0, Number(amountPaid) || 0));
}

export function unpaidRemainderForVoid(grossTotal: number, paid: number): number {
  return roundVoidAed(Math.max(0, grossTotal - paid));
}

export function voidInvoicePreviewText(paid: number, unpaid: number): string {
  return `Paid ${formatVoidAed(paid)} will be returned to the wallet as credit. Unpaid ${formatVoidAed(unpaid)} will be cancelled.`;
}

export function canVoidInvoiceStatus(status: string): boolean {
  return !isInactiveInvoiceStatus(status);
}

export function voidInvoiceRefusal(status: string): string | null {
  if (status === "voided") return "This invoice is already voided.";
  if (status === "cancelled") return "This invoice is cancelled and cannot be voided.";
  if (status === "consolidated") {
    return "This invoice was consolidated into another invoice and cannot be voided.";
  }
  return null;
}
