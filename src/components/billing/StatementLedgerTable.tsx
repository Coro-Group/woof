import { format } from "date-fns";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAedAmount, formatWalletAed } from "@/lib/money";
import { paymentMethodLabel } from "@/lib/paymentMethod";
import type { LedgerStatementRow } from "@/hooks/useStatement";
import type { PeriodTotals } from "@/lib/ownerBalances";
import { cn } from "@/lib/utils";

const TRANSACTION_LABELS: Record<string, string> = {
  invoice: "Invoice",
  top_up: "Wallet top-up",
  manual_topup: "Payment received",
  refund: "Refund",
  deduction: "Wallet deduction",
  membership_fee: "Membership fee",
  adjustment: "Adjustment",
  card_payment: "Card payment",
  cash_payment: "Cash payment",
  bank_transfer_payment: "Bank transfer",
  payment_link_payment: "Payment link",
  opening_balance: "Opening balance",
  wallet_payment: "Wallet payment",
};

function txLabel(row: LedgerStatementRow): string {
  if (row.is_opening_balance) return "Opening balance";
  return TRANSACTION_LABELS[row.transaction_type] ?? row.transaction_type.replace(/_/g, " ");
}

function invoiceDetail(row: LedgerStatementRow): string | null {
  if (row.transaction_type !== "invoice") return null;
  const detail = row.notes?.trim();
  return detail ? detail : null;
}

