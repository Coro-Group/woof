import { useState, useEffect, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  addDays,
  format,
  isValid,
  parse,
  parseISO,
  subDays,
} from "date-fns";
import { isValidIsoDate } from "@/lib/petProfileFields";
import TopBar from "@/components/dashboard/TopBar";
import { useAuth } from "@/contexts/AuthContext";
import { ownerDisplayName } from "@/lib/bookingUtils";
import {
  useGroomingAppointments,
  useUpdateGroomingAppointment,
  useGroomingStatusTransition,
  useInvoiceForGroomingAppointment,
  useGroomingDayInvoices,
  useFinalizeGroomingCheckout,
  invalidateGrooming,
  useSyncGroomingInvoicePrice,
  sumGroomingInvoicePaidAed,
  sumGroomingInvoicePendingAed,
  type GroomingAppointmentWithJoins,
} from "@/hooks/useGrooming";
import { formatAed } from "@/hooks/useBilling";
import {
  normalizeGroomingWorkflowStatus,
  previousWorkflowStatus,
  workflowStatusBadgeClass,
  workflowStatusLabel,
  type GroomingWorkflowStatus,
} from "@/lib/groomingWorkflow";
import {
  invoiceDisplayTotals,
  vatAmountFromGrossInclusive,
  vatLineLabel,
} from "@/lib/vatConfig";
import {
  groomingPaymentMethodLabel,
} from "@/lib/groomingPaymentMethod";
import { groomingPriceAed } from "@/lib/groomingCheckoutInvoice";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PetSpecialAlertsBanner } from "@/components/PetSpecialAlertsBanner";
import { DogSizeField } from "@/components/DogSizeField";
import { parsePetSpecialAlerts, petHasSpecialAlerts } from "@/lib/petAlerts";
import {
  groomingPricingCheckboxToDbService,
  isGroomingPricingCheckbox,
  resolvePrimaryGroomingCheckbox,
} from "@/lib/groomingNewAppointmentPricing";
import { VisitNotesField } from "@/components/grooming/VisitNotesField";
import { GroomingDayBoard } from "@/components/grooming/GroomingDayBoard";
import { GroomingHistory } from "@/components/grooming/GroomingHistory";
import { GroomingConflictOverrideDialog } from "@/components/grooming/GroomingConflictOverrideDialog";
import {
  GroomingNewAppointmentSheet,
  type GroomingSlotPrefill,
} from "@/components/grooming/GroomingNewAppointmentSheet";
import { GroomingPackagesTab } from "@/components/grooming/GroomingPackagesTab";
import {
  GROOMING_SERVICE_CHECKBOX_OPTIONS,
  estimatedPickupFromStartAndDuration,
  serviceTokenMatchesSavedOption,
  type GroomingServiceCheckbox,
} from "@/lib/groomingServiceForm";
import { useGroomingStations } from "@/hooks/useGroomingStations";
import { useCurrentStaffName } from "@/hooks/useCurrentStaffName";
import {
  usePetGroomingNoteForAppointment,
  useUpsertPetGroomingNote,
} from "@/hooks/usePetGroomingNotes";
import {
  logGroomingCapacityOverride,
  rpcValidateGroomingAppt,
} from "@/hooks/useGroomingCapacity";
import {
  maxDurationMinutesForTimeInput,
  validateGroomingScheduleTime,
  warningsToScheduleConflicts,
  type GroomingScheduleConflict,
} from "@/lib/groomingScheduleUtils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Undo2,
  X,
  CalendarIcon,
  ClipboardList,
  FileText,
  LayoutGrid,
  List,
} from "lucide-react";
import { toast } from "sonner";
import { BookingProfileNotes } from "@/components/BookingProfileNotes";
import { cn } from "@/lib/utils";
import {
  labelForGroomingService,
  type GroomingService,
} from "@/lib/groomingCatalog";
import { GroomingGroomerSelect } from "@/components/grooming/GroomingGroomerSelect";
import { useGroomingGroomers } from "@/hooks/useGroomingGroomers";
import { activeLinkedStayLabel } from "@/lib/groomingBoardUi";

const SERVICE_BADGE: Record<GroomingService, string> = {
  full_groom: "bg-purple-100 text-purple-800 border-purple-200",
  full_bath: "bg-blue-100 text-blue-800 border-blue-200",
  splash: "bg-cyan-100 text-cyan-800 border-cyan-200",
  tidy: "bg-sky-100 text-sky-800 border-sky-200",
  nail_clip: "bg-emerald-100 text-emerald-800 border-emerald-200",
  gland_expression: "bg-lime-100 text-lime-800 border-lime-200",
  deshedding: "bg-orange-100 text-orange-800 border-orange-200",
  brushing: "bg-teal-100 text-teal-800 border-teal-200",
  pawdicure: "bg-pink-100 text-pink-800 border-pink-200",
};

