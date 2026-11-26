import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Download, Package, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAllGroomingPackages, type SoldGroomingPackage } from "@/hooks/useGroomingPackages";
import { complimentaryDaycareSummary } from "@/lib/complimentaryDaycare";
import { serviceGrantLabel } from "@/lib/packageCatalog";
import { exportDaycarePackagesToExcel } from "@/lib/daycarePackagesExport";
import { GroomingPackageDetailSheet } from "@/components/grooming/GroomingPackageDetailSheet";
import { PurchasePackageDialog } from "@/components/packages/PurchasePackageDialog";
import { OwnerSearchPopover } from "@/components/billing/OwnerSearchPopover";
import { useOwner } from "@/hooks/useOwners";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SoldStatusFilter = "all" | "low" | "exhausted";

function soldCreditColour(remaining: number) {
  if (remaining <= 1) return "text-red-600";
  if (remaining <= 3) return "text-amber-600";
  return "text-emerald-600";
}

function soldCreditBarColour(remaining: number) {
  if (remaining <= 1) return "bg-red-500";
  if (remaining <= 3) return "bg-amber-500";
  return "bg-emerald-500";
}

function soldPackageLabel(pkg: SoldGroomingPackage): string {
  return pkg.package_name ?? serviceGrantLabel(pkg.service_code);
}

function soldPackageMatchesSearch(pkg: SoldGroomingPackage, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const ownerName = pkg.owners
    ? ownerDisplayName(pkg.owners.first_name, pkg.owners.last_name).toLowerCase()
    : "";
  const petName = (pkg.pets?.name ?? "").toLowerCase();
  const pkgName = soldPackageLabel(pkg).toLowerCase();
  return ownerName.includes(q) || petName.includes(q) || pkgName.includes(q);
}

