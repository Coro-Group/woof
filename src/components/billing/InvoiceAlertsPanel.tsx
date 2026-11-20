import { useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  FileWarning,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatAed } from "@/hooks/useBilling";
import {
  useInvoiceAlerts,
  type InvoiceAlertRow,
  type MultipleUnpaidOwner,
} from "@/hooks/useInvoiceAlerts";

function fmtDate(value: string | null): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "d MMM");
  } catch {
    return value;
  }
}

type Tone = "amber" | "red" | "orange" | "yellow";

const TONE: Record<Tone, { card: string; badge: string; icon: string }> = {
  amber: {
    card: "border-amber-200",
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    icon: "text-amber-600",
  },
  red: {
    card: "border-red-200",
    badge: "bg-red-100 text-red-800 border-red-200",
    icon: "text-red-600",
  },
  orange: {
    card: "border-orange-200",
    badge: "bg-orange-100 text-orange-800 border-orange-200",
    icon: "text-orange-600",
  },
  yellow: {
    card: "border-yellow-200",
    badge: "bg-yellow-100 text-yellow-800 border-yellow-200",
    icon: "text-yellow-700",
  },
};

interface AlertCardProps {
  title: string;
  count: number;
  tone: Tone;
  icon: React.ReactNode;
  testId: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function AlertCard({
  title,
  count,
  tone,
  icon,
  testId,
  children,
  defaultOpen,
}: AlertCardProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const t = TONE[tone];
  return (
    <Card className={cn("overflow-hidden", t.card)} data-testid={testId}>
      <CardHeader
        className="cursor-pointer select-none py-3"
        onClick={() => setOpen((v) => !v)}
      >
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span className="flex items-center gap-2">
            <span className={t.icon}>{icon}</span>
            {title}
            <Badge variant="outline" className={t.badge}>
              {count}
            </Badge>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </CardTitle>
      </CardHeader>
      {open ? <CardContent className="pt-0 space-y-1.5">{children}</CardContent> : null}
    </Card>
  );
}

function InvoiceRowLink({
  row,
  trailing,
}: {
  row: InvoiceAlertRow;
  trailing?: React.ReactNode;
}) {
  return (
    <Link
      to={`/billing/invoices/${row.id}`}
      className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/50"
    >
      <span className="min-w-0">
        <span className="font-medium">{row.owner_name || "Unknown owner"}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          {row.invoice_number ?? row.id.slice(0, 8)}
          {row.service_type ? ` · ${row.service_type.replace(/_/g, " ")}` : ""}
        </span>
      </span>
      <span className="shrink-0 tabular-nums text-xs">{trailing}</span>
    </Link>
  );
}

export function InvoiceAlertsPanel({ className }: { className?: string }) {
  const { data, isLoading } = useInvoiceAlerts();

  if (isLoading || !data) return null;

  const { staleDrafts, overdue, depositBypassed, multipleUnpaid, paidWithoutSettlement } =
    data;
  const totalAlerts =
    staleDrafts.length +
    overdue.length +
    depositBypassed.length +
    multipleUnpaid.length +
    paidWithoutSettlement.length;

  if (totalAlerts === 0) return null;

  return (
    <div
      className={cn("grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3", className)}
      data-testid="dashboard-invoice-alerts"
    >
      <AlertCard
        title="Stale drafts"
        count={staleDrafts.length}
        tone="amber"
        icon={<Clock className="h-4 w-4" />}
        testId="dashboard-alert-stale-drafts"
        defaultOpen={staleDrafts.length > 0}
      >
        {staleDrafts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No stale drafts.</p>
        ) : (
          staleDrafts.map((row) => (
            <InvoiceRowLink
              key={row.id}
              row={row}
              trailing={formatAed(row.total)}
            />
          ))
        )}
      </AlertCard>

      <AlertCard
        title="Overdue"
        count={overdue.length}
        tone="red"
        icon={<FileWarning className="h-4 w-4" />}
        testId="dashboard-alert-overdue"
        defaultOpen={overdue.length > 0}
      >
        {overdue.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing overdue.</p>
        ) : (
          overdue.map((row) => (
            <InvoiceRowLink
              key={row.id}
              row={row}
              trailing={
                <span className="text-red-700">
                  {row.days_overdue}d · {formatAed(Math.max(0, row.total - row.amount_paid))}
                </span>
              }
            />
          ))
        )}
      </AlertCard>

      <AlertCard
        title="Deposit bypassed today"
        count={depositBypassed.length}
        tone="orange"
        icon={<ShieldAlert className="h-4 w-4" />}
        testId="dashboard-alert-deposit-bypassed"
      >
        {depositBypassed.length === 0 ? (
          <p className="text-xs text-muted-foreground">No bypasses today.</p>
        ) : (
          depositBypassed.map((row) => (
            <InvoiceRowLink
              key={row.id}
              row={row}
              trailing={
                <span className="text-orange-700" title={row.deposit_bypass_reason ?? ""}>
                  {row.deposit_bypass_reason
                    ? row.deposit_bypass_reason.slice(0, 24)
                    : "—"}
                </span>
              }
            />
          ))
        )}
      </AlertCard>

      <AlertCard
        title="Multiple unpaid"
        count={multipleUnpaid.length}
        tone="yellow"
        icon={<Users className="h-4 w-4" />}
        testId="dashboard-alert-multiple-unpaid"
      >
        {multipleUnpaid.length === 0 ? (
          <p className="text-xs text-muted-foreground">No repeat offenders.</p>
        ) : (
          multipleUnpaid.map((owner: MultipleUnpaidOwner) => (
            <Link
              key={owner.owner_id}
              to={`/customers/${owner.owner_id}`}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/50"
            >
              <span className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-700" />
                <span className="font-medium truncate">
                  {owner.owner_name || "Unknown owner"}
                </span>
                <Badge variant="outline" className="text-xs">
                  {owner.count} invoices
                </Badge>
              </span>
              <span className="shrink-0 tabular-nums text-xs text-yellow-800">
                {formatAed(owner.total_outstanding)}
              </span>
            </Link>
          ))
        )}
      </AlertCard>

      <AlertCard
        title="Paid without settlement"
        count={paidWithoutSettlement.length}
        tone="orange"
        icon={<AlertTriangle className="h-4 w-4" />}
        testId="dashboard-alert-paid-without-settlement"
        defaultOpen={paidWithoutSettlement.length > 0}
      >
        {paidWithoutSettlement.length === 0 ? (
          <p className="text-xs text-muted-foreground">None flagged.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-1.5">
              Status is paid but amount_paid is 0 and there are no payment rows. Confirm the
              correct settlement amount before backfilling — do not change status yet.
            </p>
            {paidWithoutSettlement.map((row) => (
              <InvoiceRowLink
                key={row.id}
                row={row}
                trailing={formatAed(row.total)}
              />
            ))}
          </>
        )}
      </AlertCard>
    </div>
  );
}
