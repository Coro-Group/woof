import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Download, Loader2, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { exportDaycarePackagesToExcel } from "@/lib/daycarePackagesExport";
import { invoiceToVoidForPackageRemoval } from "@/lib/daycarePackageRemoval";
import { daycarePackagePetDisplayTitle } from "@/lib/daycareSharedPool";
import { serviceGrantLabel } from "@/lib/packageCatalog";
import { ownerDisplayName } from "@/lib/bookingUtils";
import {
  useAllDaycarePackages,
  useDeleteDaycarePackage,
  type PackageWithDetails,
} from "@/hooks/useDaycare";
import { OwnerSearchPopover } from "@/components/billing/OwnerSearchPopover";
import { VoidInvoiceDialog } from "@/components/billing/VoidInvoiceDialog";
import { PackageUsageDialog } from "@/components/daycare/PackageUsageDialog";
import { PurchasePackageDialog } from "@/components/packages/PurchasePackageDialog";
import { useOwner } from "@/hooks/useOwners";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

type PkgFilter = "all" | "low" | "exhausted";
type TierFilter = "all" | "standard" | "silver" | "gold";

const TIER_OPTIONS: { value: TierFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "standard", label: "Standard" },
  { value: "silver", label: "Silver" },
  { value: "gold", label: "Gold" },
];

const MEMBER_BADGE: Record<string, string> = {
  standard: "bg-slate-100 text-slate-700 border-slate-200",
  silver: "bg-slate-200 text-slate-800 border-slate-300",
  gold: "bg-amber-50 text-amber-800 border-amber-200",
};

function creditColour(remaining: number) {
  if (remaining <= 1) return "text-red-600";
  if (remaining <= 3) return "text-amber-600";
  return "text-emerald-600";
}

function creditBarColour(remaining: number) {
  if (remaining <= 1) return "bg-red-500";
  if (remaining <= 3) return "bg-amber-500";
  return "bg-emerald-500";
}

function packageMatchesTier(pkg: PackageWithDetails, tier: TierFilter): boolean {
  if (tier === "all") return true;
  const memberType = pkg.owners?.member_tier ?? "standard";
  return memberType === tier;
}

function packageMatchesSearch(pkg: PackageWithDetails, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const ownerName = pkg.owners
    ? ownerDisplayName(pkg.owners.first_name, pkg.owners.last_name).toLowerCase()
    : "";
  const petName = (pkg.pets?.name ?? "").toLowerCase();
  const pkgName = (pkg.package_name ?? "").toLowerCase();
  return ownerName.includes(q) || petName.includes(q) || pkgName.includes(q);
}