function GroomingPackageCard({
  pkg,
  onOpen,
}: {
  pkg: SoldGroomingPackage;
  onOpen: (pkg: SoldGroomingPackage) => void;
}) {
  const remaining = pkg.total_days - pkg.days_used;
  const pct = Math.min(100, (pkg.days_used / Math.max(1, pkg.total_days)) * 100);
  const isExhausted = remaining <= 0;
  const isExpired =
    !isExhausted && !!pkg.expiry_date && pkg.expiry_date < format(new Date(), "yyyy-MM-dd");

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(pkg)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(pkg);
        }
      }}
      className={`cursor-pointer transition-shadow hover:shadow-md ${isExhausted ? "opacity-60" : ""}`}
      data-testid={`grooming-sold-card-${pkg.id}`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0 text-left">
            <p className="font-semibold truncate">
              {pkg.pets?.name ?? "Pet"}
              <span className="font-normal text-muted-foreground"> — </span>
              {pkg.owners
                ? ownerDisplayName(pkg.owners.first_name, pkg.owners.last_name)
                : "Unknown owner"}
            </p>
            <p className="text-xs text-muted-foreground truncate">{soldPackageLabel(pkg)}</p>
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {isExhausted ? (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[10px]">
                  Exhausted
                </Badge>
              ) : isExpired ? (
                <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-[10px]">
                  Expired
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                  Active
                </Badge>
              )}
            </div>
          </div>
          <div className={`text-right shrink-0 ${soldCreditColour(remaining)}`}>
            {remaining <= 3 && !isExhausted && <AlertTriangle className="h-3.5 w-3.5 ml-auto mb-0.5" />}
            <p className="text-2xl font-bold tabular-nums leading-none">
              {pkg.days_used}
              <span className="text-base font-normal text-muted-foreground">/{pkg.total_days}</span>
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {Math.max(0, remaining)} session{remaining === 1 ? "" : "s"} left
            </p>
          </div>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${soldCreditBarColour(remaining)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {pkg.expiry_date && (
          <p className="text-[10px] text-muted-foreground">
            Expires {format(parseISO(pkg.expiry_date), "d MMM yyyy")}
          </p>
        )}
        {pkg.complimentaryDaycare && (
          <p className="text-xs" data-testid={`grooming-complimentary-daycare-${pkg.id}`}>
            {complimentaryDaycareSummary(pkg.complimentaryDaycare.total, pkg.complimentaryDaycare.used)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function GroomingPackagesTab() {
  const {
    data: soldPackages,
    isLoading: soldLoading,
    isError: soldIsError,
    error: soldError,
    refetch: refetchSold,
  } = useAllGroomingPackages();

  const [sellOpen, setSellOpen] = useState(false);
  const [sellOwnerId, setSellOwnerId] = useState<string | undefined>();
  const { data: sellOwner } = useOwner(sellOwnerId ?? "");

  const [soldStatus, setSoldStatus] = useState<SoldStatusFilter>("all");
  const [soldPackageFilter, setSoldPackageFilter] = useState<string>("all");
  const [soldSearch, setSoldSearch] = useState("");
  const [openPackage, setOpenPackage] = useState<SoldGroomingPackage | null>(null);

  const packageNameOptions = useMemo(() => {
    const names = new Set<string>();
    for (const pkg of soldPackages ?? []) names.add(soldPackageLabel(pkg));
    return Array.from(names).sort();
  }, [soldPackages]);

  const soldFiltered = useMemo(() => {
    return (soldPackages ?? []).filter((pkg) => {
      const remaining = pkg.total_days - pkg.days_used;
      if (soldStatus === "low" && !(remaining > 0 && remaining <= 2)) return false;
      if (soldStatus === "exhausted" && remaining > 0) return false;
      if (soldPackageFilter !== "all" && soldPackageLabel(pkg) !== soldPackageFilter) return false;
      if (!soldPackageMatchesSearch(pkg, soldSearch)) return false;
      return true;
    });
  }, [soldPackages, soldStatus, soldPackageFilter, soldSearch]);

  const sellOwnerLabel =
    sellOwner && sellOwnerId === sellOwner.id
      ? ownerDisplayName(sellOwner.first_name, sellOwner.last_name)
      : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3 min-w-0 flex-1">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Grooming packages</h3>
            <p className="text-sm text-muted-foreground">
              Outstanding grooming credits across all clients. Edit package rates in the Pricing tab.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={soldStatus} onValueChange={(v) => setSoldStatus(v as SoldStatusFilter)}>
              <SelectTrigger className="h-8 w-48 text-xs" data-testid="grooming-sold-filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All packages</SelectItem>
                <SelectItem value="low">Low credits (≤2 left)</SelectItem>
                <SelectItem value="exhausted">Exhausted</SelectItem>
              </SelectContent>
            </Select>
            <Select value={soldPackageFilter} onValueChange={setSoldPackageFilter}>
              <SelectTrigger className="h-8 w-48 text-xs" data-testid="grooming-sold-filter-package">
                <SelectValue placeholder="All packages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All package types</SelectItem>
                {packageNameOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            placeholder="Search owner, pet, or package name…"
            value={soldSearch}
            onChange={(e) => setSoldSearch(e.target.value)}
            className="max-w-md h-9"
            data-testid="grooming-sold-search"
          />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="grooming-sold-export-btn"
            disabled={soldLoading || !soldPackages?.length}
            onClick={() => {
              if (!soldPackages?.length) {
                toast.error("No packages to export.");
                return;
              }
              exportDaycarePackagesToExcel(
                soldPackages,
                `grooming-packages-${format(new Date(), "yyyy-MM-dd")}.xlsx`,
              );
              toast.success(
                `Exported ${soldPackages.length} package${soldPackages.length === 1 ? "" : "s"}.`,
              );
            }}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Export Excel
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="grooming-new-package-btn"
            onClick={() => setSellOpen(true)}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Sell package
          </Button>
        </div>
      </div>

      {soldIsError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive">
          <p className="font-medium">Could not load sold packages</p>
          <p className="mt-1 text-destructive/90">
            {soldError instanceof Error ? soldError.message : "Unknown error"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => refetchSold()}
          >
            Retry
          </Button>
        </div>
      ) : soldLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : soldFiltered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Package className="h-10 w-10 mb-3 opacity-40" />
          <p>No sold grooming packages match these filters.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {soldFiltered.map((pkg) => (
            <GroomingPackageCard key={pkg.id} pkg={pkg} onOpen={setOpenPackage} />
          ))}
        </div>
      )}

      <GroomingPackageDetailSheet pkg={openPackage} onOpenChange={(open) => { if (!open) setOpenPackage(null); }} />

      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sell package</DialogTitle>
          </DialogHeader>
          <OwnerSearchPopover
            label="Client"
            ownerId={sellOwnerId}
            ownerLabel={sellOwnerLabel}
            onSelect={(id) => setSellOwnerId(id)}
            onClear={() => setSellOwnerId(undefined)}
            inputTestId="grooming-sell-package-owner"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setSellOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!sellOwnerId}
              onClick={() => {
                if (!sellOwnerId) return;
                setSellOpen(false);
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PurchasePackageDialog
        ownerId={sellOwnerId ?? ""}
        isOpen={!!sellOwnerId && !sellOpen}
        categoryFilter="grooming"
        onClose={() => setSellOwnerId(undefined)}
        onSuccess={() => setSellOwnerId(undefined)}
      />
    </div>
  );
}
