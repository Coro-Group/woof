import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import TopBar from "@/components/dashboard/TopBar";
import { ownerDisplayName, createServiceInvoice } from "@/lib/bookingUtils";
import { buildDaycareTags, tagToneClass } from "@/lib/operationsTags";
import {
  TRANSPORT_PRICING_KEYS,
  TRANSPORT_ZONE_OPTIONS,
  type TransportZone,
  privateDubaiOverCapacity,
  transportPricingKey,
  transportQuantityForPets,
  transportZoneLabel,
} from "@/lib/transportPricing";
import {
  buildPriceMap,
  daycareGroupPricing,
} from "@/lib/servicePricing";
import { fetchDaycareCheckInPriceRows } from "@/lib/daycareCheckInPricing";
import { buildDaycareSingleDayLineItems } from "@/lib/daycareInvoiceLines";
import {
  netFromGrossInclusive,
  vatAmountFromGrossInclusive,
  vatLineLabel,
} from "@/lib/vatConfig";
import { formatAed } from "@/lib/money";
import {
  daycarePackageCreditLabel,
  daycarePackageExpiryLabel,
} from "@/lib/daycarePackageUtils";
import { daycarePackagePetDisplayTitle } from "@/lib/daycareSharedPool";
import { useOwner } from "@/hooks/useOwners";
import { OwnerClientSearch } from "@/components/OwnerClientSearch";
import { usePets } from "@/hooks/usePets";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useDaycarePackages,
  useConsumeServiceCredit,
  useSessionsByPackage,
  useAddDaycareDay,
  useUpdateDaycareSession,
  useRescheduleDaycareSession,
  useDeleteDaycareSession,
  useCancelDaycareCheckIn,
  type DaycarePackage,
  type SessionRow,
} from "@/hooks/useDaycare";
import { DaycarePackagesTab } from "@/components/daycare/DaycarePackagesTab";
import { CancelDaycareCheckInDialog } from "@/components/daycare/CancelDaycareCheckInDialog";
import { DaycareSessionInvoiceLink } from "@/components/daycare/DaycareSessionInvoiceLink";
import {
  CompleteHourlyBillingDialog,
  type HourlyBillingSession,
} from "@/components/daycare/CompleteHourlyBillingDialog";
import {
  composeNotesWithBillingPath,
  composeNotesWithHourlyInvoiced,
  parseDaycareBillingPath,
  visibleDaycareNotes,
  BILLING_PATH_PREFIX,
  resolveDaycareSessionInvoiceId,
  isDaycareHourlyPending,
  isSingleDayInvoiceMissing,
  isHourlyBillingInvoiced,
  isHourlyBillingDraft,
  enrichDaycareSessionInvoiceMap,
} from "@/lib/daycareSessionMeta";
import { findOrCreateHourlyDraft } from "@/lib/daycareHourlyDraftInvoice";
import { useDaycareSessionInvoiceMap } from "@/hooks/useDaycareSessionInvoiceMap";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { DogSizeField } from "@/components/DogSizeField";
import { DEFAULT_DOG_SIZE, type DogSizeFormValue } from "@/lib/dogSizeForm";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CalendarDays,
  Search,
  Printer,
  Plus,
  Pencil,
  Trash2,
  Check,
  ChevronsUpDown,
  X,
  Loader2,
  AlertTriangle,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

// ── Types ─────────────────────────────────────────────────────────────────────

// ── Constants ─────────────────────────────────────────────────────────────────

const TODAY = format(new Date(), "yyyy-MM-dd");

const LOGGED_BY_OPTIONS = [
  "Mariel",
  "Lilian",
  "Judy",
  "Darilyn",
  "Mitch",
  "Jovy",
  "Melissa",
] as const;

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

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }
  }
  return "Unknown error";
}

// ── Planner: SessionsTable ────────────────────────────────────────────────────

interface SessionsTableProps {
  sessions:  SessionRow[];
  packageId: string;
  packageIsExpired?: boolean;
  petId:     string;
  ownerId:   string;
  isLoading: boolean;
}

