import type { StatementRow } from "@/hooks/useStatement";
import { getDubaiTodayDate } from "@/lib/statementDates";
import { roundAed } from "@/lib/money";

/** Boarding invoices use due_date = booking check_in_date (see invoiceDueDateAtCheckIn). */
export function isFutureBoardingInvoice(
  invoice: Pick<StatementRow, "service_type" | "due_date">,
  today: string = getDubaiTodayDate(),
): boolean {
  if (invoice.service_type !== "boarding") return false;
  const due = invoice.due_date?.slice(0, 10);
  if (!due) return false;
  return due > today;
}

/**
 * Invoices eligible for Billing-page bulk "Pay all outstanding from wallet".
 * Keeps open-invoice set from get_statement_of_account; drops future boarding stays.
 */
export function filterBulkWalletPayableInvoices(
  invoices: StatementRow[],
  today: string = getDubaiTodayDate(),
): StatementRow[] {
  return invoices.filter((inv) => !isFutureBoardingInvoice(inv, today));
}

export function bulkWalletPayableTotal(invoices: StatementRow[]): number {
  return roundAed(invoices.reduce((sum, inv) => sum + Math.max(0, inv.total), 0));
}