function parseGroomingMeta(
  notes: string | null | undefined,
): { services: string[]; groomingDate: string | null; estimatedPickup: string | null } {
  if (!notes) return { services: [], groomingDate: null, estimatedPickup: null };
  const lines = notes
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const servicesLine = lines.find((l) => l.toLowerCase().startsWith("services:"));
  const groomingDateLine = lines.find((l) =>
    l.toLowerCase().startsWith("grooming date:"),
  );
  const estimatedPickupLine = lines.find((l) =>
    l.toLowerCase().startsWith("estimated pickup:"),
  );
  const services = servicesLine
    ? servicesLine
        .slice("services:".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const groomingDate = groomingDateLine
    ? groomingDateLine.slice("grooming date:".length).trim() || null
    : null;
  const estimatedPickup = estimatedPickupLine
    ? estimatedPickupLine.slice("estimated pickup:".length).trim() || null
    : null;
  return { services, groomingDate, estimatedPickup };
}

function chipMatchesServiceFilter(label: string, filter: string): boolean {
  if (filter === "all") return true;
  const fl = filter.toLowerCase().trim();
  const ll = label.trim().toLowerCase();
  if (ll === fl) return true;
  if (ll.startsWith(`${fl} (`)) return true;
  if (ll.startsWith(`${fl} —`) || ll.startsWith(`${fl} -`)) return true;
  return false;
}

function eodAppointmentStatusBucket(status: string): "completed" | "pending" | "cancelled" {
  const n = normalizeGroomingWorkflowStatus(status);
  if (n === "cancelled") return "cancelled";
  if (n === "completed" || n === "paid") return "completed";
  return "pending";
}

function appointmentServiceLabels(a: GroomingAppointmentWithJoins): string[] {
  const primary = serviceLabel(a.service);
  const extra = parseGroomingMeta(a.notes).services;
  return Array.from(new Set([primary, ...extra]));
}

function appointmentTimeToInputValue(t: string | null): string {
  if (!t) return "10:00";
  const s = t.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : "10:00";
}

function userVisitNotesFromStored(notes: string | null): string {
  if (!notes) return "";
  const metaPrefixes = ["services:", "grooming date:", "discount:", "estimated pickup:"];
  return notes
    .split("\n")
    .filter((l) => !metaPrefixes.some((p) => l.toLowerCase().trimStart().startsWith(p)))
    .join("\n")
    .trim();
}

function workflowUndoTarget(raw: string): string | null {
  const wf = normalizeGroomingWorkflowStatus(raw);
  if (wf === "cancelled" || wf === "other") return null;
  return previousWorkflowStatus(wf as GroomingWorkflowStatus);
}

function serviceCheckboxValuesFromAppointment(
  a: GroomingAppointmentWithJoins,
): GroomingServiceCheckbox[] {
  const { services } = parseGroomingMeta(a.notes);

  /** Prefer first saved service label so distinct checkboxes that share one enum (e.g. Bath only vs Full bath) round-trip correctly. */
  let primary: GroomingServiceCheckbox | undefined;
  if (services.length > 0) {
    const first = services[0].trim();
    const byLabel = GROOMING_SERVICE_CHECKBOX_OPTIONS.find((o) =>
      serviceTokenMatchesSavedOption(first, o.label),
    );
    if (byLabel) primary = byLabel.value;
  }
  if (!primary) {
    const primaryOpt = GROOMING_SERVICE_CHECKBOX_OPTIONS.find((o) => o.mapsTo === a.service);
    primary = primaryOpt?.value;
  }

  const extras = GROOMING_SERVICE_CHECKBOX_OPTIONS.filter((o) =>
    services.some((token) => serviceTokenMatchesSavedOption(token, o.label)),
  ).map((o) => o.value);
  const set = new Set<GroomingServiceCheckbox>();
  if (primary) set.add(primary);
  extras.forEach((e) => set.add(e));
  const arr = Array.from(set);
  return arr.length ? arr : ["full_groom"];
}

function serviceLabel(s: GroomingService): string {
  return labelForGroomingService(s);
}

function formatApptTime(t: string | null): string {
  if (!t) return "—";
  const slice = t.length >= 8 ? t.slice(0, 8) : `${t}:00`.slice(0, 8);
  try {
    const base = parse(slice, "HH:mm:ss", new Date(2000, 0, 1));
    return format(base, "h:mm a");
  } catch {
    return t;
  }
}

function groomerDisplay(a: GroomingAppointmentWithJoins): string {
  if (a.grooming_notes?.trim()) return a.grooming_notes.trim();
  return "—";
}

function AppointmentCard({
  a,
  onPrint,
  onOpenActions,
}: {
  a: GroomingAppointmentWithJoins;
  onPrint: (appointmentId: string) => void;
  onOpenActions: (row: GroomingAppointmentWithJoins) => void;
}) {
  const ownerName = a.owners
    ? ownerDisplayName(a.owners.first_name, a.owners.last_name)
    : "—";
  const phone = a.owners?.phone ?? "";
  const petName = a.pets?.name ?? "—";
  const breedWeight = [
    a.pets?.breed,
    a.pets?.weight_kg != null ? `${a.pets.weight_kg}kg` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const duration = a.duration_minutes ?? 60;
  const { services: selectedServiceLabels } = parseGroomingMeta(a.notes);
  const linkedStay = activeLinkedStayLabel(a.bookings, a.appointment_date);
  const primaryLabel = serviceLabel(a.service);
  const extraServiceLabels = selectedServiceLabels.filter(
    (s) => s.toLowerCase() !== primaryLabel.toLowerCase(),
  );

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => onOpenActions(a)}
    >
      <CardContent className="p-0">
        <div className="grid gap-4 p-4 lg:grid-cols-[10rem_1fr_14rem] lg:items-start">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn("font-medium border", workflowStatusBadgeClass(a.status))}
              >
                {workflowStatusLabel(a.status)}
              </Badge>
            </div>
            <p className="text-2xl font-semibold tabular-nums">
              {formatApptTime(a.appointment_time)}
            </p>
            <Badge variant="outline" className="font-normal">
              {duration} min
            </Badge>
          </div>

          <div className="space-y-2 min-w-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <p className="text-xl font-bold truncate">{petName}</p>
              {petHasSpecialAlerts(parsePetSpecialAlerts(a.pets?.special_alerts)) ? (
                <Badge
                  variant="outline"
                  className="shrink-0 border-orange-500 bg-orange-100 text-orange-950 text-[10px] font-semibold uppercase tracking-wide"
                >
                  ⚠ Alert
                </Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {breedWeight || "—"}
            </p>
            <p className="text-sm">
              <span className="font-medium">{ownerName}</span>
              {phone ? (
                <>
                  {" · "}
                  <a
                    href={`tel:${phone.replace(/\s/g, "")}`}
                    className="text-primary hover:underline"
                  >
                    {phone}
                  </a>
                </>
              ) : null}
            </p>
            {a.pets?.grooming_notes ? (
              <p className="text-sm italic text-muted-foreground whitespace-pre-line">
                {a.pets.grooming_notes}
              </p>
            ) : null}
            <BookingProfileNotes
              compact
              ownerOtherNotes={a.owners?.other_notes}
              pets={[
                {
                  name: petName,
                  otherNotes: a.pets?.other_notes,
                },
              ]}
            />
            <div className="pt-1">
              <Label className="text-xs text-muted-foreground">Visit notes</Label>
              <VisitNotesField a={a} />
            </div>
          </div>

          <div className="space-y-3 lg:text-right">
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Badge
                variant="outline"
                className={cn("font-medium", SERVICE_BADGE[a.service])}
              >
                {primaryLabel}
              </Badge>
              {extraServiceLabels.map((label) => (
                <Badge
                  key={`${a.id}-${label}`}
                  variant="outline"
                  className="bg-muted/40 text-foreground border-border"
                >
                  {label}
                </Badge>
              ))}
              {linkedStay ? (
                <Badge
                  variant="outline"
                  className="gap-1 bg-slate-50 text-slate-800 border-slate-200"
                >
                  <Package className="h-3 w-3" />
                  {linkedStay}
                </Badge>
              ) : null}
            </div>
            <p className="text-lg font-semibold tabular-nums">
              AED {a.price != null ? a.price.toFixed(0) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Payment:{" "}
              <span className="text-foreground font-medium">
                {groomingPaymentMethodLabel(a.payment_method)}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              Groomer:{" "}
              <span className="text-foreground font-medium">
                {groomerDisplay(a)}
              </span>
            </p>

            <div className="flex flex-col gap-2 lg:items-end" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                variant="outline"
                className="w-full lg:w-auto"
                onClick={() => onPrint(a.id)}
              >
                <Printer className="mr-2 h-4 w-4" />
                Print card
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const GROOMING_INVOICE_RETURN_TO = "/grooming";

function parseGroomingPageDay(value: string): Date | null {
  if (!isValidIsoDate(value)) return null;
  return parseISO(value.slice(0, 10));
}

const GroomingPage = () => {
  const [searchParams] = useSearchParams();
  const [day, setDay] = useState(() => new Date());

  const dateParam = searchParams.get("date");
  useEffect(() => {
    if (!dateParam) return;
    if (dateParam === "today") {
      setDay((prev) => {
        const next = new Date();
        return format(prev, "yyyy-MM-dd") === format(next, "yyyy-MM-dd") ? prev : next;
      });
      return;
    }
    const parsed = parseGroomingPageDay(dateParam);
    if (parsed) setDay(parsed);
  }, [dateParam]);

  const safeDay = isValid(day) ? day : new Date();
  const dateStr = format(safeDay, "yyyy-MM-dd");
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const [groomingTab, setGroomingTab] = useState("day");
  const [dayViewMode, setDayViewMode] = useState<"calendar" | "list">("calendar");
  const { data: dayAppointments = [] } = useGroomingAppointments(dateStr);
  const { data: groomingStations = [], isLoading: stationsLoading } = useGroomingStations();
  const { staffName } = useCurrentStaffName();
  const upsertPetGroomingNote = useUpsertPetGroomingNote();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [slotPrefill, setSlotPrefill] = useState<GroomingSlotPrefill | null>(null);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [pendingConflicts, setPendingConflicts] = useState<GroomingScheduleConflict[]>([]);
  const [eodReportOpen, setEodReportOpen] = useState(false);
  const [actionGroomingNote, setActionGroomingNote] = useState("");

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const statusTransition = useGroomingStatusTransition();
  const finalizeCheckout = useFinalizeGroomingCheckout();
  const updateAppt = useUpdateGroomingAppointment();
  const syncInvoicePrice = useSyncGroomingInvoicePrice();

  const [actionAppt, setActionAppt] = useState<GroomingAppointmentWithJoins | null>(null);
  const [editAppt, setEditAppt] = useState<GroomingAppointmentWithJoins | null>(null);
  const [cancelTarget, setCancelTarget] = useState<GroomingAppointmentWithJoins | null>(null);

  const [editSelectedServices, setEditSelectedServices] = useState<GroomingServiceCheckbox[]>([
    "full_groom",
  ]);
  const [editApptDate, setEditApptDate] = useState<Date>(new Date());
  const [editApptTime, setEditApptTime] = useState("10:00");
  const [editDurationMin, setEditDurationMin] = useState(60);
  const [editStationId, setEditStationId] = useState<string | null>(null);
  const [editGroomerName, setEditGroomerName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editVisitNotes, setEditVisitNotes] = useState("");
  const [editFormApptId, setEditFormApptId] = useState<string | null>(null);

  const { data: groomers = [] } = useGroomingGroomers();

  const transitionActionAppt = useCallback(
    (toStatus: string, successMessage: string, opts?: { isUndo?: boolean }) => {
      if (!actionAppt) return;
      statusTransition.mutate(
        { id: actionAppt.id, toStatus, isUndo: opts?.isUndo },
        {
          onSuccess: async (data) => {
            setActionAppt((prev) =>
              prev && prev.id === data.id ? { ...prev, status: data.status } : prev,
            );
            if (
              normalizeGroomingWorkflowStatus(toStatus) === "completed" &&
              !opts?.isUndo
            ) {
              try {
                const result = await finalizeCheckout.mutateAsync({
                  appointmentId: data.id,
                  performedBy: staffName.trim() || session?.user?.email || undefined,
                });
                setActionAppt((prev) =>
                  prev && prev.id === data.id
                    ? { ...prev, invoice_id: result.invoiceId }
                    : prev,
                );
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "Invoice could not be finalized at checkout.",
                );
              }
            }
            toast.success(successMessage);
          },
          onError: (e) =>
            toast.error(e instanceof Error ? e.message : "Update failed."),
        },
      );
    },
    [actionAppt, finalizeCheckout, session?.user?.email, staffName, statusTransition],
  );

  const openGroomingInvoice = useCallback(
    (invoiceId: string) => {
      navigate(
        `/billing/invoices/${invoiceId}?returnTo=${encodeURIComponent(GROOMING_INVOICE_RETURN_TO)}`,
      );
      setActionAppt(null);
    },
    [navigate],
  );

  const eodApptIds = useMemo(() => dayAppointments.map((a) => a.id), [dayAppointments]);
  const { data: eodInvoices = [], isFetching: eodInvoicesLoading } = useGroomingDayInvoices(
    eodApptIds,
    { enabled: eodReportOpen },
  );

  const { data: panelInvoice, isLoading: panelInvoiceLoading } =
    useInvoiceForGroomingAppointment(actionAppt?.id ?? null);
  const { data: existingPetGroomingNote } = usePetGroomingNoteForAppointment(
    actionAppt?.id ?? null,
  );

  const panelInvoiceTotals = useMemo(() => {
    if (!panelInvoice) return null;
    const display = invoiceDisplayTotals({
      total: panelInvoice.total ?? 0,
      vat_aed: panelInvoice.vat_aed,
    });
    const amountPaid = panelInvoice.amount_paid ?? 0;
    return {
      subtotal: panelInvoice.subtotal ?? 0,
      discount: panelInvoice.discount_amount ?? 0,
      netExVat: display.netExVat,
      vat: display.vat,
      grandTotal: display.grandTotal,
      amountPaid,
      outstanding: Math.max(0, display.grandTotal - amountPaid),
    };
  }, [panelInvoice]);

  const actionApptPriceMismatch = useMemo(() => {
    if (!actionAppt || !panelInvoiceTotals) return false;
    return (
      Math.abs(groomingPriceAed(actionAppt.price) - panelInvoiceTotals.grandTotal) > 0.001
    );
  }, [actionAppt, panelInvoiceTotals]);

  const eodStatusCounts = useMemo(() => {
    let completed = 0;
    let pending = 0;
    let cancelled = 0;
    for (const a of dayAppointments) {
      const b = eodAppointmentStatusBucket(a.status);
      if (b === "cancelled") cancelled++;
      else if (b === "completed") completed++;
      else pending++;
    }
    return { completed, pending, cancelled, total: dayAppointments.length };
  }, [dayAppointments]);

  const eodPaidTotal = useMemo(() => sumGroomingInvoicePaidAed(eodInvoices), [eodInvoices]);
  const eodPendingTotal = useMemo(() => sumGroomingInvoicePendingAed(eodInvoices), [eodInvoices]);

  const visibleDayAppointments = useMemo(
    () =>
      [...dayAppointments]
        .filter(
          (a) =>
            normalizeGroomingWorkflowStatus(a.status) !== "cancelled" && !a.no_show,
        )
        .sort((a, b) => {
          const ta = a.appointment_time ?? "99:99:99";
          const tb = b.appointment_time ?? "99:99:99";
          return ta.localeCompare(tb);
        }),
    [dayAppointments],
  );

  const openPrintForDay = useCallback(() => {
    window.open(`/print/grooming-cards?date=${dateStr}`, "_blank", "noopener,noreferrer");
  }, [dateStr]);

  const openNewSheet = () => {
    setSlotPrefill(null);
    setSheetOpen(true);
  };

  const openNewSheetFromSlot = (slotStationId: string, timeHHMM: string) => {
    setSlotPrefill({ stationId: slotStationId, time: timeHHMM });
    setSheetOpen(true);
  };

  const timeToDb = (t: string) => {
    const parts = t.split(":");
    const h = parts[0] ?? "10";
    const m = parts[1] ?? "00";
    return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`;
  };

  useEffect(() => {
    setActionGroomingNote(existingPetGroomingNote?.note ?? "");
  }, [existingPetGroomingNote?.note, actionAppt?.id]);

  useEffect(() => {
    if (!editAppt) {
      setEditFormApptId(null);
      return;
    }
    if (editAppt.id === editFormApptId) return;
    setEditFormApptId(editAppt.id);
    setEditSelectedServices(serviceCheckboxValuesFromAppointment(editAppt));
    setEditApptDate(
      isValidIsoDate(editAppt.appointment_date)
        ? parseISO(editAppt.appointment_date.slice(0, 10))
        : new Date(),
    );
    setEditApptTime(appointmentTimeToInputValue(editAppt.appointment_time));
    setEditDurationMin(editAppt.duration_minutes ?? 60);
    setEditStationId(editAppt.station_id ?? null);
    setEditGroomerName(editAppt.grooming_notes ?? "");
    setEditPrice(editAppt.price != null ? String(editAppt.price) : "");
    setEditVisitNotes(userVisitNotesFromStored(editAppt.notes));
  }, [editAppt, editFormApptId]);

  useEffect(() => {
    const max = maxDurationMinutesForTimeInput(editApptTime);
    if (max > 0 && editDurationMin > max) setEditDurationMin(max);
  }, [editApptTime, editDurationMin]);

  const performSaveEdit = async (overrideReason?: string) => {
    if (!editAppt || updateAppt.isPending) return;
    if (editSelectedServices.length === 0) {
      toast.error("Select at least one service.");
      return;
    }
    const hasTime = editApptTime.trim().length > 0;
    if (hasTime && !/^\d{2}:\d{2}$/.test(editApptTime)) {
      toast.error("Enter a valid appointment time.");
      return;
    }
    if (hasTime) {
      const scheduleErr = validateGroomingScheduleTime(editApptTime, editDurationMin);
      if (scheduleErr) {
        toast.error(scheduleErr);
        return;
      }
    }
    const primaryCb = resolvePrimaryGroomingCheckbox(
      editSelectedServices.filter(isGroomingPricingCheckbox),
    );
    const primaryService = primaryCb ? groomingPricingCheckboxToDbService(primaryCb) : null;
    if (!primaryService) {
      toast.error("Could not resolve a valid service.");
      return;
    }
    const priceNum = parseFloat(editPrice);
    const finalPrice =
      Number.isFinite(priceNum) && priceNum >= 0 ? Number(priceNum.toFixed(2)) : NaN;
    if (Number.isNaN(finalPrice)) {
      toast.error("Enter a valid price.");
      return;
    }
    const selectedServiceLabels = editSelectedServices
      .map((svc) =>
        GROOMING_SERVICE_CHECKBOX_OPTIONS.find((o) => o.value === svc)?.label ?? svc,
      )
      .join(", ");
    const metaNotes = [
      selectedServiceLabels ? `Services: ${selectedServiceLabels}` : null,
      `Grooming date: ${format(editApptDate, "yyyy-MM-dd")}`,
      `Estimated pickup: ${estimatedPickupFromStartAndDuration(editApptTime, editDurationMin)}`,
    ].filter(Boolean);
    const composedNotes = [editVisitNotes.trim(), ...metaNotes].filter(Boolean).join("\n");

    const appointmentDate = format(editApptDate, "yyyy-MM-dd");
    const hasSchedule = hasTime && !!editStationId;
    let warnings: { code: string; msg: string }[] = [];
    if (hasSchedule) {
      const validation = await rpcValidateGroomingAppt({
        date: appointmentDate,
        stationId: editStationId,
        start: timeToDb(editApptTime),
        duration: editDurationMin,
        apptId: editAppt.id,
      });
      warnings = validation.warnings ?? [];
      if (!validation.ok && warnings.length > 0 && !overrideReason) {
        setPendingConflicts(warningsToScheduleConflicts(warnings));
        setConflictDialogOpen(true);
        return;
      }
    }

    const priorAppointmentDate = editAppt.appointment_date;

    updateAppt.mutate(
      {
        id: editAppt.id,
        appointment_date: appointmentDate,
        appointment_time: hasTime ? timeToDb(editApptTime) : null,
        duration_minutes: editDurationMin,
        station_id: editStationId,
        service: primaryService,
        grooming_notes: editGroomerName.trim() || null,
        price: finalPrice,
        notes: composedNotes || null,
      },
      {
        onSuccess: async ({ row: data, invoiceSync }) => {
          if (priorAppointmentDate !== data.appointment_date) {
            invalidateGrooming(queryClient, {
              appointmentDate: priorAppointmentDate,
              petId: data.pet_id,
              ownerId: data.owner_id,
            });
          }
          if (overrideReason && warnings.length > 0) {
            try {
              await logGroomingCapacityOverride({
                appointmentId: data.id,
                jobDate: appointmentDate,
                warnings,
                reason: overrideReason,
                staff: session?.user?.email ?? null,
              });
            } catch (e) {
              toast.error(
                e instanceof Error ? e.message : "Saved, but override audit log failed.",
              );
            }
          }
          toast.success("Appointment updated.");
          if (invoiceSync?.kind === "synced") {
            toast.success(`Invoice updated to AED ${invoiceSync.total.toFixed(2)}.`);
          } else if (invoiceSync?.kind === "skipped") {
            toast.warning(`Appointment saved, but invoice was not updated: ${invoiceSync.reason}`);
          } else if (invoiceSync?.kind === "no_invoice") {
            toast.warning("Appointment saved, but no linked invoice was found to update.");
          }
          setEditAppt(null);
          setActionAppt(null);
          setConflictDialogOpen(false);
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not save changes."),
      },
    );
  };

  const handleSaveEdit = () => {
    void performSaveEdit();
  };

  const saveActionGroomingNote = () => {
    if (!actionAppt || !actionGroomingNote.trim()) return;
    upsertPetGroomingNote.mutate(
      {
        petId: actionAppt.pet_id,
        appointmentId: actionAppt.id,
        note: actionGroomingNote,
        writtenBy: staffName.trim() || session?.user?.email || "Staff",
      },
      {
        onSuccess: () => toast.success("Grooming note saved"),
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not save grooming note"),
      },
    );
  };

  const showGroomingNoteEditor =
    actionAppt &&
    (normalizeGroomingWorkflowStatus(actionAppt.status) === "in_progress" ||
      normalizeGroomingWorkflowStatus(actionAppt.status) === "completed");

  return (
    <>
      <TopBar title="Grooming" />
      <Dialog open={eodReportOpen} onOpenChange={setEodReportOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b px-6 py-4 text-left">
            <DialogTitle className="pr-8">End of Day Report — Grooming</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {format(safeDay, "EEEE, d MMMM yyyy")} · {eodStatusCounts.total} appointment
              {eodStatusCounts.total === 1 ? "" : "s"}
            </p>
          </DialogHeader>
          <div
            id="grooming-eod-report-root"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Completed</p>
                <p className="text-2xl font-semibold tabular-nums">{eodStatusCounts.completed}</p>
              </div>
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-2xl font-semibold tabular-nums">{eodStatusCounts.pending}</p>
              </div>
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Cancelled</p>
                <p className="text-2xl font-semibold tabular-nums">{eodStatusCounts.cancelled}</p>
              </div>
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-2xl font-semibold tabular-nums">{eodStatusCounts.total}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/90 px-3 py-3">
                <p className="text-xs font-medium text-emerald-900">
                  Revenue collected (paid invoices)
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-950">
                  {eodInvoicesLoading ? "…" : formatAed(eodPaidTotal)}
                </p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-3">
                <p className="text-xs font-medium text-amber-950">
                  Revenue pending (unpaid / draft invoices)
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-amber-950">
                  {eodInvoicesLoading ? "…" : formatAed(eodPendingTotal)}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Appointments</h3>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pet</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Dog size</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dayAppointments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No appointments for this date.
                        </TableCell>
                      </TableRow>
                    ) : (
                      dayAppointments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{a.pets?.name ?? "—"}</TableCell>
                          <TableCell>
                            {a.owners
                              ? ownerDisplayName(a.owners.first_name, a.owners.last_name)
                              : "—"}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs">
                            {appointmentServiceLabels(a).join(" · ")}
                          </TableCell>
                          <TableCell>—</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {a.price != null ? formatAed(a.price) : "—"}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "inline-flex rounded border px-2 py-0.5 text-xs font-medium",
                                workflowStatusBadgeClass(a.status),
                              )}
                            >
                              {workflowStatusLabel(a.status)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
          <DialogFooter className="border-t px-6 py-3 print:hidden">
            <Button type="button" variant="outline" onClick={() => setEodReportOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <main className="flex-1 overflow-auto p-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Previous day"
              onClick={() => setDay((d) => subDays(isValid(d) ? d : new Date(), 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-w-[12rem] justify-center px-3 py-2 text-base font-semibold sm:text-xl"
                  data-testid="grooming-day-date-picker"
                >
                  <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                  {format(safeDay, "EEEE, d MMMM yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="center">
                <Calendar
                  mode="single"
                  selected={safeDay}
                  defaultMonth={safeDay}
                  onSelect={(d) => d && setDay(d)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Next day"
              onClick={() => setDay((d) => addDays(isValid(d) ? d : new Date(), 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDay(new Date())}
            >
              Today
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEodReportOpen(true)}
            >
              <ClipboardList className="mr-2 h-4 w-4" />
              End of Day Report
            </Button>
            <Button type="button" onClick={openNewSheet}>
              <Plus className="mr-2 h-4 w-4" />
              New Appointment
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                window.open(`/print/grooming-cards?date=${dateStr}`, "_blank", "noopener,noreferrer")
              }
            >
              <Printer className="mr-2 h-4 w-4" />
              Print today's cards
            </Button>
          </div>
        </div>

        <Tabs value={groomingTab} onValueChange={setGroomingTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="day">Day View</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="packages">Packages</TabsTrigger>
          </TabsList>

          <TabsContent value="day" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ToggleGroup
                type="single"
                value={dayViewMode}
                onValueChange={(value) => {
                  if (value === "calendar" || value === "list") setDayViewMode(value);
                }}
                variant="outline"
                size="sm"
                data-testid="grooming-day-view-toggle"
              >
                <ToggleGroupItem value="calendar" aria-label="Calendar view" data-testid="grooming-day-view-calendar">
                  <LayoutGrid className="mr-1.5 h-4 w-4" />
                  Calendar
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="List view" data-testid="grooming-day-view-list">
                  <List className="mr-1.5 h-4 w-4" />
                  List
                </ToggleGroupItem>
              </ToggleGroup>
              <p className="text-xs text-muted-foreground tabular-nums">
                {visibleDayAppointments.length} active appointment
                {visibleDayAppointments.length === 1 ? "" : "s"}
              </p>
            </div>

            {dayViewMode === "calendar" ? (
              stationsLoading ? (
                <Skeleton className="min-h-[480px] w-full" />
              ) : (
                <GroomingDayBoard
                  date={dateStr}
                  onDateChange={(d) => {
                    const parsed = parseGroomingPageDay(d);
                    if (parsed) setDay(parsed);
                  }}
                  staffLabel={session?.user?.email ?? "staff"}
                  onEmptySlotClick={openNewSheetFromSlot}
                  onAppointmentClick={(id) => {
                    const found = dayAppointments.find((a) => a.id === id);
                    if (found) setActionAppt(found);
                  }}
                />
              )
            ) : (
              <section className="space-y-3" data-testid="grooming-day-appointment-list">
                {visibleDayAppointments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active appointments for this date.</p>
                ) : (
                  <div className="grid gap-3">
                    {visibleDayAppointments.map((a) => (
                      <AppointmentCard
                        key={a.id}
                        a={a}
                        onPrint={openPrintForDay}
                        onOpenActions={setActionAppt}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <GroomingHistory todayStr={todayStr} active={groomingTab === "history"} />
          </TabsContent>

          <TabsContent value="packages" className="space-y-4">
            <GroomingPackagesTab />
          </TabsContent>
        </Tabs>
      </main>

      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              The slot will be marked as cancelled. It will appear in the History tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!cancelTarget) return;
                statusTransition.mutate(
                  { id: cancelTarget.id, toStatus: "cancelled" },
                  {
                    onSuccess: () => {
                      toast.success("Appointment cancelled.");
                      setCancelTarget(null);
                      setActionAppt(null);
                    },
                    onError: (e) =>
                      toast.error(e instanceof Error ? e.message : "Could not cancel."),
                  },
                );
              }}
            >
              Cancel appointment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={!!actionAppt} onOpenChange={(o) => !o && setActionAppt(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Grooming appointment</SheetTitle>
            <SheetDescription>
              {actionAppt
                ? `${actionAppt.pets?.name ?? "Pet"} · ${actionAppt.owners ? ownerDisplayName(actionAppt.owners.first_name, actionAppt.owners.last_name) : "—"}`
                : ""}
            </SheetDescription>
          </SheetHeader>
          {actionAppt && (
            <div className="mt-6 flex flex-col gap-3">
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Status</span>
                <Badge
                  variant="outline"
                  className={cn("border font-medium", workflowStatusBadgeClass(actionAppt.status))}
                >
                  {workflowStatusLabel(actionAppt.status)}
                </Badge>
              </div>

              {showGroomingNoteEditor ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <Label htmlFor="action-grooming-note">Grooming notes</Label>
                  <Textarea
                    id="action-grooming-note"
                    value={actionGroomingNote}
                    onChange={(e) => setActionGroomingNote(e.target.value)}
                    placeholder="Session notes for this groom…"
                    rows={4}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!actionGroomingNote.trim() || upsertPetGroomingNote.isPending}
                    onClick={saveActionGroomingNote}
                  >
                    Save grooming note
                  </Button>
                </div>
              ) : null}

              {normalizeGroomingWorkflowStatus(actionAppt.status) === "new" && (
                <>
                  <Button
                    data-testid="grooming-check-in-btn"
                    disabled={statusTransition.isPending}
                    onClick={() => transitionActionAppt("checked_in", "Checked in.")}
                  >
                    Check In
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditAppt(actionAppt);
                      setActionAppt(null);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  <Button variant="destructive" onClick={() => setCancelTarget(actionAppt)}>
                    Cancel
                  </Button>
                </>
              )}

              {normalizeGroomingWorkflowStatus(actionAppt.status) === "checked_in" && (
                <>
                  <Button
                    variant="outline"
                    disabled={statusTransition.isPending}
                    onClick={() => transitionActionAppt("in_progress", "Started grooming.")}
                  >
                    Start grooming
                  </Button>
                  <Button
                    data-testid="grooming-check-out-btn"
                    disabled={statusTransition.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => transitionActionAppt("completed", "Checked out.")}
                  >
                    Check Out
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditAppt(actionAppt);
                      setActionAppt(null);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  <Button variant="destructive" onClick={() => setCancelTarget(actionAppt)}>
                    Cancel
                  </Button>
                </>
              )}

              {normalizeGroomingWorkflowStatus(actionAppt.status) === "in_progress" && (
                <>
                  <Button
                    data-testid="grooming-check-out-btn"
                    disabled={statusTransition.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => transitionActionAppt("completed", "Checked out.")}
                  >
                    Check Out
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditAppt(actionAppt);
                      setActionAppt(null);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                </>
              )}

              {(normalizeGroomingWorkflowStatus(actionAppt.status) === "completed" ||
                normalizeGroomingWorkflowStatus(actionAppt.status) === "paid") && (
                <>
                  {panelInvoiceLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading invoice…
                    </div>
                  ) : !panelInvoice ? (
                    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
                      No invoice linked yet. Try checking out again or create one from Billing.
                    </p>
                  ) : (
                    <div className="rounded-lg border p-4 space-y-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">
                        Invoice
                      </p>
                      <p className="font-mono text-sm">
                        {panelInvoice.invoice_number ?? panelInvoice.id.slice(0, 8)}
                      </p>
                      {panelInvoiceTotals ? (
                        <div className="text-sm space-y-1">
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Subtotal</span>
                            <span className="tabular-nums">
                              {formatAed(panelInvoiceTotals.subtotal)}
                            </span>
                          </div>
                          {panelInvoiceTotals.discount > 0 ? (
                            <div className="flex justify-between gap-2">
                              <span className="text-muted-foreground">Discount</span>
                              <span className="tabular-nums">
                                −{formatAed(panelInvoiceTotals.discount)}
                              </span>
                            </div>
                          ) : null}
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Subtotal (ex VAT)</span>
                            <span className="tabular-nums">
                              {formatAed(panelInvoiceTotals.netExVat)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{vatLineLabel()}</span>
                            <span className="tabular-nums">{formatAed(panelInvoiceTotals.vat)}</span>
                          </div>
                          <div className="flex justify-between gap-2 text-base font-semibold border-t pt-1">
                            <span>Grand total</span>
                            <span className="tabular-nums">
                              {formatAed(panelInvoiceTotals.grandTotal)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Amount paid</span>
                            <span className="tabular-nums">
                              {formatAed(panelInvoiceTotals.amountPaid)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2 font-medium">
                            <span>Balance outstanding</span>
                            <span className="tabular-nums">
                              {formatAed(panelInvoiceTotals.outstanding)}
                            </span>
                          </div>
                        </div>
                      ) : null}
                      <p className="text-xs text-muted-foreground capitalize">
                        Status: {panelInvoice.status.replace(/_/g, " ")}
                      </p>
                      {actionApptPriceMismatch ? (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
                          <p>
                            Appointment price is {formatAed(groomingPriceAed(actionAppt.price))} but
                            invoice total is {formatAed(panelInvoiceTotals?.grandTotal ?? 0)}.
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="bg-white"
                            disabled={syncInvoicePrice.isPending}
                            data-testid="grooming-sync-invoice-price-btn"
                            onClick={() => {
                              syncInvoicePrice.mutate(
                                {
                                  appointmentId: actionAppt.id,
                                  price: actionAppt.price,
                                  invoiceId: panelInvoice.id,
                                  appointmentDate: actionAppt.appointment_date,
                                  petId: actionAppt.pet_id,
                                  ownerId: actionAppt.owner_id,
                                },
                                {
                                  onSuccess: (result) => {
                                    if (result.kind === "synced") {
                                      toast.success(
                                        `Invoice synced to ${formatAed(result.total)}.`,
                                      );
                                    } else if (result.kind === "skipped") {
                                      toast.warning(result.reason);
                                    } else if (result.kind === "no_invoice") {
                                      toast.warning("No linked invoice found to sync.");
                                    } else {
                                      toast.success("Invoice already matches appointment price.");
                                    }
                                  },
                                  onError: (e) =>
                                    toast.error(
                                      e instanceof Error
                                        ? e.message
                                        : "Could not sync invoice price.",
                                    ),
                                },
                              );
                            }}
                          >
                            {syncInvoicePrice.isPending && (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Sync invoice to appointment price
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )}
                  <Button
                    disabled={!panelInvoice?.id}
                    onClick={() => panelInvoice?.id && openGroomingInvoice(panelInvoice.id)}
                    data-testid="grooming-open-invoice-btn"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Open invoice
                  </Button>
                  <Button variant="outline" onClick={() => setActionAppt(null)}>
                    Dismiss
                  </Button>
                  {normalizeGroomingWorkflowStatus(actionAppt.status) === "completed" ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditAppt(actionAppt);
                        setActionAppt(null);
                      }}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                  ) : null}
                </>
              )}

              {normalizeGroomingWorkflowStatus(actionAppt.status) === "cancelled" && (
                <p className="text-sm text-muted-foreground">This appointment was cancelled.</p>
              )}

              {normalizeGroomingWorkflowStatus(actionAppt.status) === "other" && (
                <p className="text-sm text-muted-foreground">
                  This record uses a legacy or unknown status. Use Edit to align services and notes,
                  or Undo if available.
                </p>
              )}

              {workflowUndoTarget(actionAppt.status) && (
                <Button
                  variant="ghost"
                  className="mt-2 text-muted-foreground"
                  disabled={statusTransition.isPending}
                  onClick={() => {
                    const prev = workflowUndoTarget(actionAppt.status);
                    if (!prev) return;
                    transitionActionAppt(prev, `Reverted to ${workflowStatusLabel(prev)}.`, {
                      isUndo: true,
                    });
                  }}
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  Undo last step
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!editAppt} onOpenChange={(o) => !o && setEditAppt(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit appointment</SheetTitle>
            <SheetDescription>
              Update services, schedule, groomer, notes, and price. Saves to the database immediately.
            </SheetDescription>
          </SheetHeader>
          {editAppt && (
            <div className="mt-6 space-y-6">
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Client · Pet · </span>
                <span className="font-medium">
                  {editAppt.owners
                    ? ownerDisplayName(editAppt.owners.first_name, editAppt.owners.last_name)
                    : "—"}
                  {" · "}
                  {editAppt.pets?.name ?? "—"}
                </span>
              </div>
              <section className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Appointment details
                </h3>
                <div className="space-y-2">
                  <Label>Service</Label>
                  <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                    {GROOMING_SERVICE_CHECKBOX_OPTIONS.map((o) => {
                      const checked = editSelectedServices.includes(o.value);
                      return (
                        <label
                          key={o.value}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const shouldCheck = e.target.checked;
                              setEditSelectedServices((prev) => {
                                if (shouldCheck) {
                                  if (prev.includes(o.value)) return prev;
                                  return [...prev, o.value];
                                }
                                return prev.filter((v) => v !== o.value);
                              });
                            }}
                          />
                          <span>{o.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Grooming date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !editApptDate && "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(editApptDate, "d MMM yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={editApptDate}
                          onSelect={(d) => d && setEditApptDate(d)}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label>Time</Label>
                    <Input
                      type="time"
                      value={editApptTime}
                      onChange={(e) => setEditApptTime(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Station</Label>
                    <Select
                      value={editStationId ?? "__none__"}
                      onValueChange={(v) => setEditStationId(v === "__none__" ? null : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select station" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Unassigned</SelectItem>
                        {groomingStations.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Duration (minutes)</Label>
                    <Input
                      type="number"
                      min={15}
                      step={5}
                      value={editDurationMin}
                      onChange={(e) =>
                        setEditDurationMin(parseInt(e.target.value, 10) || 60)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Price (AED)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
                <GroomingGroomerSelect
                  groomers={groomers}
                  value={editGroomerName}
                  onChange={setEditGroomerName}
                  id="grooming-edit-groomer"
                />
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={editVisitNotes}
                    onChange={(e) => setEditVisitNotes(e.target.value)}
                    placeholder="Visit instructions…"
                    rows={3}
                  />
                </div>
              </section>
              <SheetFooter className="gap-2 sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setEditAppt(null)}>
                  Close
                </Button>
                <Button type="button" disabled={updateAppt.isPending} onClick={handleSaveEdit}>
                  {updateAppt.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save changes
                </Button>
              </SheetFooter>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <GroomingNewAppointmentSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        defaultDay={safeDay}
        slotPrefill={slotPrefill}
        groomingStations={groomingStations}
      />

      <GroomingConflictOverrideDialog
        open={conflictDialogOpen}
        onOpenChange={setConflictDialogOpen}
        conflicts={pendingConflicts}
        isPending={updateAppt.isPending}
        onConfirm={(reason) => {
          void performSaveEdit(reason);
        }}
      />
    </>
  );
};

export default GroomingPage;
