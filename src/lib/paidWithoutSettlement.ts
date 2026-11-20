import { roundAed } from "@/lib/money";

/** Marker embedded in SOA ledger notes for paid invoices lacking settlement rows. */
export const PAID_WITHOUT_SETTLEMENT_NOTE =
  "PAID_WITHOUT_SETTLEMENT — status=paid but amount_paid=0; confirm before backfilling amount_paid";

/**
 * Legacy import (phase 4b daycare packages) set status='paid' from tracker
 * amount_paid_aed without writing invoices.amount_paid or invoice_payments.
 * Those invoices still debit the SOA ledger with no matching credit.
 */
export function isPaidWithoutSettlement(params: {
  status: string;
  amountPaid?: number | null;
  grossTotal: number;
  hasPaymentRows: boolean;
}): boolean {
  if (params.status !== "paid") return false;
  if (params.hasPaymentRows) return false;
  if (roundAed(params.amountPaid ?? 0) > 0) return false;
  return roundAed(params.grossTotal) > 0;
}
