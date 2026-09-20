import { useState, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate, Link } from "react-router-dom";
import { format, parse, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import TopBar from "@/components/dashboard/TopBar";
import { useOwner, useUpdateOwner, useDeleteOwner } from "@/hooks/useOwners";
import { useOwnerBookings } from "@/hooks/useBookings";
import type { BookingWithDetails } from "@/hooks/useBookings";
import {
  useOwnerGroomingAppointments,
  type GroomingAppointmentWithJoins,
} from "@/hooks/useGrooming";
import { calculateNights, ownerDisplayName } from "@/lib/bookingUtils";
import { labelForGroomingService } from "@/lib/groomingCatalog";
import { boardingCalendarTo, boardingServiceLabel } from "@/lib/boardingLabels";
import { usePets, useCreatePet, useDeletePet, getVaccinationStatus } from "@/hooks/usePets";
import { petVaccinationSummaryLine } from "@/lib/vaccinationsDisplay";
import {
  useManualTopUpWallet,
  useTopUpWallet,
  useWalletTopupReceipts,
} from "@/hooks/useWallet";
import { useCurrentStaffName } from "@/hooks/useCurrentStaffName";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PetWithVaccinations } from "@/hooks/usePets";
import { PetBreedCombobox } from "@/components/PetBreedCombobox";
import { VetClinicCombobox } from "@/components/VetClinicCombobox";
import { VaccinationEditor } from "@/components/VaccinationEditor";
import type { VaccinationRow } from "@/components/VaccinationEditor";
import {
  useInvoicesForOwner,
  useOwnerBalances,
  useBillingAdjustments,
  useCollectPayment,
  formatAed,
  type InvoiceWithItems,
  type InvoiceStatus,
} from "@/hooks/useBilling";
import { formatWalletAed } from "@/lib/money";
import { invoiceDisplayTotals } from "@/lib/vatConfig";
import { ConsolidateInvoicesDialog } from "@/components/billing/ConsolidateInvoicesDialog";
import { ClearOutstandingAfterTopUpDialog } from "@/components/billing/ClearOutstandingAfterTopUpDialog";
import { PaymentSplitDialog } from "@/components/billing/PaymentSplitDialog";
import { canConsolidateInvoiceStatus } from "@/lib/invoiceConsolidation";
import { usePendingHourlyDaycareForOwner } from "@/hooks/useDaycare";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Wallet,
  Loader2,
  PawPrint,
  Dog,
  Cat,
  Trash2,
  CalendarDays,
  BedDouble,
  ExternalLink,
  FileText,
  CreditCard,
  Printer,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { PurchasePackageDialog } from "@/components/packages/PurchasePackageDialog";

type BookingStatus = Database["public"]["Enums"]["booking_status"];
type OwnerUpdate = Database["public"]["Tables"]["owners"]["Update"];
type PetInsert = Database["public"]["Tables"]["pets"]["Insert"];
type Vaccination = Database["public"]["Tables"]["vaccinations"]["Row"];
type ActiveCreditRow = Database["public"]["Functions"]["list_active_credits_for_pet"]["Returns"][number] & {
  pet_id: string;
  pet_name: string;
};

function serviceCodeLabel(serviceCode: Database["public"]["Enums"]["service_code"]): string {
  const labels: Record<Database["public"]["Enums"]["service_code"], string> = {
    boarding_night: "boarding nights",
    daycare_full_day: "daycare days",
    daycare_half_day: "daycare half days",
    daycare_hourly: "daycare hourly credits",
    grooming_full_service: "grooming full service sessions",
    cat_grooming_full_no_bath: "cat full service (no bath)",
    cat_grooming_full_with_bath: "cat full service (with bath)",
    grooming_bath_brush_tidy: "bath, brush and tidy sessions",
    grooming_tidy: "tidy sessions",
    grooming_gland_expression: "gland expression",
    grooming_nail_ear_teeth: "nail/ear/teeth sessions",
    cat_grooming_nail_ear: "cat nail/ear sessions",
    grooming_hair_no_more: "hair-no-more sessions",
    cat_grooming_hair_no_more: "cat hair-no-more sessions",
    grooming_splash: "grooming splash sessions",
    cat_grooming_splash: "cat grooming splash sessions",
    addon_nails: "nail add-ons",
    addon_glands: "gland add-ons",
    addon_dematting: "dematting add-ons",
    addon_teeth_cleaning: "teeth cleaning add-ons",
    addon_flea_tick_bath: "flea/tick bath add-ons",
    addon_specialised_shampoo: "specialised shampoo add-ons",
    treadmill_daycare_addon: "treadmill sessions",
    treadmill_hourly_addon: "treadmill hourly sessions",
    assessment_with_first_hour: "assessment sessions",
  };
  return labels[serviceCode] ?? serviceCode;
}

const STATUS_DOT: Record<string, string> = {
  valid: "bg-green-500",
  expiring_soon: "bg-amber-500",
  expired: "bg-red-500",
  none: "bg-gray-300",
};

const STATUS_LABEL: Record<string, string> = {
  valid: "Vaccines up to date",
  expiring_soon: "Vaccine expiring soon",
  expired: "Vaccine expired",
  none: "No vaccinations",
};

const BOOKING_STATUS_BADGE: Record<BookingStatus, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  confirmed: "bg-blue-100 text-blue-800 border-blue-200",
  checked_in: "bg-emerald-100 text-emerald-800 border-emerald-200",
  checked_out: "bg-slate-100 text-slate-600 border-slate-200",
  enquiry: "bg-amber-100 text-amber-800 border-amber-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
  no_show: "bg-rose-100 text-rose-700 border-rose-200",
};

