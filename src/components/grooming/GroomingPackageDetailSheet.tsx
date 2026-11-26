import { format } from "date-fns";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SoldGroomingPackage } from "@/hooks/useGroomingPackages";
import {
  useGroomingPackageDetail,
  type GroomingPackagePurchase,
} from "@/hooks/useGroomingPackageDetail";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { serviceGrantLabel } from "@/lib/packageCatalog";
import {
  exportGroomingPackageStatement,
  printGroomingPackageStatement,
  type GroomingPackageStatement,
} from "@/lib/groomingPackageStatementExport";
import {
  formatAed,
  formatStatementDate,
  groomingSoldPackageStatus,
  sessionsLeft,
  unlinkedSessionCount,
  type GroomingPackageUsageRow,
} from "@/lib/groomingPackageStatement";

function pricePaidLabel(purchase: GroomingPackagePurchase | null): string {
  if (!purchase) return "—";
  const paid = purchase.amountPaid > 0 ? purchase.amountPaid : purchase.total;
  if (purchase.amountPaid > 0 && Math.abs(purchase.amountPaid - purchase.total) > 0.009) {
    return `${formatAed(paid)} of ${formatAed(purchase.total)}`;
  }
  return formatAed(paid);
}

function statusClass(status: string): string {
  if (status === "Exhausted") return "bg-red-50 text-red-700 border-red-200";
  if (status === "Expired") return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function UsageTable({
  rows,
  testId,
  empty,
}: {
  rows: GroomingPackageUsageRow[];
  testId: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Service</TableHead>
            <TableHead>Groomer / station</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Used by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${testId}-${row.invoiceId ?? "none"}-${row.date}-${row.petName}-${row.service}`} data-testid={testId}>
              <TableCell className="whitespace-nowrap">
                {formatStatementDate(row.date)}
                {row.petName ? <div className="text-[11px] text-muted-foreground">{row.petName}</div> : null}
              </TableCell>
              <TableCell>{row.service}</TableCell>
              <TableCell>
                <div>{row.groomer}</div>
                <div className="text-[11px] text-muted-foreground">{row.station}</div>
              </TableCell>
              <TableCell className="capitalize">{row.appointmentStatus}</TableCell>
              <TableCell>
                {row.invoiceId ? (
                  <Link to={`/billing/invoices/${row.invoiceId}`} className="text-primary hover:underline">
                    {row.invoiceNumber ?? "Invoice"}
                    {row.invoiceStatus && !["paid", "issued", "outstanding", "draft"].includes(row.invoiceStatus)
                      ? ` (${row.invoiceStatus})`
                      : ""}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>{row.usedBy}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function GroomingPackageDetailSheet({
  pkg,
  onOpenChange,
}: {
  pkg: SoldGroomingPackage | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useGroomingPackageDetail(pkg);
  const today = format(new Date(), "yyyy-MM-dd");

  const ownerName = pkg?.owners
    ? ownerDisplayName(pkg.owners.first_name, pkg.owners.last_name)
    : "Unknown owner";
  const petName = pkg?.pets?.name ?? "Pet";
  const packageName = pkg ? (pkg.package_name ?? serviceGrantLabel(pkg.service_code)) : "Package";
  const status = pkg
    ? groomingSoldPackageStatus({
        sessionsUsed: pkg.days_used,
        sessionsTotal: pkg.total_days,
        expiryDate: pkg.expiry_date,
        today,
      })
    : "Active";
  const left = pkg ? sessionsLeft(pkg.total_days, pkg.days_used) : 0;
  const statement: GroomingPackageStatement | null = pkg
    ? {
        petName,
        ownerName,
        packageName,
        status,
        purchaseDate: pkg.purchase_date,
        expiryDate: pkg.expiry_date,
        pricePaid: pricePaidLabel(detail.data?.purchase ?? null),
        invoiceNumber: detail.data?.purchase?.invoiceNumber ?? null,
        sessionsUsed: pkg.days_used,
        sessionsTotal: pkg.total_days,
        sessionsLeft: left,
        usage: detail.data?.usage ?? [],
        complimentary: detail.data?.complimentary ?? null,
        upcoming: detail.data?.upcoming ?? [],
      }
    : null;

  const gap = pkg && detail.data ? unlinkedSessionCount(pkg.days_used, detail.data.usage.length) : 0;

  const runPrint = () => {
    if (!statement) return;
    try {
      printGroomingPackageStatement(statement);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not print this statement.");
    }
  };

  return (
    <Sheet open={!!pkg} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-3xl"
        data-testid="grooming-package-detail"
      >
        {pkg && (
          <div className="space-y-6 pr-6">
            <SheetHeader className="space-y-3 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>
                  {petName}
                  <span className="font-normal text-muted-foreground"> — </span>
                  {packageName}
                </SheetTitle>
                <Badge variant="outline" className={statusClass(status)}>
                  {status}
                </Badge>
              </div>
              <SheetDescription>
                {ownerName}
                {pkg.owner_id ? (
                  <>
                    {" · "}
                    <Link to={`/customers/${pkg.owner_id}`} className="text-primary hover:underline">
                      Client profile
                    </Link>
                  </>
                ) : null}
              </SheetDescription>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={runPrint}
                  disabled={detail.isLoading || detail.isError}
                  data-testid="grooming-package-detail-print"
                >
                  Print
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={detail.isLoading || detail.isError}
                  onClick={() => statement && exportGroomingPackageStatement(statement)}
                  data-testid="grooming-package-detail-export"
                >
                  Export Excel
                </Button>
                {pkg.owner_id ? (
                  <Button type="button" variant="outline" size="sm" asChild data-testid="grooming-package-detail-profile">
                    <Link to={`/customers/${pkg.owner_id}`}>Open client profile</Link>
                  </Button>
                ) : null}
              </div>
            </SheetHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Pet</dt>
                <dd className="font-medium">{petName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Owner</dt>
                <dd className="font-medium">
                  {pkg.owner_id ? (
                    <Link to={`/customers/${pkg.owner_id}`} className="text-primary hover:underline">
                      {ownerName}
                    </Link>
                  ) : (
                    ownerName
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Package</dt>
                <dd className="font-medium">{packageName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Purchased</dt>
                <dd>{formatStatementDate(pkg.purchase_date)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Expires</dt>
                <dd>{formatStatementDate(pkg.expiry_date)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Price paid</dt>
                <dd>{detail.isLoading ? "…" : pricePaidLabel(detail.data?.purchase ?? null)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Invoice</dt>
                <dd>
                  {detail.data?.purchase ? (
                    <Link to={`/billing/invoices/${detail.data.purchase.id}`} className="text-primary hover:underline">
                      {detail.data.purchase.invoiceNumber ?? "Open invoice"}
                    </Link>
                  ) : detail.isLoading ? (
                    "…"
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sessions used</dt>
                <dd className="tabular-nums">
                  {pkg.days_used} / {pkg.total_days}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sessions left</dt>
                <dd className="tabular-nums">{left}</dd>
              </div>
            </dl>

            {detail.isError && (
              <p className="text-sm text-destructive">
                {detail.error instanceof Error ? detail.error.message : "Could not load this package."}
              </p>
            )}

            {detail.data?.allowsOtherPets && (
              <p className="text-sm text-muted-foreground">
                This credit is a shared pool, so visits for another pet in the household are included.
              </p>
            )}
            {detail.data?.purchase && detail.data.purchase.petCount > 1 && !detail.data.allowsOtherPets && (
              <p className="text-sm text-muted-foreground">
                The purchase invoice covers {detail.data.purchase.petCount} pets. The price shown is the invoice total.
              </p>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Usage history</h3>
              {detail.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading visits…</p>
              ) : (
                <UsageTable
                  rows={detail.data?.usage ?? []}
                  testId="grooming-package-usage-row"
                  empty="No visits are linked to this package yet."
                />
              )}
              {gap > 0 && (
                <p className="text-xs text-muted-foreground">
                  {gap} used session{gap === 1 ? "" : "s"} {gap === 1 ? "is" : "are"} not linked to a grooming invoice.
                  The session count above is the package record.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Session adjustments and refunds are not stored on a separate record. Used by is blank because applying a credit does not save the staff member.
              </p>
            </section>

            {detail.data?.complimentary && (
              <section className="space-y-2" data-testid="grooming-package-complimentary">
                <h3 className="text-sm font-semibold">Complimentary daycare</h3>
                <p className="text-sm">
                  {detail.data.complimentary.total} total · {detail.data.complimentary.used} used ·{" "}
                  {detail.data.complimentary.remaining} remaining
                </p>
                {detail.data.complimentary.dates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No daycare dates are linked yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {detail.data.complimentary.dates.map((day) => (
                      <li key={`${day.date}-${day.petName}`}>
                        {formatStatementDate(day.date)} · {day.petName}
                        {day.loggedBy !== "—" ? ` · ${day.loggedBy}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Upcoming appointments</h3>
              {detail.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading appointments…</p>
              ) : (
                <UsageTable
                  rows={detail.data?.upcoming ?? []}
                  testId="grooming-package-upcoming-row"
                  empty="No upcoming appointments are booked against this package."
                />
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
