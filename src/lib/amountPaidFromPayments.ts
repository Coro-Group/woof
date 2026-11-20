import { roundAed } from "@/lib/money";

/**
 * Derive amount_paid from invoice_payments when rows exist; otherwise keep the
 * stored legacy value. Never uses wallet_transactions (audit-only).
 */
export function amountPaidFromPaymentRows(
  storedAmountPaid: number | null | undefined,
  paymentAmounts: readonly number[],
): number {
  if (paymentAmounts.length > 0) {
    return roundAed(paymentAmounts.reduce((sum, a) => sum + (Number(a) || 0), 0));
  }
  return roundAed(storedAmountPaid ?? 0);
}