function serviceLabel(type: string | null | undefined): string {
  if (!type) return "";
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatLedgerBalance(balance: number): string {
  const abs = formatWalletAed(Math.abs(balance));
  return balance < 0 ? `- ${abs}` : abs;
}

function formatPeriodAmount(value: number, kind: "neutral" | "credit" | "debit"): string {
  const formatted = formatWalletAed(Math.abs(value));
  if (kind === "credit") return `+ ${formatted}`;
  if (kind === "debit") return `- ${formatted}`;
  return value >= 0 ? `+ ${formatted}` : `- ${formatted}`;
}

export function exportStatementCsv(
  rows: LedgerStatementRow[],
  ownerName: string,
  period?: PeriodTotals,
) {
  const header = [
    "Date",
    "Description",
    "Service",
    "Invoice #",
    "Payment Method",
    "Debit (AED)",
    "Credit (AED)",
    "Balance (AED)",
    "Notes",
  ];
  const lines = rows
    .filter((r) => r.is_opening_balance || r.is_visible)
    .map((r) => {
    const isCredit = r.is_opening_balance || r.amount > 0;
    const isDebit = !r.is_opening_balance && r.amount < 0;
    return [
      format(new Date(r.created_at), "d MMM yyyy"),
      txLabel(r),
      serviceLabel(r.service_type),
      r.invoice_number ?? r.invoice_id ?? "",
      r.payment_method ? paymentMethodLabel(r.payment_method) : "",
      isDebit ? formatAedAmount(Math.abs(r.amount)) : "",
      isCredit && !isDebit
        ? r.is_opening_balance
          ? formatAedAmount(r.balance_after)
          : formatAedAmount(r.amount)
        : "",
      formatAedAmount(r.balance_after),
      (r.notes ?? "").replace(/,/g, " "),
    ].join(",");
  });

  const summary: string[] = [];
  if (period) {
    summary.push(
      "",
      `Opening,${formatAedAmount(period.opening)}`,
      `Credits,${formatAedAmount(period.credits)}`,
      `Debits,${formatAedAmount(period.debits)}`,
      `Net movement,${formatAedAmount(period.netMovement)}`,
      `Closing,${formatAedAmount(period.closing)}`,
    );
  }

  const csv = [header.join(","), ...lines, ...summary].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `statement-${ownerName.replace(/\s+/g, "-").toLowerCase()}-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface StatementLedgerTableProps {
  rows: LedgerStatementRow[];
  isLoading: boolean;
  returnTo?: string;
  periodTotals?: PeriodTotals;
}

export function StatementLedgerTable({
  rows,
  isLoading,
  returnTo,
  periodTotals,
}: StatementLedgerTableProps) {
  const displayRows = rows.filter((r) => r.is_opening_balance || r.is_visible);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {periodTotals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(
            [
              ["Opening", periodTotals.opening, "neutral"],
              ["Credits", periodTotals.credits, "credit"],
              ["Debits", periodTotals.debits, "debit"],
              ["Net movement", periodTotals.netMovement, periodTotals.netMovement < 0 ? "debit" : periodTotals.netMovement > 0 ? "credit" : "neutral"],
            ] as const
          ).map(([label, value, kind]) => (
            <div key={label} className="rounded-lg border bg-muted/20 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </p>
              <p
                className={cn(
                  "mt-1 text-sm font-bold tabular-nums",
                  kind === "credit" && "text-emerald-600 dark:text-emerald-400",
                  kind === "debit" && "text-red-600 dark:text-red-400",
                )}
              >
                {formatPeriodAmount(value, kind)}
              </p>
            </div>
          ))}
        </div>
      )}

      {displayRows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No transactions in this period.
        </p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="w-28 whitespace-nowrap text-[11px] uppercase tracking-wide">
                  Date
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-wide">Description</TableHead>
                <TableHead className="whitespace-nowrap text-[11px] uppercase tracking-wide">
                  Service
                </TableHead>
                <TableHead className="whitespace-nowrap text-[11px] uppercase tracking-wide">
                  Invoice #
                </TableHead>
                <TableHead className="whitespace-nowrap text-[11px] uppercase tracking-wide">
                  Method
                </TableHead>
                <TableHead className="text-right whitespace-nowrap text-[11px] uppercase tracking-wide">
                  Debit
                </TableHead>
                <TableHead className="text-right whitespace-nowrap text-[11px] uppercase tracking-wide">
                  Credit
                </TableHead>
                <TableHead className="text-right whitespace-nowrap text-[11px] uppercase tracking-wide font-semibold">
                  Balance
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.map((row) => {
                const isOpening = row.is_opening_balance;
                const isCredit = isOpening || row.amount > 0;
                const isDebit = !isOpening && row.amount < 0;
                const absAmount = Math.abs(row.amount);
                const detail = !isOpening ? invoiceDetail(row) : null;

                return (
                  <TableRow
                    key={row.row_id}
                    className={cn("text-sm", isOpening && "bg-muted/20")}
                  >
                    <TableCell className="text-muted-foreground whitespace-nowrap align-top py-3">
                      {format(new Date(row.created_at), "d MMM yyyy")}
                    </TableCell>

                    <TableCell className="align-top py-3 max-w-xs">
                      <div className={cn("font-medium", isOpening && "italic text-muted-foreground")}>
                        {txLabel(row)}
                      </div>
                      {detail && (
                        <div className="mt-1 text-xs leading-snug text-muted-foreground">
                          {detail}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="align-top py-3">
                      {row.service_type ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-normal capitalize border-muted-foreground/30"
                        >
                          {serviceLabel(row.service_type)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="align-top py-3 whitespace-nowrap">
                      {row.invoice_id ? (
                        <Link
                          to={`/billing/invoices/${row.invoice_id}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
                          className="text-orange-600 hover:underline font-mono text-xs dark:text-orange-400"
                        >
                          {row.invoice_number ?? row.invoice_id.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="align-top py-3">
                      {row.payment_method ? (
                        <span className="text-xs text-muted-foreground">
                          {paymentMethodLabel(row.payment_method)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right align-top py-3 tabular-nums text-sm">
                      {isDebit ? (
                        <span className="text-red-600 dark:text-red-400 font-medium">
                          {formatWalletAed(absAmount)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right align-top py-3 tabular-nums text-sm">
                      {isCredit && !isDebit && !isOpening ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          {formatWalletAed(absAmount)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right align-top py-3 tabular-nums text-sm font-semibold">
                      <span
                        className={cn(
                          row.balance_after < 0 && "text-red-600 dark:text-red-400",
                        )}
                      >
                        {formatLedgerBalance(row.balance_after)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}