const INVOICE_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600 border-slate-200" },
  issued: { label: "Issued", className: "bg-blue-50 text-blue-700 border-blue-200" },
  finalised: { label: "Finalised", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  paid: { label: "Paid", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  partially_paid: { label: "Partial", className: "bg-blue-50 text-blue-700 border-blue-200" },
  outstanding: { label: "Outstanding", className: "bg-amber-50 text-amber-700 border-amber-200" },
  overdue: { label: "Overdue", className: "bg-red-50 text-red-700 border-red-200" },
  voided: { label: "Voided", className: "bg-gray-100 text-gray-500 border-gray-200 line-through" },
  consolidated: { label: "Consolidated", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-500 border-gray-200" },
};

function bookingPetNames(b: BookingWithDetails): string {
  const names = b.booking_pets
    .map((bp) => bp.pets?.name)
    .filter(Boolean) as string[];
  return names.length ? names.join(", ") : "—";
}

function formatBookingStatus(status: BookingStatus): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const TIME_ANCHOR = new Date(2000, 0, 1);

function formatGroomSlotTime(t: string | null): string {
  if (!t) return "—";
  try {
    const base = parse(t.slice(0, 8), "HH:mm:ss", TIME_ANCHOR);
    return format(base, "h:mm a");
  } catch {
    return t;
  }
}

function groomerLine(g: GroomingAppointmentWithJoins): string {
  if (g.grooming_notes?.trim()) return g.grooming_notes.trim();
  return "—";
}

function groomingStatusLabel(status: string, noShow: boolean): string {
  if (noShow) return "No show";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type HistoryServiceFilter = "all" | "boarding" | "grooming";

function historyFilterEmptyMessage(filter: HistoryServiceFilter): string {
  switch (filter) {
    case "boarding":
      return "No boarding stays in this history.";
    case "grooming":
      return "No grooming appointments in this history.";
    default:
      return "No bookings yet.";
  }
}

type BookingDetailSelection =
  | { kind: "stay"; stay: BookingWithDetails }
  | { kind: "grooming"; groom: GroomingAppointmentWithJoins };

function overallVaccinationStatus(
  vaccinations: Vaccination[]
): "valid" | "expiring_soon" | "expired" | "none" {
  if (!vaccinations || vaccinations.length === 0) return "none";
  const statuses = vaccinations.map((v) => getVaccinationStatus(v.expiry_date));
  if (statuses.includes("expired")) return "expired";
  if (statuses.includes("expiring_soon")) return "expiring_soon";
  return "valid";
}

function makePetForm(ownerId: string): PetInsert {
  return {
    name: "",
    owner_id: ownerId,
    species: "dog",
    breed: "",
    colour: "",
    date_of_birth: null,
    size: null,
    weight_kg: undefined,
    gender: undefined,
    spayed_neutered: false,
    feeding_notes: "",
    medical_conditions: "",
    medication_notes: "",
    behaviour_notes: "",
    assessment_status: "not_assessed",
    microchip_number: "",
    grooming_notes: "",
    other_notes: "",
    vet_name: "",
    vet_phone: "",
    photo_url: "",
  };
}

// ── Owner Billing Section ────────────────────────────────────────────────────

function OwnerBillingSection({ ownerId }: { ownerId: string }) {
  const navigate = useNavigate();
  const { staffName } = useCurrentStaffName();
  const ownerBalances = useOwnerBalances(ownerId);
  const [payAllPending, setPayAllPending] = useState(false);
  const { data: pendingHourly = [], isLoading: pendingHourlyLoading } =
    usePendingHourlyDaycareForOwner(ownerId);
  const { data: invoices = [], isLoading: invoicesLoading, refetch: refetchInvoices } =
    useInvoicesForOwner(ownerId);
  const { data: topupReceipts = [], isLoading: topupReceiptsLoading } =
    useWalletTopupReceipts(ownerId);
  const { adjustments, isLoading: adjLoading } = useBillingAdjustments(ownerId);
  const collectPayment = useCollectPayment();
  const [collectPaymentInvoice, setCollectPaymentInvoice] = useState<
    { id: string; total: number; ownerId: string } | null
  >(null);

  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [consolidateOpen, setConsolidateOpen] = useState(false);
  const [clearOutstandingOpen, setClearOutstandingOpen] = useState(false);
  const topUp = useTopUpWallet();
  const overdueCount = invoices.filter((inv) => inv.status === "overdue").length;

  const openInvoiceDetail = (invoiceId: string) => {
    navigate(
      `/billing/invoices/${invoiceId}?returnTo=${encodeURIComponent(`/customers/${ownerId}`)}`,
    );
  };

  const consolidatableCount = useMemo(
    () => invoices.filter((inv) => canConsolidateInvoiceStatus(inv.status)).length,
    [invoices],
  );

  const handleCollectPayment = (inv: InvoiceWithItems) => {
    if ((inv.total ?? 0) === 0) {
      // Zero-value invoice — close directly to paid, no dialog.
      collectPayment.mutate(
        { invoiceId: inv.id, total: 0, ownerId: inv.owner_id },
        {
          onSuccess: () => toast.success(`Invoice ${inv.invoice_number ?? ""} closed`),
          onError: (err) => toast.error(err.message),
        },
      );
      return;
    }
    setCollectPaymentInvoice({
      id: inv.id,
      total: (inv.total ?? 0) - (inv.amount_paid ?? 0),
      ownerId: inv.owner_id,
    });
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          Billing & Invoices
          {overdueCount > 0 && (
            <Badge variant="destructive" className="ml-2">
              {overdueCount} overdue
            </Badge>
          )}
        </h3>
        <div className="flex gap-2">
          {selectedIds.length >= 2 && (
            <Button
              size="sm"
              variant="secondary"
              data-testid="owner-profile-consolidate-btn"
              onClick={() => setConsolidateOpen(true)}
            >
              Consolidate selected ({selectedIds.length})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setTopUpOpen(true)}>
            <Wallet className="mr-1.5 h-4 w-4" />
            Top up
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/billing/statements/${ownerId}`)}>
            <FileText className="mr-1.5 h-4 w-4" />
            Statement
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/billing")}>
            <FileText className="mr-1.5 h-4 w-4" />
            Full Billing
          </Button>
        </div>
      </div>

      <div className="mb-6">
        {!ownerBalances.isLoading && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Outstanding debt</p>
                  <p
                    className={
                      ownerBalances.invoiceRemainingTotal > 0
                        ? "mt-1 text-2xl font-bold tabular-nums text-red-600 dark:text-red-400"
                        : "mt-1 text-2xl font-bold tabular-nums"
                    }
                  >
                    {formatWalletAed(ownerBalances.invoiceRemainingTotal)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/billing/statements/${ownerId}`)}
                >
                  View statement
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {!pendingHourlyLoading && pendingHourly.length > 0 && (
        <Card className="mb-4 border-orange-200 bg-orange-50/40">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-orange-900">Pending hourly daycare billing</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  These check-ins are on hourly billing and still need hours entered before they can be finalised.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-orange-300"
                onClick={() => navigate("/daycare?tab=operations")}
              >
                Open Daycare Operations
              </Button>
            </div>
            <ul className="text-sm space-y-1">
              {pendingHourly.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-2">
                  <span>
                    {session.pet_name} — {format(parseISO(session.session_date), "d MMM yyyy")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {consolidatableCount >= 2 && selectedIds.length === 0 && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {consolidatableCount} open invoices — tick the checkboxes below, then click{" "}
          <span className="font-medium">Consolidate selected</span>.
        </div>
      )}

      {/* Invoices & wallet top-ups */}
      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices" data-testid="owner-profile-invoices-tab">
            Invoices
          </TabsTrigger>
          <TabsTrigger value="topups" data-testid="owner-profile-topups-tab">
            Wallet top-ups
            {topupReceipts.length > 0 ? (
              <Badge variant="outline" className="ml-2">
                {topupReceipts.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="invoices">
      <Card>
        <CardContent className="p-0">
          {invoicesLoading ? (
            <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="h-7 w-7 mb-2 opacity-40" />
              <p className="text-sm">No invoices yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-10" />
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => {
                  const sb = INVOICE_STATUS_BADGE[inv.status] ?? INVOICE_STATUS_BADGE.draft;
                  const canFinalise = inv.status === "draft";
                  const canSelect = canConsolidateInvoiceStatus(inv.status);
                  const grandTotal = invoiceDisplayTotals({
                    total: inv.total,
                    vat_aed: inv.vat_aed,
                    service_type: inv.service_type,
                    notes: inv.notes,
                  }).grandTotal;
                  const paidAmount = inv.amount_paid ?? 0;
                  const closingBalance = Math.max(0, grandTotal - paidAmount);
                  return (
                    <TableRow key={inv.id}>
                      <TableCell>
                        {canSelect ? (
                          <Checkbox
                            checked={selectedIds.includes(inv.id)}
                            data-testid={`owner-profile-invoice-select-${inv.id}`}
                            onCheckedChange={(checked) => {
                              setSelectedIds((prev) =>
                                checked
                                  ? [...prev, inv.id]
                                  : prev.filter((id) => id !== inv.id),
                              );
                            }}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-sm font-medium text-primary hover:underline"
                          data-testid={`owner-profile-invoice-link-${inv.id}`}
                          onClick={() => openInvoiceDetail(inv.id)}
                        >
                          {inv.invoice_number ?? inv.id.slice(0, 8)}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(parseISO(inv.created_at), "d MMM yyyy")}</TableCell>
                      <TableCell className="text-sm capitalize">{inv.service_type?.replace(/_/g, " ") ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={sb.className}>{sb.label}</Badge></TableCell>
                      <TableCell className="text-sm font-semibold tabular-nums text-right">
                        {formatAed(grandTotal)}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right text-muted-foreground">
                        {formatAed(paidAmount)}
                      </TableCell>
                      <TableCell
                        className={`text-sm font-medium tabular-nums text-right ${
                          closingBalance > 0 ? "text-red-700" : "text-emerald-700"
                        }`}
                      >
                        {formatAed(closingBalance)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openInvoiceDetail(inv.id)}
                            title="Open invoice"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                          {canFinalise && (
                            <Button size="sm" variant="ghost" disabled={collectPayment.isPending} onClick={() => handleCollectPayment(inv)} title="Collect Payment">
                              <CreditCard className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="topups">
          <Card>
            <CardContent className="p-0">
              {topupReceiptsLoading ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : topupReceipts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Wallet className="h-7 w-7 mb-2 opacity-40" />
                  <p className="text-sm">No wallet top-ups yet</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>Receipt</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Issued by</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topupReceipts.map((rcp) => (
                      <TableRow key={rcp.id}>
                        <TableCell className="text-sm font-medium">
                          {rcp.receipt_number ?? rcp.id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {format(parseISO(rcp.issued_at), "d MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-sm">{rcp.issued_by}</TableCell>
                        <TableCell className="text-sm font-semibold tabular-nums text-right text-emerald-700">
                          +{formatAed(rcp.amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Print receipt"
                            onClick={() =>
                              window.open(
                                `/print/topup-receipt/${rcp.id}`,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Recent adjustments */}
      {!adjLoading && adjustments.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-muted-foreground mb-2">Recent Adjustments</p>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Approved By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adjustments.slice(0, 5).map((adj) => (
                    <TableRow key={adj.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(parseISO(adj.created_at), "d MMM yyyy")}</TableCell>
                      <TableCell className="text-sm capitalize">{adj.adjustment_type.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={adj.reason}>{adj.reason}</TableCell>
                      <TableCell className="text-sm tabular-nums text-right">{adj.adjusted_amount != null ? formatAed(adj.adjusted_amount) : "—"}</TableCell>
                      <TableCell className="text-sm">{adj.approved_by}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Top up wallet</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Amount (AED)</Label>
            <Input type="number" min="0.01" step="0.01" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopUpOpen(false)} disabled={topUp.isPending}>Cancel</Button>
            <Button
              onClick={() => {
                const amount = parseFloat(topUpAmount);
                if (!amount || amount <= 0) return toast.error("Enter a valid amount.");
                topUp.mutate(
                  {
                    owner_id: ownerId,
                    amount,
                    payment_method: "cash",
                    notes: "Top-up from owner profile",
                    issued_by: staffName.trim() || "reception",
                  },
                  {
                    onSuccess: (data) => {
                      toast.success("Wallet topped up.", {
                        action: data?.receipt_id
                          ? {
                              label: "Print receipt",
                              onClick: () =>
                                window.open(
                                  `/print/topup-receipt/${data.receipt_id}`,
                                  "_blank",
                                  "noopener,noreferrer",
                                ),
                            }
                          : undefined,
                      });
                      setTopUpAmount("");
                      setTopUpOpen(false);
                      setClearOutstandingOpen(true);
                    },
                    onError: (err) => toast.error(err.message || "Top up failed."),
                  },
                );
              }}
              disabled={topUp.isPending}
            >
              {topUp.isPending ? "Processing..." : "Confirm top up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClearOutstandingAfterTopUpDialog
        open={clearOutstandingOpen && ownerBalances.balances.canPayAll}
        onOpenChange={setClearOutstandingOpen}
        balances={ownerBalances.balances}
        pending={payAllPending}
        onConfirm={async () => {
          setPayAllPending(true);
          try {
            await ownerBalances.payAllOutstanding(staffName.trim() || "reception");
            setClearOutstandingOpen(false);
          } finally {
            setPayAllPending(false);
          }
        }}
      />

      <ConsolidateInvoicesDialog
        open={consolidateOpen}
        onOpenChange={setConsolidateOpen}
        ownerId={ownerId}
        invoiceIds={selectedIds}
        onSuccess={() => {
          setSelectedIds([]);
          void refetchInvoices();
        }}
      />

      {collectPaymentInvoice && (
        <PaymentSplitDialog
          open={!!collectPaymentInvoice}
          onOpenChange={(o) => {
            if (!o) setCollectPaymentInvoice(null);
          }}
          invoiceId={collectPaymentInvoice.id}
          ownerId={collectPaymentInvoice.ownerId}
          invoiceTotal={collectPaymentInvoice.total}
          onSuccess={() => setCollectPaymentInvoice(null)}
        />
      )}
    </section>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

const OwnerProfilePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: owner, isLoading: ownerLoading } = useOwner(id!);
  const { data: pets, isLoading: petsLoading } = usePets(id!);
  const { data: ownerBookings = [], isLoading: bookingsLoading } = useOwnerBookings(id!);
  const { data: ownerGrooming = [], isLoading: groomingHistoryLoading } =
    useOwnerGroomingAppointments(id!);
  const ownerBalances = useOwnerBalances(id!);
  const [payAllPending, setPayAllPending] = useState(false);
  const [payFromWalletOpen, setPayFromWalletOpen] = useState(false);
  const updateOwner = useUpdateOwner();
  const deleteOwner = useDeleteOwner();
  const createPet = useCreatePet();
  const deletePet = useDeletePet();

  const [editOwnerOpen, setEditOwnerOpen] = useState(false);
  const [addPetOpen, setAddPetOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeletePet, setPendingDeletePet] = useState<PetWithVaccinations | null>(null);
  const [bookingDetail, setBookingDetail] = useState<BookingDetailSelection | null>(null);
  const [historyServiceFilter, setHistoryServiceFilter] =
    useState<HistoryServiceFilter>("all");
  const [addBalanceOpen, setAddBalanceOpen] = useState(false);
  const [addBalanceAmount, setAddBalanceAmount] = useState("");
  const [addBalanceNote, setAddBalanceNote] = useState("");
  const [packageDialogOpen, setPackageDialogOpen] = useState(false);
  const manualTopUp = useManualTopUpWallet();
  const { staffName } = useCurrentStaffName();

  const { data: ownerActiveCredits = [], isLoading: creditsLoading } = useQuery({
    queryKey: ["owner_active_credits", id, pets?.map((p) => p.id).join(",") ?? ""],
    enabled: !!id && (pets?.length ?? 0) > 0,
    queryFn: async () => {
      const rows = await Promise.all(
        (pets ?? []).map(async (pet) => {
          const { data, error } = await supabase.rpc("list_active_credits_for_pet", {
            p_pet_id: pet.id,
            p_service_code: null,
          });
          if (error) throw error;
          return ((data ?? []) as Database["public"]["Functions"]["list_active_credits_for_pet"]["Returns"]).map(
            (row) => ({
              ...row,
              pet_id: pet.id,
              pet_name: pet.name,
            }),
          );
        }),
      );
      const flat = rows.flat() as ActiveCreditRow[];
      const seen = new Set<string>();
      return flat.filter((row) => {
        if (seen.has(row.credit_id)) return false;
        seen.add(row.credit_id);
        return true;
      });
    },
  });

  const [ownerForm, setOwnerForm] = useState<OwnerUpdate & { id: string }>({
    id: id!,
  });
  const [petForm, setPetForm] = useState<PetInsert>(makePetForm(id!));
  const [vaccinationRows, setVaccinationRows] = useState<VaccinationRow[]>([]);

  // photo upload
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoSelect = (file: File) => {
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const uploadPhoto = async (): Promise<string | null> => {
    if (!photoFile) return petForm.photo_url ?? null;
    setPhotoUploading(true);
    const ext = photoFile.name.split(".").pop();
    const path = `${id!}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("pet-photos")
      .upload(path, photoFile, { upsert: true });
    setPhotoUploading(false);
    if (error) {
      toast.error("Photo upload failed: " + error.message);
      return null;
    }
    const { data } = supabase.storage.from("pet-photos").getPublicUrl(path);
    return data.publicUrl;
  };

  const openEditDrawer = () => {
    if (owner) {
      setOwnerForm({
        id: owner.id,
        first_name: owner.first_name,
        last_name: owner.last_name,
        phone: owner.phone,
        email: owner.email,
        notes: owner.notes,
        address: owner.address,
        emergency_contact_name: owner.emergency_contact_name,
        emergency_contact_phone: owner.emergency_contact_phone,
        vet_name: owner.vet_name,
        vet_phone: owner.vet_phone,
        preferred_groomer: owner.preferred_groomer,
        how_heard: owner.how_heard,
        emirates_id: owner.emirates_id,
        is_vip: owner.is_vip,
        always_same_room: owner.always_same_room,
        camera_required: owner.camera_required,
      });
    }
    setEditOwnerOpen(true);
  };

  const handleOwnerField = (field: keyof OwnerUpdate, value: string) => {
    setOwnerForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleOwnerToggle = (field: keyof OwnerUpdate, value: boolean) => {
    setOwnerForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleOwnerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateOwner.mutate(ownerForm as OwnerUpdate & { id: string }, {
      onSuccess: () => {
        toast.success("Owner updated");
        setEditOwnerOpen(false);
      },
      onError: (err) => {
        toast.error(err.message || "Failed to update owner");
      },
    });
  };

  const handlePetField = (field: keyof PetInsert, value: unknown) => {
    setPetForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!petForm.size) {
      toast.error("Select a size (Small, Medium, or Large).");
      return;
    }
    const photoUrl = await uploadPhoto();
    createPet.mutate({ ...petForm, photo_url: photoUrl }, {
      onSuccess: async (newPet) => {
        // Insert vaccination rows sequentially
        for (const row of vaccinationRows) {
          if (!row.vaccine_name.trim() || !row.expiry_date) continue;

          const displayName = row.brand.trim()
            ? `${row.vaccine_name.trim()} (${row.brand.trim()})`
            : row.vaccine_name.trim();

          await supabase.from("vaccinations").insert({
            pet_id: newPet.id,
            vaccine_name: displayName,
            administered_date: row.administered_date || null,
            expiry_date: row.expiry_date,
            document_url: null,
          });
        }

        toast.success("Pet added");
        setAddPetOpen(false);
        setPetForm(makePetForm(id!));
        setVaccinationRows([]);
        setPhotoFile(null);
        setPhotoPreview(null);
      },
      onError: (err) => {
        toast.error(err.message || "Failed to add pet");
      },
    });
  };

  const bookingTimeline = useMemo(() => {
    type Row =
      | { kind: "stay"; sortKey: string; id: string; stay: BookingWithDetails }
      | { kind: "grooming"; sortKey: string; id: string; groom: GroomingAppointmentWithJoins };

    const rows: Row[] = [];

    ownerBookings.forEach((b) => {
      rows.push({
        kind: "stay",
        sortKey: `${b.check_in_date}T12:00:00`,
        id: b.id,
        stay: b,
      });
    });

    ownerGrooming.forEach((g) => {
      const tt = (g.appointment_time || "00:00:00").slice(0, 8);
      rows.push({
        kind: "grooming",
        sortKey: `${g.appointment_date}T${tt}`,
        id: g.id,
        groom: g,
      });
    });

    rows.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
    return rows;
  }, [ownerBookings, ownerGrooming]);

  const filteredBookingTimeline = useMemo(() => {
    if (historyServiceFilter === "all") return bookingTimeline;
    return bookingTimeline.filter((row) => {
      switch (historyServiceFilter) {
        case "grooming":
          return row.kind === "grooming";
        case "boarding":
          return row.kind === "stay";
        default:
          return true;
      }
    });
  }, [bookingTimeline, historyServiceFilter]);

  const historyLoading = bookingsLoading || groomingHistoryLoading;

  if (ownerLoading) {
    return (
      <>
        <TopBar title="Customer Profile" />
        <main className="flex-1 overflow-auto p-8 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-60 w-full" />
        </main>
      </>
    );
  }

  if (!owner) {
    return (
      <>
        <TopBar title="Customer Profile" />
        <main className="flex-1 overflow-auto p-8">
          <p className="text-muted-foreground">Owner not found.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title="Customer Profile" />
      <main className="flex-1 overflow-auto p-8 space-y-8">
        {/* Back link */}
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => navigate("/customers")}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to Customers
        </Button>

        {/* ─── Owner Summary Card ─── */}
        <Card>
          <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <h2 className="text-2xl font-semibold">
                {ownerDisplayName(owner.first_name, owner.last_name)}
              </h2>
              <p className="text-sm text-muted-foreground">{owner.phone}</p>
              {owner.email && (
                <p className="text-sm text-muted-foreground">{owner.email}</p>
              )}
              <Badge
                variant="outline"
                className="bg-slate-100 text-slate-700 border-slate-200"
              >
                Woof
              </Badge>
              {owner.pets && owner.pets.length > 0 && (
                <p className="text-sm text-muted-foreground pt-1 max-w-xl">
                  <span className="font-medium text-foreground">Pets: </span>
                  {owner.pets
                    .map((p) =>
                      p.breed ? `${p.name} (${p.breed})` : p.name
                    )
                    .join(", ")}
                </p>
              )}
              {owner.preferred_groomer?.trim() ? (
                <p className="text-sm text-muted-foreground pt-1">
                  <span className="font-medium text-foreground">Preferred groomer: </span>
                  {owner.preferred_groomer.trim()}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-start gap-6">
              <div className="text-right">
                <div className="flex items-center justify-end gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                  <Wallet className="h-3.5 w-3.5" />
                  Wallet balance
                </div>
                <p className="mt-1 text-3xl font-bold tabular-nums">
                  {formatWalletAed(owner.wallet_balance ?? 0)}
                </p>
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Outstanding debt
                  </p>
                  {ownerBalances.isLoading ? (
                    <Skeleton className="mt-0.5 ml-auto h-5 w-24" />
                  ) : (
                    <p
                      className={
                        ownerBalances.invoiceRemainingTotal > 0
                          ? "mt-0.5 text-sm font-semibold tabular-nums text-red-600 dark:text-red-400"
                          : "mt-0.5 text-sm font-semibold tabular-nums text-muted-foreground"
                      }
                    >
                      {formatWalletAed(ownerBalances.invoiceRemainingTotal)}
                    </p>
                  )}
                </div>
                <div className="mt-3 flex flex-col items-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAddBalanceOpen(true)}
                  >
                    Add Balance
                  </Button>
                  {!ownerBalances.isLoading &&
                    ownerBalances.invoiceRemainingTotal > 0 &&
                    ownerBalances.combinedWallet > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={payAllPending}
                        onClick={() => setPayFromWalletOpen(true)}
                      >
                        {payAllPending ? "Processing…" : "Pay from Wallet"}
                      </Button>
                    )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={openEditDrawer}>
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive hover:text-destructive-foreground border-destructive/40"
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          </CardContent>

          {/* Flags strip — only rendered when at least one flag is set */}
          {(owner.is_vip || owner.always_same_room || owner.camera_required) && (
            <>
              <Separator />
              <div className="flex items-center gap-2 px-6 py-3 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-1">
                  Flags
                </span>
                {owner.is_vip && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                    VIP
                  </Badge>
                )}
                {owner.always_same_room && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
                    Always Same Room
                  </Badge>
                )}
                {owner.camera_required && (
                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">
                    Camera Required
                  </Badge>
                )}
              </div>
            </>
          )}
        </Card>

        {!ownerBalances.isLoading &&
          ownerBalances.invoiceRemainingTotal > 0 &&
          ownerBalances.combinedWallet > 0 && (
            <Card className="mb-6 border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20">
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  {ownerBalances.canPayAll ? (
                    <>
                      Wallet credit ({formatWalletAed(ownerBalances.combinedWallet)}) can cover all
                      open invoices ({formatWalletAed(ownerBalances.invoiceRemainingTotal)}).
                    </>
                  ) : (
                    <>
                      Wallet credit ({formatWalletAed(ownerBalances.combinedWallet)}) is available
                      toward open invoices (
                      {formatWalletAed(ownerBalances.invoiceRemainingTotal)} total).
                    </>
                  )}
                </p>
                <Button
                  size="sm"
                  disabled={payAllPending}
                  onClick={() => setPayFromWalletOpen(true)}
                >
                  {ownerBalances.canPayAll ? "Pay all outstanding" : "Pay from Wallet"}
                </Button>
              </CardContent>
            </Card>
          )}

        {/* ─── Pets Section ─── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <PawPrint className="h-5 w-5" />
              Pets
            </h3>
            <Button
              size="sm"
              onClick={() => {
                setPetForm(makePetForm(id!));
                setAddPetOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add Pet
            </Button>
          </div>

          {petsLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-36 rounded-lg" />
              ))}
            </div>
          ) : !pets || pets.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <PawPrint className="h-8 w-8 mb-2" />
                <p>No pets registered yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pets.map((pet: PetWithVaccinations) => {
                const vacStatus = overallVaccinationStatus(pet.vaccinations);
                const vacSummary = petVaccinationSummaryLine(pet.vaccinations);
                return (
                  <Card
                    key={pet.id}
                    className="cursor-pointer transition-shadow hover:shadow-md"
                    onClick={() =>
                      navigate(`/customers/${id}/pets/${pet.id}`)
                    }
                  >
                    <CardContent className="relative flex gap-4 p-4">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        aria-label={`Delete ${pet.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeletePet(pet);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      {pet.photo_url ? (
                        <img
                          src={pet.photo_url}
                          alt={pet.name}
                          className="h-16 w-16 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted">
                          {pet.species === "cat" ? (
                            <Cat className="h-6 w-6 text-muted-foreground" />
                          ) : (
                            <Dog className="h-6 w-6 text-muted-foreground" />
                          )}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">{pet.name}</p>
                          <span
                            title={STATUS_LABEL[vacStatus]}
                            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[vacStatus]}`}
                          />
                        </div>
                        <p className="text-sm text-muted-foreground capitalize">
                          {pet.species}
                          {pet.breed ? ` · ${pet.breed}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {STATUS_LABEL[vacStatus]}
                        </p>
                        <p
                          className="mt-1 text-xs text-muted-foreground line-clamp-2"
                          title={vacSummary}
                        >
                          {vacSummary}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ─── Booking history (stays, grooming) ─── */}
        <section>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <BedDouble className="h-5 w-5" />
              Booking History
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={historyServiceFilter === "all" ? "default" : "outline"}
                size="sm"
                aria-pressed={historyServiceFilter === "all"}
                onClick={() => setHistoryServiceFilter("all")}
              >
                All
              </Button>
              <Button
                variant={historyServiceFilter === "boarding" ? "default" : "outline"}
                size="sm"
                aria-pressed={historyServiceFilter === "boarding"}
                onClick={() => setHistoryServiceFilter("boarding")}
              >
                Boarding
              </Button>
              <Button
                variant={historyServiceFilter === "grooming" ? "default" : "outline"}
                size="sm"
                aria-pressed={historyServiceFilter === "grooming"}
                onClick={() => setHistoryServiceFilter("grooming")}
              >
                Grooming
              </Button>
            </div>
          </div>

          {historyLoading ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : bookingTimeline.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <BedDouble className="h-7 w-7 mb-2 opacity-60" />
                <p className="text-sm">No bookings yet.</p>
              </CardContent>
            </Card>
          ) : filteredBookingTimeline.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <BedDouble className="h-7 w-7 mb-2 opacity-60" />
                <p className="text-sm">{historyFilterEmptyMessage(historyServiceFilter)}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="whitespace-nowrap">Ref</TableHead>
                    <TableHead className="whitespace-nowrap">Service</TableHead>
                    <TableHead className="min-w-[140px]">Dates</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="min-w-[160px]">Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBookingTimeline.map((row) => {
                    if (row.kind === "stay") {
                      const b = row.stay;
                      const nights = calculateNights(b.check_in_date, b.check_out_date);
                      const room = b.rooms;
                      const service = boardingServiceLabel(room?.wing);
                      const roomLine = room?.display_name ?? "—";
                      return (
                        <TableRow
                          key={`stay-${b.id}`}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setBookingDetail({ kind: "stay", stay: b })}
                        >
                          <TableCell className="font-mono text-xs whitespace-nowrap">
                            {b.booking_ref ?? b.id.slice(0, 8)}
                          </TableCell>
                          <TableCell className="text-sm font-medium">{service}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(parseISO(b.check_in_date), "d MMM yyyy")}
                            {" → "}
                            {format(parseISO(b.check_out_date), "d MMM yyyy")}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={BOOKING_STATUS_BADGE[b.status]}
                            >
                              {formatBookingStatus(b.status)}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className="text-sm max-w-[220px] truncate"
                            title={`${bookingPetNames(b)} · ${roomLine} · ${nights}n`}
                          >
                            {bookingPetNames(b)} · {roomLine} · {nights}n
                          </TableCell>
                        </TableRow>
                      );
                    }
                    const g = row.groom;
                    const dateLine = `${format(parseISO(g.appointment_date), "d MMM yyyy")}${
                      g.appointment_time
                        ? ` · ${formatGroomSlotTime(g.appointment_time)}`
                        : ""
                    }`;
                    return (
                      <TableRow
                        key={`groom-${g.id}`}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setBookingDetail({ kind: "grooming", groom: g })}
                      >
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {g.id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-sm font-medium">Grooming</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{dateLine}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {groomingStatusLabel(g.status, g.no_show)}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className="text-sm max-w-[220px] truncate"
                          title={`${g.pets?.name ?? "—"} · ${labelForGroomingService(g.service)}`}
                        >
                          {g.pets?.name ?? "—"} · {labelForGroomingService(g.service)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <Separator />

        {/* ─── Active Packages ─── */}
        <section data-testid="owner-profile-active-packages-section">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Active Packages
            </h3>
            <Button
              data-testid="owner-profile-purchase-package-btn"
              size="sm"
              variant="outline"
              onClick={() => setPackageDialogOpen(true)}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Purchase Package
            </Button>
          </div>

          {creditsLoading ? (
            <Skeleton className="h-20 w-full rounded-lg" />
          ) : ownerActiveCredits.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <CalendarDays className="h-7 w-7 mb-2" />
                <p className="text-sm">No active packages.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <Card>
                <CardContent className="pt-4 space-y-2">
                  {Object.entries(
                    ownerActiveCredits.reduce<Record<string, { total: number; byPet: Record<string, number> }>>(
                      (acc, row) => {
                        const key = row.service_code;
                        if (!acc[key]) acc[key] = { total: 0, byPet: {} };
                        acc[key].total += row.units_remaining;
                        acc[key].byPet[row.pet_name] = (acc[key].byPet[row.pet_name] ?? 0) + row.units_remaining;
                        return acc;
                      },
                      {},
                    ),
                  ).map(([serviceCode, info]) => (
                    <p key={serviceCode} className="text-sm">
                      <span className="font-medium">{info.total} {serviceCodeLabel(serviceCode as Database["public"]["Enums"]["service_code"])}</span>
                      {" "}(
                      {Object.entries(info.byPet)
                        .map(([petName, units]) => `${petName}: ${units}`)
                        .join(", ")}
                      )
                    </p>
                  ))}
                </CardContent>
              </Card>

              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">Per-pet details</summary>
                <div className="mt-3 space-y-3">
                  {(pets ?? []).map((pet) => {
                    const petCredits = ownerActiveCredits.filter((row) => row.pet_id === pet.id);
                    return (
                      <div
                        key={pet.id}
                        data-testid={`owner-profile-pet-credits-${pet.id}`}
                        className="rounded border p-2"
                      >
                        <p className="font-medium text-sm">{pet.name}</p>
                        {petCredits.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No active credits.</p>
                        ) : (
                          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                            {petCredits.map((row) => (
                              <li key={row.credit_id}>
                                {row.package_name ?? "Package"} · {row.units_remaining} {serviceCodeLabel(row.service_code)} · exp {row.expires_at}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            </div>
          )}
        </section>

        <Separator />

        {/* ─── Billing & Invoices Section ─── */}
        <OwnerBillingSection ownerId={id!} />

        <Separator />

        {/* ─── Booking detail (from history row) ─── */}
        <Sheet
          open={bookingDetail !== null}
          onOpenChange={(open) => {
            if (!open) setBookingDetail(null);
          }}
        >
          <SheetContent className="w-full sm:max-w-md overflow-y-auto">
            {bookingDetail?.kind === "stay" && (
              <>
                <SheetHeader>
                  <SheetTitle>
                    {bookingDetail.stay.booking_ref ?? "Stay details"}
                  </SheetTitle>
                  <SheetDescription>
                    {boardingServiceLabel(bookingDetail.stay.rooms?.wing)} stay.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-4">
                  <Badge
                    variant="outline"
                    className={BOOKING_STATUS_BADGE[bookingDetail.stay.status]}
                  >
                    {formatBookingStatus(bookingDetail.stay.status)}
                  </Badge>
                  {bookingDetail.stay.do_not_move && (
                    <Badge variant="outline" className="bg-orange-50 text-orange-800 border-orange-200">
                      DO NOT MOVE
                    </Badge>
                  )}
                  <Separator />
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground font-medium">Customer</p>
                    {bookingDetail.stay.owners ? (
                      <Link
                        to={`/customers/${bookingDetail.stay.owner_id}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        {ownerDisplayName(bookingDetail.stay.owners.first_name, bookingDetail.stay.owners.last_name)}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      <p className="text-sm">—</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground font-medium">Pets</p>
                    <div className="text-sm space-y-1">
                      {bookingDetail.stay.booking_pets.length === 0 ? (
                        <p>—</p>
                      ) : (
                        bookingDetail.stay.booking_pets.map((bp) => (
                          <button
                            key={bp.pet_id}
                            type="button"
                            className="flex items-center gap-1 font-medium text-primary hover:underline"
                            onClick={() =>
                              navigate(`/customers/${id}/pets/${bp.pet_id}`)
                            }
                          >
                            {bp.pets?.name ?? "Pet"}
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground font-medium">Room</p>
                    <p className="text-sm">
                      {bookingDetail.stay.rooms?.display_name ?? "—"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <p className="text-xs uppercase text-muted-foreground font-medium">Check-in</p>
                      <p className="text-sm">
                        {format(parseISO(bookingDetail.stay.check_in_date), "d MMM yyyy")}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs uppercase text-muted-foreground font-medium">Check-out</p>
                      <p className="text-sm">
                        {format(parseISO(bookingDetail.stay.check_out_date), "d MMM yyyy")}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {calculateNights(
                      bookingDetail.stay.check_in_date,
                      bookingDetail.stay.check_out_date,
                    )}{" "}
                    night
                    {calculateNights(
                      bookingDetail.stay.check_in_date,
                      bookingDetail.stay.check_out_date,
                    ) !== 1
                      ? "s"
                      : ""}
                  </p>
                  {(bookingDetail.stay.pickup_required ||
                    bookingDetail.stay.dropoff_required) && (
                    <div className="space-y-1">
                      <p className="text-xs uppercase text-muted-foreground font-medium">
                        Transport
                      </p>
                      <p className="text-sm">
                        {[
                          bookingDetail.stay.pickup_required && "Pickup (check-in)",
                          bookingDetail.stay.dropoff_required && "Drop-off (check-out)",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  )}
                  {bookingDetail.stay.notes && (
                    <div className="space-y-1">
                      <p className="text-xs uppercase text-muted-foreground font-medium">Notes</p>
                      <p className="text-sm whitespace-pre-line">{bookingDetail.stay.notes}</p>
                    </div>
                  )}
                  <Button variant="outline" className="w-full" asChild>
                    <Link to={boardingCalendarTo(bookingDetail.stay.rooms?.wing)}>
                      Open calendar
                    </Link>
                  </Button>
                </div>
              </>
            )}

            {bookingDetail?.kind === "grooming" && (
              <>
                <SheetHeader>
                  <SheetTitle>Grooming appointment</SheetTitle>
                  <SheetDescription>
                    {format(parseISO(bookingDetail.groom.appointment_date), "EEEE, d MMMM yyyy")}
                    {bookingDetail.groom.appointment_time
                      ? ` · ${formatGroomSlotTime(bookingDetail.groom.appointment_time)}`
                      : ""}
                  </SheetDescription>
                  <p className="text-xs text-muted-foreground font-mono pt-1">
                    {bookingDetail.groom.id}
                  </p>
                </SheetHeader>
                <div className="mt-6 space-y-4">
                  <Badge variant="outline" className="capitalize">
                    {groomingStatusLabel(bookingDetail.groom.status, bookingDetail.groom.no_show)}
                  </Badge>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground font-medium">Service</p>
                    <p className="text-sm font-medium">
                      {labelForGroomingService(bookingDetail.groom.service)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground font-medium">Pet</p>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      onClick={() =>
                        navigate(`/customers/${id}/pets/${bookingDetail.groom.pet_id}`)
                      }
                    >
                      {bookingDetail.groom.pets?.name ?? "—"}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground font-medium">Groomer</p>
                    <p className="text-sm">{groomerLine(bookingDetail.groom)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground font-medium">Price</p>
                    <p className="text-sm tabular-nums">
                      {bookingDetail.groom.price != null
                        ? `AED ${bookingDetail.groom.price.toFixed(0)}`
                        : "—"}
                    </p>
                  </div>
                  {bookingDetail.groom.notes && (
                    <div className="space-y-1">
                      <p className="text-xs uppercase text-muted-foreground font-medium">Notes</p>
                      <p className="text-sm whitespace-pre-line">{bookingDetail.groom.notes}</p>
                    </div>
                  )}
                  <Button variant="outline" className="w-full" asChild>
                    <Link to={`/grooming?date=${bookingDetail.groom.appointment_date}`}>
                      Open grooming schedule
                    </Link>
                  </Button>
                </div>
              </>
            )}

          </SheetContent>
        </Sheet>

        {/* ─── Edit Owner Drawer ─── */}
        <Sheet open={editOwnerOpen} onOpenChange={setEditOwnerOpen}>
          <SheetContent className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Edit Owner</SheetTitle>
              <SheetDescription>
                Update customer details.
              </SheetDescription>
            </SheetHeader>

            <form onSubmit={handleOwnerSubmit} className="mt-6 space-y-4">
              {/* Core */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_first_name">First name <span className="text-destructive">*</span></Label>
                  <Input id="edit_first_name" required value={ownerForm.first_name ?? ""} onChange={(e) => handleOwnerField("first_name", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_last_name">Last name <span className="text-destructive">*</span></Label>
                  <Input id="edit_last_name" required value={ownerForm.last_name ?? ""} onChange={(e) => handleOwnerField("last_name", e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_phone">Phone <span className="text-destructive">*</span></Label>
                  <Input id="edit_phone" type="tel" required value={ownerForm.phone ?? ""} onChange={(e) => handleOwnerField("phone", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_email">Email</Label>
                  <Input id="edit_email" type="email" value={ownerForm.email ?? ""} onChange={(e) => handleOwnerField("email", e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit_emirates_id">Emirates ID</Label>
                <Input id="edit_emirates_id" value={ownerForm.emirates_id ?? ""} onChange={(e) => handleOwnerField("emirates_id", e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit_address">Address</Label>
                <Textarea id="edit_address" rows={2} value={ownerForm.address ?? ""} onChange={(e) => handleOwnerField("address", e.target.value)} />
              </div>

              <Separator />

              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Emergency Contact</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_ec_name">Name</Label>
                  <Input id="edit_ec_name" value={ownerForm.emergency_contact_name ?? ""} onChange={(e) => handleOwnerField("emergency_contact_name", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_ec_phone">Phone</Label>
                  <Input id="edit_ec_phone" type="tel" value={ownerForm.emergency_contact_phone ?? ""} onChange={(e) => handleOwnerField("emergency_contact_phone", e.target.value)} />
                </div>
              </div>

              <Separator />

              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vet Details</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_vet_name">Vet name</Label>
                  <VetClinicCombobox
                    id="edit_vet_name"
                    value={ownerForm.vet_name ?? ""}
                    onChange={(v) => handleOwnerField("vet_name", v)}
                    onPhoneChange={(p) => handleOwnerField("vet_phone", p)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_vet_phone">Vet phone</Label>
                  <Input id="edit_vet_phone" type="tel" value={ownerForm.vet_phone ?? ""} onChange={(e) => handleOwnerField("vet_phone", e.target.value)} />
                </div>
              </div>

              <Separator />

              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preferences</p>

              <div className="space-y-2">
                <Label htmlFor="edit_preferred_groomer">Preferred groomer</Label>
                <Input
                  id="edit_preferred_groomer"
                  value={ownerForm.preferred_groomer ?? ""}
                  onChange={(e) => handleOwnerField("preferred_groomer", e.target.value)}
                  placeholder="Name of preferred groomer (optional)"
                />
                <p className="text-xs text-muted-foreground">
                  Pre-fills the groomer field on new grooming appointments. Edits on a booking do not change this.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit_how_heard">How did you hear about us?</Label>
                <Input id="edit_how_heard" value={ownerForm.how_heard ?? ""} onChange={(e) => handleOwnerField("how_heard", e.target.value)} />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="edit_is_vip" className="cursor-pointer">VIP</Label>
                <Switch id="edit_is_vip" checked={ownerForm.is_vip ?? false} onCheckedChange={(v) => handleOwnerToggle("is_vip", v)} />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="edit_always_same_room" className="cursor-pointer">Always same room</Label>
                <Switch id="edit_always_same_room" checked={ownerForm.always_same_room ?? false} onCheckedChange={(v) => handleOwnerToggle("always_same_room", v)} />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="edit_camera_required" className="cursor-pointer">Camera required</Label>
                <Switch id="edit_camera_required" checked={ownerForm.camera_required ?? false} onCheckedChange={(v) => handleOwnerToggle("camera_required", v)} />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="edit_notes">Notes</Label>
                <Textarea id="edit_notes" rows={3} value={ownerForm.notes ?? ""} onChange={(e) => handleOwnerField("notes", e.target.value)} />
              </div>

              <Button type="submit" className="w-full" disabled={updateOwner.isPending}>
                {updateOwner.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </form>
          </SheetContent>
        </Sheet>

        {/* ─── Add Pet Drawer ─── */}
        <Sheet open={addPetOpen} onOpenChange={setAddPetOpen}>
          <SheetContent className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Add Pet</SheetTitle>
              <SheetDescription>
                Register a new pet for {owner.first_name}.
              </SheetDescription>
            </SheetHeader>

            <form onSubmit={handlePetSubmit} className="mt-6 space-y-4">
              {/* Photo upload */}
              <div className="space-y-2">
                <Label>Photo</Label>
                <div className="flex items-center gap-4">
                  {photoPreview ? (
                    <img src={photoPreview} alt="Preview" className="h-16 w-16 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground text-xs">No photo</div>
                  )}
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { if (e.target.files?.[0]) handlePhotoSelect(e.target.files[0]); }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => photoInputRef.current?.click()}>
                    {photoPreview ? "Change photo" : "Upload photo"}
                  </Button>
                  {photoPreview && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setPhotoFile(null); setPhotoPreview(null); handlePetField("photo_url", ""); }}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>

              <Separator />

              {/* Basic info */}
              <div className="space-y-2">
                <Label htmlFor="pet_name">Name <span className="text-destructive">*</span></Label>
                <Input id="pet_name" required value={petForm.name} onChange={(e) => handlePetField("name", e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pet_species">Species</Label>
                  <Select value={petForm.species ?? "dog"} onValueChange={(v) => handlePetField("species", v)}>
                    <SelectTrigger id="pet_species"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dog">Dog</SelectItem>
                      <SelectItem value="cat">Cat</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pet_breed">Breed</Label>
                  <PetBreedCombobox
                    id="pet_breed"
                    value={(petForm.breed as string) ?? ""}
                    onChange={(v) => handlePetField("breed", v)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pet_colour">Colour</Label>
                  <Input id="pet_colour" value={(petForm.colour as string) ?? ""} onChange={(e) => handlePetField("colour", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pet_dob">Date of birth</Label>
                  <Input id="pet_dob" type="date" value={(petForm.date_of_birth as string) ?? ""} onChange={(e) => handlePetField("date_of_birth", e.target.value || null)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pet_weight">Weight (kg)</Label>
                  <Input id="pet_weight" type="number" step="0.1" min="0" value={petForm.weight_kg ?? ""} onChange={(e) => handlePetField("weight_kg", e.target.value ? Number(e.target.value) : null)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pet_gender">Gender</Label>
                  <Select value={petForm.gender ?? ""} onValueChange={(v) => handlePetField("gender", v || null)}>
                    <SelectTrigger id="pet_gender"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pet_size">
                  Size <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={petForm.size ?? ""}
                  onValueChange={(v) => handlePetField("size", v as Database["public"]["Enums"]["pet_size"])}
                >
                  <SelectTrigger id="pet_size" data-testid="owner-add-pet-size">
                    <SelectValue placeholder="Select size" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Small</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="large">Large</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Required for size-tiered boarding and grooming package pricing.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pet_microchip">Microchip number</Label>
                  <Input id="pet_microchip" value={(petForm.microchip_number as string) ?? ""} onChange={(e) => handlePetField("microchip_number", e.target.value)} />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3 col-span-1">
                  <Label htmlFor="pet_spayed" className="cursor-pointer">Spayed / Neutered</Label>
                  <Switch id="pet_spayed" checked={petForm.spayed_neutered ?? false} onCheckedChange={(v) => handlePetField("spayed_neutered", v)} />
                </div>
              </div>

              <Separator />

              {/* Vet */}
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vet Details</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pet_vet_name">Vet name</Label>
                  <VetClinicCombobox
                    id="pet_vet_name"
                    value={(petForm.vet_name as string) ?? ""}
                    onChange={(v) => handlePetField("vet_name", v)}
                    onPhoneChange={(p) => handlePetField("vet_phone", p)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pet_vet_phone">Vet phone</Label>
                  <Input id="pet_vet_phone" type="tel" value={(petForm.vet_phone as string) ?? ""} onChange={(e) => handlePetField("vet_phone", e.target.value)} />
                </div>
              </div>

              <Separator />

              {/* Care notes */}
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Care Notes</p>

              <div className="space-y-2">
                <Label htmlFor="pet_feeding">Feeding instructions</Label>
                <Textarea id="pet_feeding" rows={2} value={(petForm.feeding_notes as string) ?? ""} onChange={(e) => handlePetField("feeding_notes", e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pet_medical">Medical conditions</Label>
                <Textarea id="pet_medical" rows={2} value={(petForm.medical_conditions as string) ?? ""} onChange={(e) => handlePetField("medical_conditions", e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pet_meds">Medications</Label>
                <Textarea id="pet_meds" rows={2} value={(petForm.medication_notes as string) ?? ""} onChange={(e) => handlePetField("medication_notes", e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pet_behaviour">Behavioural notes</Label>
                <Textarea id="pet_behaviour" rows={2} value={(petForm.behaviour_notes as string) ?? ""} onChange={(e) => handlePetField("behaviour_notes", e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pet_grooming">Grooming notes</Label>
                <Textarea id="pet_grooming" rows={2} value={(petForm.grooming_notes as string) ?? ""} onChange={(e) => handlePetField("grooming_notes", e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pet_other_notes">Other notes (bookings &amp; appointments)</Label>
                <Textarea id="pet_other_notes" rows={2} value={(petForm.other_notes as string) ?? ""} onChange={(e) => handlePetField("other_notes", e.target.value)} placeholder="Shown on boarding, grooming…" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pet_assessment">Assessment status</Label>
                <Select value={petForm.assessment_status ?? "not_assessed"} onValueChange={(v) => handlePetField("assessment_status", v)}>
                  <SelectTrigger id="pet_assessment"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_assessed">Not Assessed</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="passed">Passed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* Vaccinations */}
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vaccination History</p>
              <VaccinationEditor
                mode="local"
                rows={vaccinationRows}
                onChange={setVaccinationRows}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={createPet.isPending || photoUploading || !petForm.size}
                data-testid="owner-add-pet-submit"
              >
                {(createPet.isPending || photoUploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {photoUploading ? "Uploading photo…" : "Add Pet"}
              </Button>
            </form>
          </SheetContent>
        </Sheet>
      </main>

      <PurchasePackageDialog
        ownerId={id!}
        isOpen={packageDialogOpen}
        onClose={() => setPackageDialogOpen(false)}
        onSuccess={() => {
          setPackageDialogOpen(false);
        }}
      />

      {/* ─── Pay from Wallet Confirmation ─── */}
      <AlertDialog open={payFromWalletOpen} onOpenChange={setPayFromWalletOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pay from wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              Apply wallet credit ({formatWalletAed(ownerBalances.combinedWallet)}) toward open
              invoices ({formatWalletAed(ownerBalances.invoiceRemainingTotal)})? Invoices are paid
              oldest due date first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={payAllPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={payAllPending}
              onClick={(e) => {
                e.preventDefault();
                setPayAllPending(true);
                void ownerBalances
                  .payAllOutstanding(staffName.trim() || "reception")
                  .finally(() => {
                    setPayAllPending(false);
                    setPayFromWalletOpen(false);
                  });
              }}
            >
              {payAllPending ? "Processing…" : "Confirm payment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Delete Confirmation Dialog ─── */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete customer account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">
                {ownerDisplayName(owner?.first_name ?? null, owner?.last_name ?? null)}
              </span>{" "}
              and all their pet profiles from the database. Customers with
              bookings, invoices, wallet activity, or other service history
              cannot be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteOwner.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteOwner.isPending}
              onClick={(e) => {
                e.preventDefault();
                deleteOwner.mutate(id!, {
                  onSuccess: () => {
                    toast.success("Customer deleted");
                    navigate("/customers");
                  },
                  onError: (err) => {
                    toast.error(err.message || "Failed to delete customer");
                  },
                });
              }}
            >
              {deleteOwner.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete permanently"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingDeletePet}
        onOpenChange={(open) => {
          if (!open && !deletePet.isPending) setPendingDeletePet(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete pet?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this pet?
              {pendingDeletePet ? (
                <>
                  {" "}
                  <span className="font-medium text-foreground">{pendingDeletePet.name}</span>{" "}
                  will be permanently removed. Pets with existing bookings or service history
                  cannot be deleted.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePet.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletePet.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingDeletePet || !id) return;
                deletePet.mutate(
                  { id: pendingDeletePet.id, ownerId: id },
                  {
                    onSuccess: () => {
                      toast.success(`${pendingDeletePet.name} deleted`);
                      setPendingDeletePet(null);
                    },
                    onError: (err) => {
                      toast.error(err.message || "Failed to delete pet");
                    },
                  },
                );
              }}
            >
              {deletePet.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={addBalanceOpen}
        onOpenChange={(open) => {
          if (!open && !manualTopUp.isPending) {
            setAddBalanceOpen(false);
            setAddBalanceAmount("");
            setAddBalanceNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Balance</DialogTitle>
            <DialogDescription>
              Credit this customer&apos;s wallet. The amount is added to their balance and recorded as a manual
              top-up.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const amount = parseFloat(addBalanceAmount);
              const note = addBalanceNote.trim();
              if (!amount || amount <= 0) {
                toast.error("Enter a valid amount.");
                return;
              }
              if (!note) {
                toast.error("Enter a reason or note.");
                return;
              }
              manualTopUp.mutate(
                {
                  owner_id: id!,
                  amount,
                  notes: note,
                  issued_by: staffName.trim() || "reception",
                },
                {
                  onSuccess: (data) => {
                    toast.success(`AED ${amount.toFixed(2)} added to wallet.`, {
                      action: data?.receipt_id
                        ? {
                            label: "Print receipt",
                            onClick: () =>
                              window.open(
                                `/print/topup-receipt/${data.receipt_id}`,
                                "_blank",
                                "noopener,noreferrer",
                              ),
                          }
                        : undefined,
                    });
                    setAddBalanceAmount("");
                    setAddBalanceNote("");
                    setAddBalanceOpen(false);
                  },
                  onError: (err) => toast.error(err.message || "Failed to add balance."),
                },
              );
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="add_balance_amount">
                Amount (AED) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="add_balance_amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={addBalanceAmount}
                onChange={(e) => setAddBalanceAmount(e.target.value)}
                disabled={manualTopUp.isPending}
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add_balance_note">
                Reason / note <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="add_balance_note"
                rows={3}
                placeholder="e.g. Cash received at reception"
                value={addBalanceNote}
                onChange={(e) => setAddBalanceNote(e.target.value)}
                disabled={manualTopUp.isPending}
                required
              />
            </div>
            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddBalanceOpen(false)}
                disabled={manualTopUp.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={manualTopUp.isPending} className="bg-emerald-600 hover:bg-emerald-700">
                {manualTopUp.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Balance
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default OwnerProfilePage;
