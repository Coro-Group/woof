import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Link, useParams } from "react-router-dom";
import { ChevronDown, Download, Printer } from "lucide-react";
import TopBar from "@/components/dashboard/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useOwner } from "@/hooks/useOwners";
import { useOwnerBalances } from "@/hooks/useBilling";
import { useStatementOfAccount, useLedgerStatement } from "@/hooks/useStatement";
import {
  StatementLedgerTable,
  exportStatementCsv,
} from "@/components/billing/StatementLedgerTable";
import {
  WalletBalanceDisplay,
  OutstandingAmountBadge,
} from "@/components/billing/WalletBalanceDisplay";
import {
  computePeriodTotals,
  invoiceRemainingTotal,
} from "@/lib/ownerBalances";
import { formatWalletAed } from "@/lib/money";
import {
  defaultStatementRange,
  getDubaiTodayDate,
  presetToFromDate,
  statementRangeFromDates,
  type StatementDatePreset,
} from "@/lib/statementDates";
import { cn } from "@/lib/utils";
import type { StatementRow } from "@/hooks/useStatement";

const PRESETS: { value: StatementDatePreset; label: string }[] = [
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "180d", label: "180d" },
  { value: "1y", label: "1y" },
];

const STATUS_BADGE: Record<string, string> = {
  outstanding: "border-slate-300 text-slate-700 bg-slate-50",
  overdue: "border-red-300 text-red-700 bg-red-50",
  partially_paid: "border-amber-300 text-amber-700 bg-amber-50",
};

function deriveBranchCode(invoiceNumber: string | null | undefined): string | null {
  const normalized = invoiceNumber?.trim();
  if (!normalized) return null;
  const match = normalized.match(/^([A-Za-z]{2,8})[-/]/);
  return match ? match[1].toUpperCase() : null;
}

function ownerTierLabel(owner: { is_vip?: boolean; is_elite?: boolean | null } | null | undefined): string {
  if (owner?.is_elite) return "Elite";
  if (owner?.is_vip) return "VIP";
  return "Standard";
}

function serviceLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function OutstandingInvoiceRow({
  row,
  ownerId,
}: {
  row: StatementRow;
  ownerId: string;
}) {
  const branch = deriveBranchCode(row.invoice_number);
  const statusClass = STATUS_BADGE[row.status] ?? STATUS_BADGE.outstanding;

  return (
    <div className="flex items-center justify-between gap-4 border-t px-4 py-3 first:border-t-0">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/billing/invoices/${row.invoice_id}?returnTo=${encodeURIComponent(`/billing/statements/${ownerId}`)}`}
            className="font-mono text-xs text-orange-600 hover:underline dark:text-orange-400"
          >
            {row.invoice_number ?? row.invoice_id.slice(0, 8)}
          </Link>
          {branch ? (
            <Badge variant="outline" className="text-[10px] font-semibold px-1.5 py-0">
              {branch}
            </Badge>
          ) : null}
          {row.service_type ? (
            <Badge variant="outline" className="text-[10px] font-normal capitalize">
              {serviceLabel(row.service_type)}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Due{" "}
          {row.due_date
            ? format(new Date(`${row.due_date}T00:00:00`), "d MMM yyyy")
            : "—"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-semibold tabular-nums">{formatWalletAed(row.total)}</span>
        <Badge variant="outline" className={cn("text-[10px] capitalize", statusClass)}>
          {row.status.replace(/_/g, " ")}
        </Badge>
      </div>
    </div>
  );
}

export default function OwnerStatementPage() {
  const { ownerId } = useParams<{ ownerId: string }>();
  const returnTo = ownerId ? `/billing/statements/${ownerId}` : undefined;

  const initialRange = useMemo(() => defaultStatementRange(), []);
  const [fromDate, setFromDate] = useState(initialRange.fromDate);
  const [toDate, setToDate] = useState(initialRange.toDate);
  const [outstandingOpen, setOutstandingOpen] = useState(true);
  const [payAllPending, setPayAllPending] = useState(false);

  const { fromIso, toIso } = useMemo(
    () => statementRangeFromDates(fromDate, toDate),
    [fromDate, toDate],
  );

  const dubaiToday = getDubaiTodayDate();
  const statementAsOf = format(new Date(`${dubaiToday}T12:00:00`), "d MMMM yyyy");

  const { data: owner } = useOwner(ownerId || "");
  const ownerBalances = useOwnerBalances(ownerId || "");
  const { data: statement = [], isLoading: statementLoading } = useStatementOfAccount(ownerId);
  const { data: ledger = [], isLoading: ledgerLoading } = useLedgerStatement(ownerId, fromIso, toIso);

  const ownerName = owner ? `${owner.first_name} ${owner.last_name ?? ""}`.trim() : "Owner";
  const balances = ownerBalances.balances;

  const outstanding = useMemo(
    () => [...statement].sort((a, b) => (a.due_date || "").localeCompare(b.due_date || "")),
    [statement],
  );

  const outstandingTotal = useMemo(() => invoiceRemainingTotal(statement), [statement]);
  const periodTotals = useMemo(() => computePeriodTotals(ledger), [ledger]);
  const headerLoading = statementLoading || ownerBalances.isLoading;

  const applyPreset = (preset: StatementDatePreset) => {
    const today = getDubaiTodayDate();
    setFromDate(presetToFromDate(preset, today));
    setToDate(today);
  };

  const handlePrintStatement = () => {
    window.print();
  };

  const debtAmount =
    balances.outstandingDebt > 0
      ? balances.outstandingDebt
      : outstandingTotal > 0 && balances.netPosition >= 0
        ? outstandingTotal
        : 0;

  return (
    <>
      <TopBar title="Statement of Account" />
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          html, body { background: white !important; color: #111827 !important; }
          header, aside, .soa-no-print { display: none !important; }
          .soa-print-root {
            display: block !important;
            overflow: visible !important;
            padding: 0 !important;
            background: white !important;
          }
          .soa-print-card {
            border: 0 !important;
            box-shadow: none !important;
            break-inside: avoid;
          }
          .soa-print-table {
            overflow: visible !important;
            border-color: #d1d5db !important;
          }
          .soa-print-table table {
            font-size: 10px !important;
          }
          .soa-print-table th,
          .soa-print-table td {
            padding: 6px 8px !important;
          }
          .soa-print-table a {
            color: #111827 !important;
            text-decoration: none !important;
          }
        }
      `}</style>
      <main className="soa-print-root flex-1 overflow-auto p-6 md:p-8 space-y-5">
        <div className="soa-no-print flex flex-wrap items-center justify-between gap-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/billing/invoices" className="text-orange-600 hover:text-orange-700 dark:text-orange-400">
                    Invoices
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/billing" className="text-orange-600 hover:text-orange-700 dark:text-orange-400">
                    Billing
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Statement</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={ledger.length === 0 || ledgerLoading}
              onClick={handlePrintStatement}
            >
              <Printer className="h-3.5 w-3.5" />
              Print statement
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={ledger.length === 0}
              onClick={() => exportStatementCsv(ledger, ownerName, periodTotals)}
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        </div>

        <Card className="soa-print-card">
          <CardContent className="p-5 grid gap-6 md:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Account holder
              </p>
              <p className="text-2xl font-bold mt-1">{ownerName}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Badge variant="outline" className="text-xs font-normal">
                  {ownerTierLabel(owner)}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-2">Statement as of {statementAsOf}</p>
            </div>

            <div className="md:text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Account balance (SOA)
              </p>
              {headerLoading ? (
                <p className="text-3xl font-bold mt-1">—</p>
              ) : (
                <>
                  <WalletBalanceDisplay
                    accountBalance={balances.netPosition}
                    amountClassName={
                      balances.netPosition < 0 ? "text-red-600 dark:text-red-400" : undefined
                    }
                    className="md:flex md:flex-col md:items-end"
                  />
                  {balances.netPosition >= 0 && outstandingTotal > 0 && (
                    <OutstandingAmountBadge
                      amount={outstandingTotal}
                      className="md:ml-auto"
                    />
                  )}
                  {debtAmount > 0 && balances.netPosition < 0 && (
                    <div className="mt-3 md:ml-auto md:inline-block md:text-right">
                      <p className="text-xs text-muted-foreground">Outstanding (debt)</p>
                      <p className="text-lg font-bold tabular-nums text-red-600 dark:text-red-400">
                        {formatWalletAed(debtAmount)}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {!headerLoading && ownerBalances.canPayAll && (
          <Card className="soa-no-print border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20">
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                Wallet credit ({formatWalletAed(balances.wallet)}) can cover all open invoices (
                {formatWalletAed(outstandingTotal)}).
              </p>
              <Button
                size="sm"
                disabled={payAllPending}
                onClick={async () => {
                  setPayAllPending(true);
                  try {
                    await ownerBalances.payAllOutstanding("bulk_payment");
                  } finally {
                    setPayAllPending(false);
                  }
                }}
              >
                {payAllPending ? "Processing…" : "Pay all outstanding"}
              </Button>
            </CardContent>
          </Card>
        )}

        {!statementLoading && outstanding.length > 0 && (
          <Collapsible open={outstandingOpen} onOpenChange={setOutstandingOpen}>
            <Card className="soa-no-print">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        outstandingOpen && "rotate-180",
                      )}
                    />
                    <span className="font-semibold">Outstanding invoices</span>
                    <Badge className="h-5 min-w-5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white hover:bg-red-600">
                      {outstanding.length}
                    </Badge>
                  </span>
                  <span className="font-bold tabular-nums text-red-600 dark:text-red-400">
                    {formatWalletAed(outstandingTotal)}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t">
                  {outstanding.map((row) => (
                    <OutstandingInvoiceRow key={row.invoice_id} row={row} ownerId={ownerId!} />
                  ))}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}

        <Card className="soa-print-card">
          <CardContent className="p-5 space-y-4">
            <div className="soa-no-print flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="soa-from" className="text-xs">
                  From
                </Label>
                <Input
                  id="soa-from"
                  type="date"
                  className="h-9 w-36"
                  value={fromDate}
                  max={toDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="soa-to" className="text-xs">
                  To
                </Label>
                <Input
                  id="soa-to"
                  type="date"
                  className="h-9 w-36"
                  value={toDate}
                  min={fromDate}
                  max={dubaiToday}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-1.5 pb-0.5">
                {PRESETS.map((p) => (
                  <Button
                    key={p.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 text-xs"
                    onClick={() => applyPreset(p.value)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="soa-print-table">
              <StatementLedgerTable
                rows={ledger}
                isLoading={ledgerLoading}
                returnTo={returnTo}
                periodTotals={periodTotals}
              />
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