function PackageCard({ pkg }: { pkg: PackageWithDetails }) {
  const [, setSearchParams] = useSearchParams();
  const revokePackage = useDeleteDaycarePackage();
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const removalInvoice = useQuery({
    queryKey: ["package-removal-invoice", pkg.id],
    enabled: deleteOpen,
    queryFn: () => invoiceToVoidForPackageRemoval(pkg.id),
  });
  /** Prevents the card click handler from re-opening after dialog close (mouseup lands on card). */
  const ignoreCardOpenRef = useRef(false);
  const remaining = pkg.total_days - pkg.days_used;
  const pct = Math.min(100, (pkg.days_used / Math.max(1, pkg.total_days)) * 100);
  const isExhausted = remaining <= 0;
  const isExpired =
    !isExhausted && !!pkg.expiry_date && pkg.expiry_date < format(new Date(), "yyyy-MM-dd");
  const canDelete = pkg.days_used === 0 && remaining > 0;
  const memberType = pkg.owners?.member_tier ?? "standard";

  const openInPlanner = () => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set("tab", "planner");
        n.set("ownerId", pkg.owner_id);
        n.set("packageId", pkg.id);
        return n;
      },
      { replace: true },
    );
  };

  const openDetail = () => setDetailOpen(true);

  const handleDetailOpenChange = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      ignoreCardOpenRef.current = true;
      window.setTimeout(() => {
        ignoreCardOpenRef.current = false;
      }, 400);
    }
  };

  const handleCardClick = () => {
    if (ignoreCardOpenRef.current || detailOpen) return;
    openDetail();
  };

  return (
    <>
    <Card
      className={`transition-shadow hover:shadow-md cursor-pointer ${isExhausted ? "opacity-60" : ""} ${detailOpen ? "pointer-events-none" : ""}`}
      data-testid={`daycare-package-card-${pkg.id}`}
      onClick={handleCardClick}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0 text-left">
            <p className="font-semibold truncate">
              {daycarePackagePetDisplayTitle({
                is_shared_pool: pkg.is_shared_pool,
                shared_pool_pets_label: pkg.shared_pool_pets_label,
                anchor_pet_name: pkg.pets?.name ?? null,
                pet_name: pkg.pets?.name ?? null,
              })}
              <span className="font-normal text-muted-foreground"> — </span>
              {pkg.owners
                ? ownerDisplayName(pkg.owners.first_name, pkg.owners.last_name)
                : "Unknown owner"}
            </p>
            {pkg.is_shared_pool ? (
              <p className="text-xs text-muted-foreground">
                Household shared pool · {pkg.days_used}/{pkg.total_days} days used (any dog)
              </p>
            ) : null}
            {pkg.package_name ? (
              <p className="text-xs text-muted-foreground truncate">{pkg.package_name}</p>
            ) : (
              <p className="text-xs text-muted-foreground truncate">{serviceGrantLabel(pkg.service_code)}</p>
            )}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <Badge variant="outline" className={MEMBER_BADGE[memberType] ?? MEMBER_BADGE.standard}>
                {memberType.charAt(0).toUpperCase() + memberType.slice(1)}
              </Badge>
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
          <div className={`text-right shrink-0 ${creditColour(remaining)}`}>
            {remaining <= 3 && <AlertTriangle className="h-3.5 w-3.5 ml-auto mb-0.5" />}
            <p className="text-2xl font-bold tabular-nums leading-none">
              {pkg.days_used}
              <span className="text-base font-normal text-muted-foreground">/{pkg.total_days}</span>
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {remaining} left · {pkg.days_used} used
            </p>
          </div>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${creditBarColour(remaining)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {pkg.expiry_date && (
          <p className="text-[10px] text-muted-foreground">
            Expires {format(parseISO(pkg.expiry_date), "d MMM yyyy")}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            data-testid={`daycare-package-view-${pkg.id}`}
            onClick={(e) => {
              e.stopPropagation();
              openDetail();
            }}
          >
            View days used
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={(e) => {
              e.stopPropagation();
              openInPlanner();
            }}
          >
            Open in planner
          </Button>
          {canDelete ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
              data-testid={`daycare-package-delete-${pkg.id}`}
              onClick={(e) => {
                e.stopPropagation();
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>

    <PackageUsageDialog
      pkg={pkg}
      open={detailOpen}
      onOpenChange={handleDetailOpenChange}
      onOpenInPlanner={openInPlanner}
    />

    <VoidInvoiceDialog
      open={deleteOpen}
      invoiceId={removalInvoice.data ?? null}
      pending={removalInvoice.isLoading}
      loadError={
        removalInvoice.isError
          ? removalInvoice.error instanceof Error
            ? removalInvoice.error.message
            : "Could not check the purchase invoice."
          : null
      }
      title="Remove this package?"
      description={`Removes unused credit for ${pkg.pets?.name ?? "this pet"}${pkg.package_name ? ` (${pkg.package_name})` : ""}. Only allowed when no days have been used and no planner sessions are linked.`}
      confirmLabel={removalInvoice.data ? "Void invoice" : "Remove package"}
      onOpenChange={setDeleteOpen}
      onConfirm={async ({ reason, staff }) => {
        const result = await revokePackage.mutateAsync({ creditId: pkg.id, reason, staff });
        toast.success(
          result.invoice_voided ? "Package removed and invoice voided." : "Package removed.",
        );
      }}
    />
    </>
  );
}

export function DaycarePackagesTab() {
  const [filter, setFilter] = useState<PkgFilter>("all");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sellOpen, setSellOpen] = useState(false);
  const [sellOwnerId, setSellOwnerId] = useState<string | undefined>();
  const { data: sellOwner } = useOwner(sellOwnerId ?? "");

  const { data: packages, isLoading, isError, error, refetch } = useAllDaycarePackages();

  const sellOwnerLabel =
    sellOwner && sellOwnerId === sellOwner.id
      ? ownerDisplayName(sellOwner.first_name, sellOwner.last_name)
      : "";

  const filtered = useMemo(() => {
    return (packages ?? []).filter((pkg) => {
      const remaining = pkg.total_days - pkg.days_used;
      if (filter === "low" && !(remaining > 0 && remaining <= 2)) return false;
      if (filter === "exhausted" && remaining > 0) return false;
      if (!packageMatchesTier(pkg, tierFilter)) return false;
      if (!packageMatchesSearch(pkg, searchQuery)) return false;
      return true;
    });
  }, [packages, filter, tierFilter, searchQuery]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3 min-w-0 flex-1">
          <h3 className="text-base font-semibold">Daycare packages</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter} onValueChange={(v) => setFilter(v as PkgFilter)}>
              <SelectTrigger className="h-8 w-48 text-xs" data-testid="daycare-packages-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All packages</SelectItem>
                <SelectItem value="low">Low credits (≤2 left)</SelectItem>
                <SelectItem value="exhausted">Exhausted</SelectItem>
              </SelectContent>
            </Select>
            {TIER_OPTIONS.map(({ value, label }) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={tierFilter === value ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setTierFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <Input
            placeholder="Search owner, pet, or package name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md h-9"
            data-testid="daycare-packages-search"
          />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="daycare-packages-export-btn"
            disabled={isLoading || !packages?.length}
            onClick={() => {
              if (!packages?.length) {
                toast.error("No packages to export.");
                return;
              }
              exportDaycarePackagesToExcel(packages);
              toast.success(`Exported ${packages.length} package${packages.length === 1 ? "" : "s"}.`);
            }}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Export Excel
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="daycare-new-package-btn"
            onClick={() => setSellOpen(true)}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Sell package
          </Button>
        </div>
      </div>

      {isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive">
          <p className="font-medium">Could not load packages</p>
          <p className="mt-1 text-destructive/90">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Package className="h-10 w-10 mb-3 opacity-40" />
          <p>No packages match these filters.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} />
          ))}
        </div>
      )}

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
            inputTestId="daycare-sell-package-owner"
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
        allowCustomDaycare
        categoryFilter="daycare"
        onClose={() => setSellOwnerId(undefined)}
        onSuccess={() => setSellOwnerId(undefined)}
      />
    </div>
  );
}