function SessionsTable({ sessions, packageId, packageIsExpired, petId, ownerId, isLoading }: SessionsTableProps) {
  const updateSession = useUpdateDaycareSession();
  const rescheduleSession = useRescheduleDaycareSession();
  const deleteSession = useDeleteDaycareSession();
  const addDay        = useAddDaycareDay();

  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editDraft,  setEditDraft]  = useState({ pickup_used: false, dropoff_used: false, logged_by: "", remark: "" });
  const [deleteId,   setDeleteId]   = useState<string | null>(null);
  const [addOpen,    setAddOpen]    = useState(false);
  const [addDraft,   setAddDraft]   = useState({ session_date: TODAY, pickup_used: false, dropoff_used: false, logged_by: "", remark: "" });
  const [dateEditSession, setDateEditSession] = useState<SessionRow | null>(null);
  const [dateEditValue, setDateEditValue] = useState("");

  const startEdit = (s: SessionRow) => {
    setEditingId(s.id);
    setEditDraft({
      pickup_used:  s.pickup_used  ?? false,
      dropoff_used: s.dropoff_used ?? false,
      logged_by:    s.logged_by    ?? "",
      remark:       s.notes        ?? "",
    });
  };

  const commitEdit = () => {
    if (!editingId) return;
    updateSession.mutate({
      sessionId:    editingId,
      pickup_used:  editDraft.pickup_used,
      dropoff_used: editDraft.dropoff_used,
      logged_by:    editDraft.logged_by  || null,
      remark:       editDraft.remark     || null,
    }, {
      onSuccess: () => { toast.success("Session updated"); setEditingId(null); },
      onError:   (err) => toast.error(err.message),
    });
  };

  const submitAdd = () => {
    addDay.mutate({
      session_date: addDraft.session_date,
      pet_id:       petId,
      owner_id:     ownerId,
      package_id:   packageId,
      credit_units: 1,
      allow_expired_credit: packageIsExpired,
      pickup_used:  addDraft.pickup_used,
      dropoff_used: addDraft.dropoff_used,
      logged_by:    addDraft.logged_by || null,
      remark:       addDraft.remark    || null,
    }, {
      onSuccess: () => {
        if (packageIsExpired) {
          toast.warning("Day added using an expired package — confirm with the client.");
        } else {
          toast.success("Day added");
        }
        setAddOpen(false);
        setAddDraft({ session_date: TODAY, pickup_used: false, dropoff_used: false, logged_by: "", remark: "" });
      },
      onError: (err) => toast.error(err.message),
    });
  };

  if (isLoading) {
    return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  }

  return (
    <>
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead className="min-w-[140px]">Date</TableHead>
              <TableHead className="text-center w-20">Pickup</TableHead>
              <TableHead className="text-center w-20">Drop-off</TableHead>
              <TableHead className="min-w-[110px]">By</TableHead>
              <TableHead className="min-w-[150px]">Remark</TableHead>
              <TableHead className="w-10"></TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {sessions.length === 0 && !addOpen && (
              <TableRow>
                <TableCell colSpan={8} className="h-20 text-center text-sm text-muted-foreground">
                  No sessions recorded yet
                </TableCell>
              </TableRow>
            )}

            {sessions.map((s, idx) => {
              const isEditing = editingId === s.id;
              return (
                <TableRow key={s.id} className={isEditing ? "bg-muted/20" : ""}>
                  {/* # */}
                  <TableCell className="text-center text-xs text-muted-foreground">{idx + 1}</TableCell>

                  {/* Date + reschedule */}
                  <TableCell className="text-sm whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <span>{format(parseISO(s.session_date), "d MMM yyyy")}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                        title="Change session date"
                        disabled={isEditing}
                        onClick={() => {
                          setDateEditSession(s);
                          setDateEditValue(s.session_date);
                        }}
                      >
                        <CalendarDays className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>

                  {/* Pickup */}
                  <TableCell className="text-center">
                    {isEditing ? (
                      <Checkbox
                        checked={editDraft.pickup_used}
                        onCheckedChange={(v) => setEditDraft(d => ({ ...d, pickup_used: v === true }))}
                      />
                    ) : s.pickup_used ? (
                      <Check className="h-4 w-4 text-emerald-600 mx-auto" />
                    ) : null}
                  </TableCell>

                  {/* Drop-off */}
                  <TableCell className="text-center">
                    {isEditing ? (
                      <Checkbox
                        checked={editDraft.dropoff_used}
                        onCheckedChange={(v) => setEditDraft(d => ({ ...d, dropoff_used: v === true }))}
                      />
                    ) : s.dropoff_used ? (
                      <Check className="h-4 w-4 text-emerald-600 mx-auto" />
                    ) : null}
                  </TableCell>

                  {/* By */}
                  <TableCell>
                    {isEditing ? (
                      <Input
                        value={editDraft.logged_by}
                        onChange={(e) => setEditDraft(d => ({ ...d, logged_by: e.target.value }))}
                        className="h-7 text-xs"
                        placeholder="Name"
                      />
                    ) : (
                      <span className="text-sm">{s.logged_by || <span className="text-muted-foreground">—</span>}</span>
                    )}
                  </TableCell>

                  {/* Remark */}
                  <TableCell>
                    {isEditing ? (
                      <Input
                        value={editDraft.remark}
                        onChange={(e) => setEditDraft(d => ({ ...d, remark: e.target.value }))}
                        className="h-7 text-xs"
                        placeholder="Remark"
                      />
                    ) : (
                      <span className="text-sm">{s.notes || <span className="text-muted-foreground">—</span>}</span>
                    )}
                  </TableCell>

                  {/* Edit / Save */}
                  <TableCell>
                    {isEditing ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-50"
                          disabled={updateSession.isPending}
                          onClick={commitEdit}
                        >
                          {updateSession.isPending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Check className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => startEdit(s)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>

                  {/* Delete */}
                  <TableCell>
                    {!isEditing && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteId(s.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}

            {/* Add Day row */}
            {addOpen ? (
              <TableRow className="bg-emerald-50/50">
                <TableCell className="text-center text-xs text-muted-foreground">+</TableCell>
                <TableCell>
                  <Input
                    type="date"
                    value={addDraft.session_date}
                    onChange={(e) => setAddDraft(d => ({ ...d, session_date: e.target.value }))}
                    className="h-7 text-xs w-36"
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={addDraft.pickup_used}
                    onCheckedChange={(v) => setAddDraft(d => ({ ...d, pickup_used: v === true }))}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={addDraft.dropoff_used}
                    onCheckedChange={(v) => setAddDraft(d => ({ ...d, dropoff_used: v === true }))}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={addDraft.logged_by}
                    onChange={(e) => setAddDraft(d => ({ ...d, logged_by: e.target.value }))}
                    className="h-7 text-xs"
                    placeholder="Name"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={addDraft.remark}
                    onChange={(e) => setAddDraft(d => ({ ...d, remark: e.target.value }))}
                    className="h-7 text-xs"
                    placeholder="Remark"
                  />
                </TableCell>
                <TableCell colSpan={2}>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                      disabled={addDay.isPending}
                      onClick={submitAdd}
                    >
                      {addDay.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setAddOpen(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              <TableRow className="border-t-2 border-dashed border-muted">
                <TableCell colSpan={8}>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                    onClick={() => setAddOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Day
                  </button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={!!dateEditSession}
        onOpenChange={(open) => {
          if (!open) {
            setDateEditSession(null);
            setDateEditValue("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change session date</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Use this when the visit was cancelled or moved to another day. Package day counts are
              unchanged.
            </p>
            <div className="space-y-2">
              <Label htmlFor="reschedule-session-date">Session date</Label>
              <Input
                id="reschedule-session-date"
                type="date"
                value={dateEditValue}
                onChange={(e) => setDateEditValue(e.target.value)}
                className="w-full max-w-[240px]"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDateEditSession(null);
                setDateEditValue("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                !dateEditSession ||
                !dateEditValue ||
                rescheduleSession.isPending
              }
              onClick={() => {
                if (!dateEditSession || !dateEditValue.trim()) return;
                rescheduleSession.mutate(
                  {
                    sessionId: dateEditSession.id,
                    petId,
                    session_date: dateEditValue.trim(),
                  },
                  {
                    onSuccess: () => {
                      toast.success("Session date updated");
                      setDateEditSession(null);
                      setDateEditValue("");
                    },
                    onError: (err) =>
                      toast.error(
                        err instanceof Error ? err.message : "Could not update date",
                      ),
                  },
                );
              }}
            >
              {rescheduleSession.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CancelDaycareCheckInDialog
        open={!!deleteId}
        sessionId={deleteId}
        pending={deleteSession.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        onConfirm={async ({ sessionId, reason, staff }) => {
          await deleteSession.mutateAsync({ sessionId, package_id: packageId, reason, staff });
          toast.success("Check-in cancelled");
          setDeleteId(null);
        }}
      />
    </>
  );
}

// ── TAB 1: PlannerTab ─────────────────────────────────────────────────────────

function syncPlannerSearchParams(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  owner: string | null,
  pkg: string | null
) {
  setSearchParams(
    (prev) => {
      const n = new URLSearchParams(prev);
      n.set("tab", "planner");
      if (owner) n.set("ownerId", owner);
      else n.delete("ownerId");
      if (pkg) n.set("packageId", pkg);
      else n.delete("packageId");
      return n;
    },
    { replace: true }
  );
}

function PlannerTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerIdParam = searchParams.get("ownerId");
  const packageIdParam = searchParams.get("packageId");

  const [ownerId, setOwnerId] = useState<string | null>(ownerIdParam);
  const [packageId, setPackageId] = useState<string | null>(packageIdParam);
  const [selectedPetIds, setSelectedPetIds] = useState<string[]>([]);
  const [billingChoiceByPet, setBillingChoiceByPet] = useState<Record<string, string>>({});
  const [skipInvoiceDiscount, setSkipInvoiceDiscount] = useState(false);
  const [checkInDraft, setCheckInDraft] = useState({
    session_date: TODAY,
    pickup_used: false,
    dropoff_used: false,
    transport_zone: "dubai_shared" as TransportZone,
    logged_by: "",
    remark: "",
    dog_size: DEFAULT_DOG_SIZE as DogSizeFormValue,
  });
  const [isSubmittingCheckIn, setIsSubmittingCheckIn] = useState(false);

  useEffect(() => {
    setOwnerId(ownerIdParam);
    setPackageId(packageIdParam);
  }, [ownerIdParam, packageIdParam]);

  const { data: ownerFromUrl, isLoading: ownerDetailLoading } = useOwner(
    ownerId ?? ""
  );

  const resolvedOwnerLabel =
    ownerFromUrl?.id === ownerId
      ? ownerDisplayName(ownerFromUrl.first_name, ownerFromUrl.last_name)
      : null;

  const { data: pets } = usePets(ownerId ?? "");
  const { data: packages } = useDaycarePackages(ownerId ?? "");
  const selectedPkg = packages?.find((p) => p.id === packageId) ?? null;
  const addDay = useAddDaycareDay();
  const consumeCredit = useConsumeServiceCredit();
  const { data: sessions, isLoading: sessionsLoading } = useSessionsByPackage(
    packageId ?? "",
    selectedPkg?.pet_id,
  );
  const { data: pricingRows = [] } = useQuery<{ key: string; amount_aed: number }[]>({
    queryKey: ["pricing", "daycare_checkin"],
    queryFn: () => fetchDaycareCheckInPriceRows(supabase),
  });
  const { data: transportPricingRows = [] } = useQuery<{ key: string; amount_aed: number }[]>({
    queryKey: ["pricing", "transport_zones", "daycare"],
    queryFn: async () => {
      return (TRANSPORT_PRICING_KEYS as readonly string[]).map((key) => ({
        key,
        amount_aed: 0,
      }));
    },
  });

  const selectedPet = pets?.find((p) => p.id === selectedPkg?.pet_id) ?? null;

  const pickupsUsed = sessions?.filter((s) => s.pickup_used).length ?? 0;
  const dropoffsUsed = sessions?.filter((s) => s.dropoff_used).length ?? 0;
  const daycarePriceMap = useMemo(() => buildPriceMap(pricingRows), [pricingRows]);
  const singleDayPetIds = useMemo(
    () => selectedPetIds.filter((id) => (billingChoiceByPet[id] ?? "hourly") === "single"),
    [selectedPetIds, billingChoiceByPet],
  );
  const hourlyPetIds = useMemo(
    () => selectedPetIds.filter((id) => (billingChoiceByPet[id] ?? "hourly") === "hourly"),
    [selectedPetIds, billingChoiceByPet],
  );
  const singleDayCount = singleDayPetIds.length;
  const hourlyCount = hourlyPetIds.length;
  /** Pets checked in on single-day billing (immediate invoice at check-in). */
  const immediateInvoicePetCount = singleDayCount;
  /** Pets physically checking in on single-day or hourly (drives transport capacity). */
  const physicalInvoicePetCount = singleDayCount + hourlyCount;

  const singleDayRatePreview = useMemo(
    () => daycareGroupPricing(singleDayCount, daycarePriceMap),
    [singleDayCount, daycarePriceMap],
  );
  const singleDayPricingInvalid =
    singleDayCount > 0 &&
    (singleDayRatePreview.total <= 0 || !singleDayRatePreview.pricingKey);
  const transportRate = useMemo(() => {
    const key = transportPricingKey(checkInDraft.transport_zone);
    return transportPricingRows.find((r) => r.key === key)?.amount_aed ?? 0;
  }, [transportPricingRows, checkInDraft.transport_zone]);
  const transportTrips = [checkInDraft.pickup_used, checkInDraft.dropoff_used].filter(Boolean).length;
  const previewTransportQty = immediateInvoicePetCount
    ? transportQuantityForPets(checkInDraft.transport_zone, immediateInvoicePetCount)
    : 0;
  const previewTransportTotal = transportRate * previewTransportQty * transportTrips;
  const immediateInvoiceSubtotalPreview =
    singleDayRatePreview.total + previewTransportTotal;
  const { data: discountPreview, isLoading: discountPreviewLoading } = useQuery<{
    discount_pct: number;
    discount_aed: number;
    final_aed: number;
  }>({
    queryKey: [
      "daycare",
      "checkin-preview-discount",
      ownerId,
      immediateInvoiceSubtotalPreview,
      skipInvoiceDiscount,
    ],
    enabled:
      !!ownerId &&
      immediateInvoicePetCount > 0 &&
      immediateInvoiceSubtotalPreview > 0 &&
      !skipInvoiceDiscount,
    queryFn: async () => {
      return {
        discount_pct: 0,
        discount_aed: 0,
        final_aed: immediateInvoiceSubtotalPreview,
      };
    },
  });

  const daycareInvoiceNetExVatPreview = useMemo(() => {
    if (immediateInvoicePetCount === 0 || immediateInvoiceSubtotalPreview <= 0) return null;
    if (skipInvoiceDiscount) return immediateInvoiceSubtotalPreview;
    if (discountPreviewLoading) return immediateInvoiceSubtotalPreview;
    return discountPreview?.final_aed ?? immediateInvoiceSubtotalPreview;
  }, [
    immediateInvoicePetCount,
    immediateInvoiceSubtotalPreview,
    skipInvoiceDiscount,
    discountPreviewLoading,
    discountPreview?.final_aed,
  ]);

  useEffect(() => {
    if (!packageId || !packages?.length) return;
    if (!packages.some((p) => p.id === packageId)) {
      setPackageId(null);
      syncPlannerSearchParams(setSearchParams, ownerId, null);
    }
  }, [packages, packageId, ownerId, setSearchParams]);

  const getUsablePackagesForPet = useCallback((petId: string) => {
    return (packages ?? []).filter((pkg) => {
      if (pkg.is_bonus) return false;
      if ((pkg.days_used ?? 0) >= (pkg.total_days ?? 0)) return false;
      if (pkg.is_shared_pool) return true;
      return pkg.pet_id === petId;
    });
  }, [packages]);

  useEffect(() => {
    setBillingChoiceByPet((prev) => {
      const next: Record<string, string> = {};
      for (const petId of selectedPetIds) {
        const usable = getUsablePackagesForPet(petId);
        const prevChoice = prev[petId];
        if (
          prevChoice === "single" ||
          prevChoice === "hourly" ||
          usable.some((pkg) => pkg.id === prevChoice)
        ) {
          next[petId] = prevChoice;
        } else if (usable.length > 0) {
          next[petId] = usable[0].id;
        } else {
          next[petId] = "hourly";
        }
      }
      return next;
    });
  }, [selectedPetIds, getUsablePackagesForPet]);

  const handleOwnerSelect = (id: string, _label: string) => {
    setOwnerId(id);
    setPackageId(null);
    setSelectedPetIds([]);
    setBillingChoiceByPet({});
    syncPlannerSearchParams(setSearchParams, id, null);
  };

  const handleOwnerClear = () => {
    setOwnerId(null);
    setPackageId(null);
    setSelectedPetIds([]);
    setBillingChoiceByPet({});
    syncPlannerSearchParams(setSearchParams, null, null);
  };

  function pkgLabel(pkg: DaycarePackage) {
    const expiredSuffix = pkg.is_expired && pkg.expiry_date
      ? ` · expired ${daycarePackageExpiryLabel(pkg.expiry_date)}`
      : "";
    const title = daycarePackagePetDisplayTitle({
      is_shared_pool: pkg.is_shared_pool,
      shared_pool_pets_label: pkg.shared_pool_pets_label,
      anchor_pet_name: pkg.anchor_pet_name,
      pet_name: pets?.find((p) => p.id === pkg.pet_id)?.name ?? null,
    });
    return `${title} — ${pkg.days_used}/${pkg.total_days}${expiredSuffix}`;
  }

  const expiredPackageSelections = useMemo(() => {
    if (!packages?.length || selectedPetIds.length === 0) return [];
    return selectedPetIds.flatMap((petId) => {
      const choice = billingChoiceByPet[petId];
      const pkg = packages.find((p) => p.id === choice);
      if (!pkg?.is_expired) return [];
      const petName = pets?.find((p) => p.id === petId)?.name ?? "Pet";
      return [{ petId, petName, pkg }];
    });
  }, [billingChoiceByPet, packages, pets, selectedPetIds]);

  const togglePetSelection = (petId: string, checked: boolean) => {
    setSelectedPetIds((prev) => {
      if (checked) {
        if (prev.includes(petId)) return prev;
        return [...prev, petId];
      }
      return prev.filter((id) => id !== petId);
    });
  };

  const handleCheckInSelected = async () => {
    if (!ownerId) {
      toast.error("Select a client first");
      return;
    }
    if (selectedPetIds.length === 0) {
      toast.error("Select at least one dog");
      return;
    }
    if (singleDayPricingInvalid) {
      toast.error(
        "Daycare single-day rate is missing or invalid. Check the Live Rate Card (2-dog and 3-dog rates).",
      );
      return;
    }

    if (
      (checkInDraft.pickup_used || checkInDraft.dropoff_used) &&
      privateDubaiOverCapacity(checkInDraft.transport_zone, selectedPetIds.length)
    ) {
      toast.error(
        "Private Dubai transport is capped at 3 dogs. Split the group or choose Dubai — Shared.",
      );
      return;
    }

    setIsSubmittingCheckIn(true);
    const failures: string[] = [];
    let successCount = 0;
    const sessionsCreated: Record<string, string> = {};
    const sessionNotes: Record<string, string | null> = {};
    const consumedCreditByPet: Record<string, DaycarePackage> = {};
    const successfullyCreditCovered: string[] = [];
    const expiredPackageUsed: string[] = [];
    const fallbackSingleIds: string[] = [];
    const privateFlat = checkInDraft.transport_zone === "dubai_private";

    for (const petId of selectedPetIds) {
      const pet = pets?.find((p) => p.id === petId);
      const petName = pet?.name ?? "Pet";
      const choice = billingChoiceByPet[petId] ?? "hourly";
      const isHourlyBilling = choice === "hourly";
      const chosenPackageId = choice === "single" || isHourlyBilling ? null : choice;
      const chosenCredit = chosenPackageId ? packages?.find((pkg) => pkg.id === chosenPackageId) : null;
      const billingPath =
        !chosenPackageId && choice === "single"
          ? "single"
          : !chosenPackageId && isHourlyBilling
            ? "hourly"
            : null;

      try {
        const session = await addDay.mutateAsync({
          session_date: checkInDraft.session_date,
          pet_id: petId,
          owner_id: ownerId,
          package_id: chosenPackageId,
          billing_path: billingPath,
          pickup_used: checkInDraft.pickup_used,
          dropoff_used: checkInDraft.dropoff_used,
          logged_by: checkInDraft.logged_by || null,
          remark: checkInDraft.remark || null,
          dog_size: checkInDraft.dog_size,
        });

        sessionsCreated[petId] = session.id;
        sessionNotes[petId] = session.notes ?? null;
        successCount += 1;

        if (chosenCredit) {
          const consumeUnits = 1;
          try {
            await consumeCredit.mutateAsync({
              creditId: chosenCredit.id,
              units: consumeUnits,
              consumedForRefId: session.id,
              consumedForRefType: "daycare_session",
              allowExpired: chosenCredit.is_expired,
            });
            consumedCreditByPet[petId] = chosenCredit;
            successfullyCreditCovered.push(petId);
            if (chosenCredit.is_expired) {
              expiredPackageUsed.push(petName);
            }
          } catch (error) {
            const message = extractErrorMessage(error);
            failures.push(`${petName}: credit consumption failed (${message}); charging this check-in instead`);
            if (chosenCredit.service_code === "daycare_hourly") {
              try {
                await supabase
                  .from("daycare_sessions")
                  .update({
                    package_id: null,
                    notes: composeNotesWithBillingPath(session.notes, "hourly"),
                  })
                  .eq("id", session.id);
              } catch (updateErr) {
                failures.push(
                  `${petName}: could not switch to hourly billing (${extractErrorMessage(updateErr)})`,
                );
              }
            } else {
              fallbackSingleIds.push(petId);
            }
          }
        }
      } catch (error) {
        const message = extractErrorMessage(error);
        failures.push(`${petName}: ${message}`);
      }
    }

    const okSingleIds = [
      ...singleDayPetIds.filter((id) => sessionsCreated[id]),
      ...fallbackSingleIds,
    ];
    const okCreditIds = successfullyCreditCovered.filter((id) => sessionsCreated[id]);
    const invoicedPetTotal = okSingleIds.length + okCreditIds.length;

    if (invoicedPetTotal > 0) {
      const zoneLabel = transportZoneLabel(checkInDraft.transport_zone);
      const transportKey = transportPricingKey(checkInDraft.transport_zone);
      const lineItems: {
        description: string;
        quantity: number;
        unitPrice: number;
        pricingKey?: string;
        serviceType?: string;
        preserveUnitPrice?: boolean;
      }[] = [];

      if (okSingleIds.length > 0) {
        const petRows = okSingleIds.map((id) => ({
          id,
          name: pets?.find((p) => p.id === id)?.name ?? "Pet",
        }));
        lineItems.push(
          ...buildDaycareSingleDayLineItems({
            petIds: okSingleIds,
            pets: petRows,
            sessionDate: checkInDraft.session_date,
            prices: daycarePriceMap,
          }),
        );
      }
      if (okCreditIds.length > 0) {
        for (const petId of okCreditIds) {
          const petName = pets?.find((p) => p.id === petId)?.name ?? "Pet";
          const credit = consumedCreditByPet[petId];
          const packageName = credit?.package_name ?? "package credit";
          const creditKind =
            credit?.service_code === "daycare_hourly"
              ? "Daycare hourly"
              : credit?.service_code === "daycare_half_day"
                ? "Daycare half day"
                : "Daycare full day";
          lineItems.push({
            description: `${creditKind} — ${petName} (covered by ${packageName})`,
            quantity: 1,
            unitPrice: 0,
            serviceType: "daycare",
            preserveUnitPrice: true,
          });
        }
      }

      const includePickup = checkInDraft.pickup_used;
      const includeDropoff = checkInDraft.dropoff_used;
      const billTransport = checkInDraft.transport_zone !== "complimentary";
      const transportQty = billTransport
        ? transportQuantityForPets(checkInDraft.transport_zone, invoicedPetTotal)
        : 0;

      if (billTransport && includePickup) {
        lineItems.push({
          description: privateFlat
            ? `Pickup transport (${zoneLabel}) — family flat rate`
            : `Pickup transport (${zoneLabel})`,
          quantity: transportQty,
          unitPrice: transportRate,
          pricingKey: transportKey,
          serviceType: "transport",
        });
      }
      if (billTransport && includeDropoff) {
        lineItems.push({
          description: privateFlat
            ? `Drop-off transport (${zoneLabel}) — family flat rate`
            : `Drop-off transport (${zoneLabel})`,
          quantity: transportQty,
          unitPrice: transportRate,
          pricingKey: transportKey,
          serviceType: "transport",
        });
      }

      const referencePetId =
        selectedPetIds.find((id) => sessionsCreated[id] && okSingleIds.includes(id)) ??
        selectedPetIds.find((id) => sessionsCreated[id]);
      const referenceSessionId = referencePetId ? sessionsCreated[referencePetId] : null;

      if (referenceSessionId && lineItems.length > 0) {
        try {
          const invoiceId = await createServiceInvoice({
            ownerId,
            serviceType: "daycare",
            referenceId: referenceSessionId,
            lineItems,
            notes: checkInDraft.remark || null,
            // draft — payment collected at checkout via CompleteHourlyBillingDialog
            invoiceStatus: "draft",
            skipMemberDiscount: skipInvoiceDiscount,
            checkInDate: checkInDraft.session_date,
          });

          // Link sibling single-day sessions to the same invoice (primary uses service_id).
          const siblingPetIds = okSingleIds.filter(
            (petId) => sessionsCreated[petId] && sessionsCreated[petId] !== referenceSessionId,
          );
          if (siblingPetIds.length > 0) {
            await Promise.all(
              siblingPetIds.map(async (petId) => {
                const sessionId = sessionsCreated[petId];
                const { error } = await supabase
                  .from("daycare_sessions")
                  .update({
                    notes: composeNotesWithHourlyInvoiced(sessionNotes[petId] ?? null, invoiceId),
                  })
                  .eq("id", sessionId);
                if (error) throw error;
              }),
            );
          }
        } catch (error) {
          const message = extractErrorMessage(error);
          toast.error(`Invoice failed: ${message}`);
        }
      }
    }

    // ── Draft invoice for hourly dogs ─────────────────────────────────────
    const okHourlyIds = hourlyPetIds.filter((id) => sessionsCreated[id]);
    if (okHourlyIds.length > 0) {
      const zoneLabel = transportZoneLabel(checkInDraft.transport_zone);
      const transportKey = transportPricingKey(checkInDraft.transport_zone);
      const billTransport = checkInDraft.transport_zone !== "complimentary";
      // Only put transport on the hourly draft when there are no single-day dogs
      // in this batch — if single-day dogs exist, transport is already on their invoice.
      const hourlyTransportQty =
        billTransport && okSingleIds.length === 0
          ? transportQuantityForPets(checkInDraft.transport_zone, okHourlyIds.length)
          : 0;

      try {
        await findOrCreateHourlyDraft({
          ownerId,
          sessionDate: checkInDraft.session_date,
          sessions: okHourlyIds.map((id) => ({
            id: sessionsCreated[id],
            notes: sessionNotes[id] ?? null,
            petName: pets?.find((p) => p.id === id)?.name ?? "Pet",
          })),
          transport: {
            pickupUsed: checkInDraft.pickup_used,
            dropoffUsed: checkInDraft.dropoff_used,
            skip: okSingleIds.length > 0 || hourlyTransportQty === 0,
            qty: hourlyTransportQty,
            rate: transportRate,
            pricingKey: transportKey,
            zoneLabel,
            isPrivateFlat: privateFlat,
          },
        });
      } catch (error) {
        const message = extractErrorMessage(error);
        toast.error(`Draft invoice failed: ${message}. Check-in was saved — invoice can be added from Billing.`);
      }
    }

    setIsSubmittingCheckIn(false);

    if (successCount > 0) {
      toast.success(`Checked in ${successCount} dog${successCount !== 1 ? "s" : ""}`);
      if (expiredPackageUsed.length > 0) {
        toast.warning(
          `Used expired package for ${expiredPackageUsed.join(", ")} — confirm with the client before redeeming further credits.`,
        );
      }
      setSelectedPetIds([]);
      setBillingChoiceByPet({});
      setSkipInvoiceDiscount(false);
      setCheckInDraft((prev) => ({
        ...prev,
        pickup_used: false,
        dropoff_used: false,
        logged_by: "",
        remark: "",
        dog_size: DEFAULT_DOG_SIZE,
      }));
    }

    if (failures.length > 0) {
      toast.error(`Some check-ins failed: ${failures.join(" | ")}`);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Package planner</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pick a client and package to view or edit session dates (including past days) — no check-in
            required.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1 max-w-xl">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Client</Label>
            <OwnerClientSearch
              selectedId={
                ownerId && (resolvedOwnerLabel || ownerDetailLoading) ? ownerId : null
              }
              selectedLabel={ownerDetailLoading ? "Loading…" : resolvedOwnerLabel}
              onSelect={handleOwnerSelect}
              onClear={handleOwnerClear}
              placeholder="Search by client name, pet name, or phone…"
              inputTestId="daycare-planner-owner-search"
              optionTestIdPrefix="daycare-owner-option"
              className="h-9"
            />
          </div>
          <div className="max-w-xl space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Package</Label>
            <Select
              value={packageId ?? ""}
              onValueChange={(pid) => {
                setPackageId(pid);
                syncPlannerSearchParams(setSearchParams, ownerId, pid);
              }}
              disabled={!ownerId || !packages?.length}
            >
              <SelectTrigger className="h-9" data-testid="daycare-planner-package-select">
                <SelectValue
                  placeholder={
                    !ownerId
                      ? "Select a client first"
                      : packages?.length
                        ? "Select package"
                        : "No active packages"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {packages?.map((pkg) => (
                  <SelectItem key={pkg.id} value={pkg.id}>
                    {pkgLabel(pkg)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!packageId && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Package className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">Select a client and package to open the planner</p>
        </div>
      )}

      {packageId && selectedPkg && (
        <>
          {selectedPkg.is_expired && (
            <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-950 [&>svg]:text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Expired package</AlertTitle>
              <AlertDescription>
                This package expired{" "}
                {selectedPkg.expiry_date
                  ? daycarePackageExpiryLabel(selectedPkg.expiry_date)
                  : "before today"}
                . You can still add days, but confirm with the client first.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-start justify-between gap-4">
            <Card className="flex-1">
              <CardContent className="pt-5 pb-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-4">
                  {[
                    { label: "Client", value: resolvedOwnerLabel },
                    {
                      label: selectedPkg.is_shared_pool ? "Dogs (shared)" : "Dog",
                      value: selectedPkg.is_shared_pool
                        ? selectedPkg.shared_pool_pets_label ?? selectedPet?.name
                        : selectedPet?.name,
                    },
                    {
                      label: "Day Care Days",
                      value: `${selectedPkg.days_used} / ${selectedPkg.total_days}`,
                    },
                    { label: "Pickups Used", value: String(pickupsUsed) },
                    { label: "Drop-offs Used", value: String(dropoffsUsed) },
                  ].map(({ label, value }) => (
                    <div key={label} className="space-y-0.5">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                        {label}
                      </p>
                      <p className="text-sm font-semibold">{value ?? "—"}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Button variant="outline" size="sm" onClick={() => window.print()} className="shrink-0">
              <Printer className="mr-1.5 h-4 w-4" />
              Print
            </Button>
          </div>
          <SessionsTable
            sessions={sessions ?? []}
            packageId={packageId}
            packageIsExpired={selectedPkg.is_expired}
            petId={selectedPkg.pet_id}
            ownerId={selectedPkg.owner_id}
            isLoading={sessionsLoading}
          />
        </>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Daycare Check-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Search owner or dog</Label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[12rem] flex-1">
                <OwnerClientSearch
                  selectedId={
                    ownerId && (resolvedOwnerLabel || ownerDetailLoading)
                      ? ownerId
                      : null
                  }
                  selectedLabel={
                    ownerDetailLoading
                      ? "Loading…"
                      : resolvedOwnerLabel
                  }
                  onSelect={handleOwnerSelect}
                  onClear={handleOwnerClear}
                  placeholder="Search by client name, pet name, or phone…"
                  inputTestId="daycare-pet-search"
                  optionTestIdPrefix="daycare-owner-option"
                  className="h-9"
                />
              </div>
              {ownerFromUrl &&
              ownerFromUrl.id === ownerId &&
              null}
            </div>
          </div>

          {!!ownerId && (
            <>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Select dog(s)</Label>
                {!pets?.length ? (
                  <p className="text-sm text-muted-foreground">No pets found for this client.</p>
                ) : (
                  <div className="rounded-lg border divide-y">
                    {pets.map((pet) => {
                      const checked = selectedPetIds.includes(pet.id);
                      const usablePackages = getUsablePackagesForPet(pet.id);
                      return (
                        <div key={pet.id} className="p-3 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`checkin_pet_${pet.id}`}
                                checked={checked}
                                onCheckedChange={(v) => togglePetSelection(pet.id, v === true)}
                              />
                              <Label htmlFor={`checkin_pet_${pet.id}`} className="font-medium">
                                {pet.name}
                              </Label>
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                usablePackages.length > 0
                                  ? usablePackages.some((pkg) => pkg.is_expired)
                                    ? "bg-amber-50 text-amber-800 border-amber-200"
                                    : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : ""
                              }
                            >
                              {usablePackages.length > 0
                                ? usablePackages.some((pkg) => pkg.is_expired)
                                  ? `${usablePackages.length} package${usablePackages.length !== 1 ? "s" : ""} (includes expired)`
                                  : `${usablePackages.length} active package${usablePackages.length !== 1 ? "s" : ""}`
                                : "No active package"}
                            </Badge>
                          </div>

                          {checked && (
                            <div className="pl-6 max-w-md space-y-1">
                              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Billing path</Label>
                              <Select
                                value={billingChoiceByPet[pet.id] ?? (usablePackages[0]?.id ?? "hourly")}
                                onValueChange={(value) => {
                                  setBillingChoiceByPet((prev) => ({ ...prev, [pet.id]: value }));
                                }}
                              >
                                <SelectTrigger
                                  data-testid={`daycare-use-credit-toggle-${pet.id}`}
                                  className="h-8"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="hourly">Hourly (invoice at checkout)</SelectItem>
                                  <SelectItem value="single">Single day (invoice now)</SelectItem>
                                  {usablePackages.map((pkg) => (
                                    <SelectItem key={pkg.id} value={pkg.id}>
                                      {daycarePackageCreditLabel(pkg)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {hourlyCount > 0 && (
                <p className="text-sm text-muted-foreground rounded-lg border bg-muted/20 px-3 py-2 max-w-xl">
                  {hourlyCount} dog{hourlyCount === 1 ? "" : "s"} on hourly billing — invoice when you complete
                  hourly billing from Operations.
                </p>
              )}

              <DogSizeField
                name="daycare-checkin-dog-size"
                value={checkInDraft.dog_size}
                onChange={(v) => setCheckInDraft((prev) => ({ ...prev, dog_size: v }))}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="checkin_session_date">Date</Label>
                  <Input
                    id="checkin_session_date"
                    type="date"
                    value={checkInDraft.session_date}
                    onChange={(e) => setCheckInDraft((prev) => ({ ...prev, session_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="checkin_logged_by">Logged by</Label>
                  <Select
                    value={checkInDraft.logged_by || undefined}
                    onValueChange={(v) => setCheckInDraft((prev) => ({ ...prev, logged_by: v }))}
                  >
                    <SelectTrigger id="checkin_logged_by">
                      <SelectValue placeholder="Select staff" />
                    </SelectTrigger>
                    <SelectContent>
                      {LOGGED_BY_OPTIONS.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Transport options</Label>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="checkin_pickup"
                      checked={checkInDraft.pickup_used}
                      onCheckedChange={(v) => setCheckInDraft((prev) => ({ ...prev, pickup_used: v === true }))}
                    />
                    <Label htmlFor="checkin_pickup" className="text-sm">Pickup</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="checkin_dropoff"
                      checked={checkInDraft.dropoff_used}
                      onCheckedChange={(v) => setCheckInDraft((prev) => ({ ...prev, dropoff_used: v === true }))}
                    />
                    <Label htmlFor="checkin_dropoff" className="text-sm">Drop-off</Label>
                  </div>
                </div>
                {(checkInDraft.pickup_used || checkInDraft.dropoff_used) && (
                  <div className="max-w-xs space-y-1.5">
                    <Label>Transport option</Label>
                    <Select
                      value={checkInDraft.transport_zone}
                      onValueChange={(value) => setCheckInDraft((prev) => ({
                        ...prev,
                        transport_zone: value as TransportZone,
                      }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSPORT_ZONE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(() => {
                      const zone = checkInDraft.transport_zone;
                      const pets = Math.max(1, physicalInvoicePetCount || selectedPetIds.length);
                      const opt = TRANSPORT_ZONE_OPTIONS.find((o) => o.value === zone);
                      const over = privateDubaiOverCapacity(zone, pets);
                      const trips = transportTrips;
                      const qty = transportQuantityForPets(zone, pets);
                      const total = transportRate * qty * Math.max(1, trips);
                      if (zone === "complimentary") {
                        return (
                          <p className="text-xs text-muted-foreground">
                            Complimentary transport — no charge and no transport lines on the invoice.
                          </p>
                        );
                      }
                      return (
                        <>
                          <p className="text-xs text-muted-foreground">
                            {formatAed(transportRate)} × {qty}
                            {zone === "dubai_private" ? " (flat per trip)" : " per dog"}
                            {opt ? ` — ${opt.helper}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Estimated total: {formatAed(total)} ({trips || 1} trip{trips === 1 ? "" : "s"})
                          </p>
                          {over && (
                            <p className="text-xs text-destructive">
                              Private is capped at 3 dogs. Switch to Shared or split the group.
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {selectedPetIds.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Auto pricing preview
                  </p>
                  {physicalInvoicePetCount === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No immediate invoice — all selected pets are using package credits or hourly billing.
                    </p>
                  ) : immediateInvoicePetCount === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No immediate invoice — hourly billing is completed from Operations when the dogs leave.
                    </p>
                  ) : (
                    <>
                      {singleDayCount > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span>
                            {singleDayRatePreview.label} ({singleDayCount} dog
                            {singleDayCount === 1 ? "" : "s"})
                          </span>
                          <span>{formatAed(singleDayRatePreview.total)}</span>
                        </div>
                      )}
                      {singleDayPricingInvalid && (
                        <p className="text-sm text-destructive">
                          Single-day rate is missing or invalid — check the Live Rate Card before check-in.
                        </p>
                      )}
                      {(checkInDraft.pickup_used || checkInDraft.dropoff_used) && (
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <span>
                            Transport ({transportTrips} trip{transportTrips === 1 ? "" : "s"})
                            {checkInDraft.transport_zone === "complimentary" ? " — complimentary" : ""}
                          </span>
                          <span>
                            {checkInDraft.transport_zone === "complimentary"
                              ? "No charge"
                              : formatAed(previewTransportTotal)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-sm">
                        <span>Subtotal</span>
                        <span>{formatAed(immediateInvoiceSubtotalPreview)}</span>
                      </div>
                      <div className="flex flex-col gap-2 rounded-md border bg-background/80 p-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <Switch
                            id="daycare_skip_discount"
                            checked={skipInvoiceDiscount}
                            onCheckedChange={setSkipInvoiceDiscount}
                          />
                          <Label htmlFor="daycare_skip_discount" className="text-sm font-normal cursor-pointer">
                            Bill without member discount
                          </Label>
                        </div>
                        {skipInvoiceDiscount && (
                          <span className="text-xs text-muted-foreground sm:text-right">
                            Profile discount will not be applied to this invoice.
                          </span>
                        )}
                      </div>
                      {!skipInvoiceDiscount && (
                        <div className="flex items-center justify-between text-sm text-emerald-700">
                          <span>
                            Auto discount
                            {discountPreview?.discount_pct
                              ? ` (${discountPreview.discount_pct.toFixed(2)}%)`
                              : ""}
                          </span>
                          <span>
                            - {formatAed(discountPreview?.discount_aed ?? 0)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-sm">
                        <span>Net (ex VAT)</span>
                        <span className="tabular-nums">
                          {daycareInvoiceNetExVatPreview != null
                            ? formatAed(netFromGrossInclusive(daycareInvoiceNetExVatPreview))
                            : "—"}
                        </span>
                      </div>
                      {daycareInvoiceNetExVatPreview != null ? (
                        <div className="flex items-center justify-between text-sm">
                          <span>{vatLineLabel()}</span>
                          <span className="tabular-nums">
                            {formatAed(vatAmountFromGrossInclusive(daycareInvoiceNetExVatPreview))}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between font-semibold">
                        <span>Total incl. VAT</span>
                        <span className="tabular-nums">
                          {daycareInvoiceNetExVatPreview != null
                            ? formatAed(Math.max(0, daycareInvoiceNetExVatPreview))
                            : "—"}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="checkin_remark">Remark</Label>
                <Textarea
                  id="checkin_remark"
                  rows={2}
                  value={checkInDraft.remark}
                  onChange={(e) => setCheckInDraft((prev) => ({ ...prev, remark: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Hourly billing is invoiced later from Operations. Single-day billing creates a finalized invoice
                  immediately. Package credits are recorded without a charge line.
                </p>
              </div>

              {expiredPackageSelections.length > 0 && (
                <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-950 [&>svg]:text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Expired package selected</AlertTitle>
                  <AlertDescription>
                    {expiredPackageSelections.map(({ petName, pkg }) => (
                      <span key={pkg.id} className="block">
                        {petName}: expired{" "}
                        {pkg.expiry_date ? daycarePackageExpiryLabel(pkg.expiry_date) : "before today"} (
                        {pkg.total_days - pkg.days_used} remaining)
                      </span>
                    ))}
                    Check-in will proceed — confirm with the client first.
                  </AlertDescription>
                </Alert>
              )}

              <Button
                data-testid="daycare-create-session-btn"
                onClick={handleCheckInSelected}
                disabled={isSubmittingCheckIn || selectedPetIds.length === 0 || singleDayPricingInvalid}
              >
                {isSubmittingCheckIn && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Check in {selectedPetIds.length > 0 ? `${selectedPetIds.length} pet${selectedPetIds.length !== 1 ? "s" : ""}` : "selected pets"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Daycare operations ─────────────────────────────────────────────────────────

type DaycareListPreset = "today" | "tomorrow" | "next7";
type CollectionStatus = "not_collected" | "owner" | "pet_taxi";

const COLLECTION_META_PREFIX = "COLLECTION_BY:";

function parseCollectionStatus(
  notes: string | null | undefined,
  checkedOutAt: string | null | undefined,
): { status: CollectionStatus; visibleNotes: string } {
  const raw = (notes ?? "").trim();
  const visibleNotes = visibleDaycareNotes(notes);
  if (!raw) {
    return {
      status: checkedOutAt ? "owner" : "not_collected",
      visibleNotes: "",
    };
  }
  const lines = raw.split("\n").map((line) => line.trim());
  const marker = lines.find((line) => line.startsWith(COLLECTION_META_PREFIX));
  if (!marker) {
    return {
      status: checkedOutAt ? "owner" : "not_collected",
      visibleNotes,
    };
  }
  const value = marker.replace(COLLECTION_META_PREFIX, "").trim();
  if (value === "pet_taxi") return { status: "pet_taxi", visibleNotes };
  if (value === "owner") return { status: "owner", visibleNotes };
  return {
    status: checkedOutAt ? "owner" : "not_collected",
    visibleNotes,
  };
}

function composeNotesWithCollection(notes: string | null | undefined, status: CollectionStatus): string | null {
  const raw = (notes ?? "").trim();
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const billingLine = lines.find((line) => line.startsWith(BILLING_PATH_PREFIX));
  const invoicedLine = lines.find((line) => line.startsWith("HOURLY_INVOICED:"));
  const draftLine = lines.find((line) => line.startsWith("HOURLY_DRAFT:"));
  const cleaned = visibleDaycareNotes(notes);
  if (status === "not_collected") {
    const parts = [cleaned, billingLine, invoicedLine, draftLine].filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const meta = `${COLLECTION_META_PREFIX}${status}`;
  const parts = [cleaned, billingLine, invoicedLine, draftLine, meta].filter(Boolean);
  return parts.join("\n");
}

function DaycareOperationsTab() {
  const [datePreset, setDatePreset] = useState<DaycareListPreset>("today");
  const [anchorDate, setAnchorDate] = useState(TODAY);
  const [updatingSessionId, setUpdatingSessionId] = useState<string | null>(null);
  const [cancelSessionId, setCancelSessionId] = useState<string | null>(null);
  const [hourlyBillingTarget, setHourlyBillingTarget] = useState<{
    ownerId: string;
    ownerName: string;
    sessionDate: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const cancelCheckIn = useCancelDaycareCheckIn();

  const rangeStart = useMemo(
    () => (datePreset === "tomorrow" ? format(addDays(parseISO(anchorDate), 1), "yyyy-MM-dd") : anchorDate),
    [datePreset, anchorDate],
  );
  const rangeEnd = useMemo(
    () => (datePreset === "next7" ? format(addDays(parseISO(rangeStart), 6), "yyyy-MM-dd") : rangeStart),
    [datePreset, rangeStart],
  );

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["daycare_sessions", "operations", rangeStart, rangeEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daycare_sessions")
        .select("id, owner_id, pet_id, session_date, checked_in, checked_in_at, checked_out_at, notes, package_id, pickup_used, dropoff_used, pets(name), owners(first_name, last_name)")
        .gte("session_date", rangeStart)
        .lte("session_date", rangeEnd)
        .order("session_date", { ascending: true })
        .order("checked_in_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  const { data: invoiceIdByServiceId = new Map<string, string>() } =
    useDaycareSessionInvoiceMap(sessionIds);

  const invoiceIdBySessionId = useMemo(
    () =>
      enrichDaycareSessionInvoiceMap(
        sessions.map((s) => ({
          id: s.id,
          owner_id: s.owner_id,
          session_date: s.session_date,
          notes: s.notes,
          package_id: s.package_id,
        })),
        invoiceIdByServiceId,
      ),
    [sessions, invoiceIdByServiceId],
  );

  const hourlyBillingSessions = useMemo((): HourlyBillingSession[] => {
    if (!hourlyBillingTarget) return [];
    return sessions
      .filter((session) => {
        if (session.owner_id !== hourlyBillingTarget.ownerId) return false;
        if (session.session_date !== hourlyBillingTarget.sessionDate) return false;
        return isDaycareHourlyPending(
          {
            sessionId: session.id,
            notes: session.notes,
            packageId: session.package_id,
            checkedIn: Boolean(session.checked_in),
          },
          invoiceIdBySessionId,
        );
      })
      .map((session) => ({
        id: session.id,
        petId: session.pet_id,
        petName: session.pets?.name ?? "Pet",
        notes: session.notes,
      }));
  }, [hourlyBillingTarget, sessions, invoiceIdBySessionId]);

  const pendingHourlyCount = useMemo(
    () =>
      sessions.filter((session) =>
        isDaycareHourlyPending(
          {
            sessionId: session.id,
            notes: session.notes,
            packageId: session.package_id,
            checkedIn: Boolean(session.checked_in),
          },
          invoiceIdBySessionId,
        ),
      ).length,
    [sessions, invoiceIdBySessionId],
  );

  const totalDogs = sessions.length;
  const collectedDogs = sessions.filter((s) => Boolean(s.checked_out_at)).length;
  const remainingDogs = totalDogs - collectedDogs;

  const updateCollectionStatus = async (
    session: {
      id: string;
      notes: string | null;
      checked_out_at: string | null;
    },
    status: CollectionStatus,
  ) => {
    const updates = {
      checked_out_at: status === "not_collected" ? null : new Date().toISOString(),
      notes: composeNotesWithCollection(session.notes, status),
    };
    setUpdatingSessionId(session.id);
    const { error } = await supabase
      .from("daycare_sessions")
      .update(updates)
      .eq("id", session.id);
    setUpdatingSessionId(null);
    if (error) {
      toast.error(error.message || "Could not update collection status");
      return;
    }
    toast.success(
      status === "not_collected"
        ? "Marked as not collected"
        : `Marked as collected by ${status === "pet_taxi" ? "pet taxi" : "owner"}`,
    );
    queryClient.invalidateQueries({ queryKey: ["daycare_sessions"] });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Operations Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button size="sm" variant={datePreset === "today" ? "default" : "outline"} onClick={() => setDatePreset("today")}>Today</Button>
          <Button size="sm" variant={datePreset === "tomorrow" ? "default" : "outline"} onClick={() => setDatePreset("tomorrow")}>Tomorrow</Button>
          <Button size="sm" variant={datePreset === "next7" ? "default" : "outline"} onClick={() => setDatePreset("next7")}>Next 7 days</Button>
          <Input
            type="date"
            value={anchorDate}
            onChange={(e) => {
              setAnchorDate(e.target.value);
              setDatePreset("today");
            }}
            className="w-44"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daycare Operations List</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge variant="outline">Total: {totalDogs}</Badge>
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              Collected: {collectedDogs}
            </Badge>
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              Remaining: {remainingDogs}
            </Badge>
            {pendingHourlyCount > 0 && (
              <Badge variant="outline" className="bg-orange-50 text-orange-800 border-orange-200">
                Pending hourly billing: {pendingHourlyCount}
              </Badge>
            )}
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-11 w-full" />)}
            </div>
          ) : sessions.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground text-center">No daycare sessions found for this range.</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => {
                const owner = ownerDisplayName(s.owners?.first_name, s.owners?.last_name);
                const collection = parseCollectionStatus(s.notes, s.checked_out_at);
                const billingPath = parseDaycareBillingPath(s.notes, s.package_id);
                const invoiceId = resolveDaycareSessionInvoiceId(
                  s.id,
                  s.notes,
                  invoiceIdBySessionId,
                );
                const hourlyPending = isDaycareHourlyPending(
                  {
                    sessionId: s.id,
                    notes: s.notes,
                    packageId: s.package_id,
                    checkedIn: Boolean(s.checked_in),
                  },
                  invoiceIdBySessionId,
                );
                const invoiceMissing = isSingleDayInvoiceMissing(
                  {
                    sessionId: s.id,
                    notes: s.notes,
                    packageId: s.package_id,
                    checkedIn: Boolean(s.checked_in),
                  },
                  invoiceIdBySessionId,
                );
                const tags = buildDaycareTags({
                  sessionDate: s.session_date,
                  todayDate: TODAY,
                  checkedIn: Boolean(s.checked_in),
                  packageId: s.package_id,
                  billingPath,
                  hasInvoice: isHourlyBillingInvoiced(s.notes),
                  hasDraftInvoice: isHourlyBillingDraft(s.notes),
                });
                return (
                  <div key={s.id} className="rounded-md border px-3 py-2 text-sm flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{s.pets?.name ?? "—"} - {owner}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(s.session_date), "d MMM yyyy")} ·{" "}
                        {collection.visibleNotes || "No notes"}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {tags.map((tag) => (
                          <Badge key={`${s.id}-${tag.key}`} variant="outline" className={tagToneClass(tag.tone)}>
                            {tag.label}
                          </Badge>
                        ))}
                        {invoiceMissing && (
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                            Invoice missing
                          </Badge>
                        )}
                        {s.pickup_used && <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">Pickup</Badge>}
                        {s.dropoff_used && <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">Drop-off</Badge>}
                        {collection.status === "not_collected" ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                            Not collected
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                            Collected by {collection.status === "pet_taxi" ? "Pet Taxi" : "Owner"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="min-w-[190px] space-y-2 shrink-0">
                      <p className="text-right text-xs text-muted-foreground">
                        In: {s.checked_in_at ? format(parseISO(s.checked_in_at), "HH:mm") : "—"}
                      </p>
                      <Select
                        value={collection.status}
                        disabled={updatingSessionId === s.id}
                        onValueChange={(value) => {
                          void updateCollectionStatus(
                            {
                              id: s.id,
                              notes: s.notes,
                              checked_out_at: s.checked_out_at,
                            },
                            value as CollectionStatus,
                          );
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_collected">Not collected</SelectItem>
                          <SelectItem value="owner">Collected by owner</SelectItem>
                          <SelectItem value="pet_taxi">Collected by pet taxi</SelectItem>
                        </SelectContent>
                      </Select>
                      {invoiceId && (
                        <DaycareSessionInvoiceLink
                          invoiceId={invoiceId}
                          testId={`daycare-view-invoice-${s.id}`}
                        />
                      )}
                      {hourlyPending && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="w-full h-8 text-xs"
                          data-testid={`daycare-complete-hourly-${s.id}`}
                          onClick={() =>
                            setHourlyBillingTarget({
                              ownerId: s.owner_id,
                              ownerName: owner,
                              sessionDate: s.session_date,
                            })
                          }
                        >
                          Complete hourly billing
                        </Button>
                      )}
                      {s.checked_in && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full h-8 text-xs text-destructive border-destructive/40"
                          data-testid={`daycare-cancel-checkin-${s.id}`}
                          onClick={() => setCancelSessionId(s.id)}
                        >
                          Cancel check-in
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <CancelDaycareCheckInDialog
        open={!!cancelSessionId}
        sessionId={cancelSessionId}
        pending={cancelCheckIn.isPending}
        onOpenChange={(open) => {
          if (!open) setCancelSessionId(null);
        }}
        onConfirm={async ({ sessionId, reason, staff }) => {
          await cancelCheckIn.mutateAsync({ sessionId, reason, staff });
          toast.success("Check-in cancelled");
          setCancelSessionId(null);
        }}
      />

      <CompleteHourlyBillingDialog
        open={Boolean(hourlyBillingTarget) && hourlyBillingSessions.length > 0}
        onOpenChange={(open) => {
          if (!open) setHourlyBillingTarget(null);
        }}
        ownerId={hourlyBillingTarget?.ownerId ?? ""}
        ownerName={hourlyBillingTarget?.ownerName ?? ""}
        sessions={hourlyBillingSessions}
        onSuccess={() => {
          setHourlyBillingTarget(null);
          queryClient.invalidateQueries({ queryKey: ["daycare_sessions"] });
          queryClient.invalidateQueries({ queryKey: ["invoices"] });
        }}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DaycarePage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab =
    requestedTab === "operations"
      ? "operations"
      : requestedTab === "packages"
        ? "packages"
        : "planner";

  const setTab = (value: string) => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set("tab", value);
        return n;
      },
      { replace: true }
    );
  };

  return (
    <>
      <TopBar title="Daycare" />
      <main className="flex-1 overflow-auto p-8">
        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="planner">Planner</TabsTrigger>
            <TabsTrigger value="packages">Packages</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
          </TabsList>

          <TabsContent value="planner" className="mt-0">
            <PlannerTab />
          </TabsContent>

          <TabsContent value="packages" className="mt-0">
            <DaycarePackagesTab />
          </TabsContent>

          <TabsContent value="operations" className="mt-0">
            <DaycareOperationsTab />
          </TabsContent>

        </Tabs>
      </main>
    </>
  );
};

export default DaycarePage;
