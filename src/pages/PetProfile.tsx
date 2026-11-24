import { useState, useRef, useMemo, useEffect } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parse, differenceInYears, differenceInMonths, parseISO } from "date-fns";
import { formatIsoDate, isValidIsoDate } from "@/lib/petProfileFields";
import { COMPLIMENTARY_DAYCARE_SOURCE, complimentaryDaycareSummary } from "@/lib/complimentaryDaycare";
import TopBar from "@/components/dashboard/TopBar";
import { usePet, useUpdatePet } from "@/hooks/usePets";
import { useUpdateAssessment } from "@/hooks/useAssessment";
import {
  useGroomingHistory,
  type GroomingAppointmentWithJoins,
} from "@/hooks/useGrooming";
import { usePetBookings, type BookingWithDetails } from "@/hooks/useBookings";
import { calculateNights, ownerDisplayName } from "@/lib/bookingUtils";
import { labelForGroomingService, type GroomingService } from "@/lib/groomingCatalog";
import { usePetGroomingNotesLog } from "@/hooks/usePetGroomingNotes";
import { boardingCalendarTo, boardingServiceLabel } from "@/lib/boardingLabels";
import { PetBreedCombobox } from "@/components/PetBreedCombobox";
import { VetClinicCombobox } from "@/components/VetClinicCombobox";
import { VaccinationInformationTable } from "@/components/VaccinationInformationTable";
import { PetDocuments } from "@/components/PetDocuments";
import { VaccicheckPanel } from "@/components/VaccicheckPanel";
import { BookingProfileNotes } from "@/components/BookingProfileNotes";
import {
  petBehaviourNotes,
  petFeedingNotes,
  petMedicalConditions,
  petMedicationNotes,
} from "@/lib/petCareNotes";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ArrowLeft,
  Pencil,
  Dog,
  Cat,
  Loader2,
  Syringe,
  BookImage,
  BedDouble,
  ExternalLink,
  CalendarCheck2,
} from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import {
  EMPTY_PET_ALERTS,
  PET_ALERT_LABELS,
  parsePetSpecialAlerts,
  petAlertBannerLines,
  petHasSpecialAlerts,
  serializePetSpecialAlerts,
  type PetSpecialAlertsShape,
} from "@/lib/petAlerts";

type PetUpdate = Database["public"]["Tables"]["pets"]["Update"];
type AssessmentStatus = Database["public"]["Enums"]["assessment_status"];
type BookingStatus = Database["public"]["Enums"]["booking_status"];
type PetSize = Database["public"]["Enums"]["pet_size"];
type PetCoatType = Database["public"]["Enums"]["coat_type"];
type AssessmentBookingRpcRow =
  Database["public"]["Functions"]["create_assessment_booking"]["Returns"][number];
type ActiveCreditRow = Database["public"]["Tables"]["service_credits"]["Row"] & {
  package_name: string | null;
  units_remaining: number;
};

function creditServiceLabel(serviceCode: Database["public"]["Enums"]["service_code"]): string {
  const labels: Record<Database["public"]["Enums"]["service_code"], string> = {
    boarding_night: "boarding night",
    daycare_full_day: "daycare day",
    daycare_half_day: "daycare half day",
    daycare_hourly: "daycare hourly",
    grooming_full_service: "full service grooming",
    cat_grooming_full_no_bath: "cat full service (no bath)",
    cat_grooming_full_with_bath: "cat full service (with bath)",
    grooming_bath_brush_tidy: "bath, brush and tidy",
    grooming_tidy: "tidy",
    grooming_gland_expression: "gland expression",
    grooming_nail_ear_teeth: "nail/ear/teeth care",
    cat_grooming_nail_ear: "cat nail/ear care",
    grooming_hair_no_more: "hair-no-more",
    cat_grooming_hair_no_more: "cat hair-no-more",
    grooming_splash: "splash",
    cat_grooming_splash: "cat splash",
    addon_nails: "nail add-on",
    addon_glands: "glands add-on",
    addon_dematting: "dematting add-on",
    addon_teeth_cleaning: "teeth cleaning add-on",
    addon_flea_tick_bath: "flea/tick bath add-on",
    addon_specialised_shampoo: "specialised shampoo add-on",
    treadmill_daycare_addon: "treadmill session",
    treadmill_hourly_addon: "treadmill hourly",
    assessment_with_first_hour: "assessment",
  };
  return labels[serviceCode] ?? serviceCode;
}

const ASSESSMENT_SLOT_OPTIONS = ["10:00", "11:00", "12:00", "13:00", "14:00"] as const;

const ASSESSMENT_BADGE: Record<AssessmentStatus, string> = {
  not_assessed: "bg-slate-100 text-slate-600 border-slate-200",
  scheduled: "bg-amber-100 text-amber-800 border-amber-200",
  passed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  failed: "bg-red-100 text-red-700 border-red-200",
};

const ASSESSMENT_LABEL: Record<AssessmentStatus, string> = {
  not_assessed: "Not Assessed",
  scheduled: "Scheduled",
  passed: "Passed",
  failed: "Failed",
};

const PET_SIZE_LABEL: Record<PetSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

const PET_SIZE_OPTIONS: { value: PetSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

/** Matches pets.coat_type / package pricing tiers (Summer Splash short vs long). */
const PET_COAT_TYPE_OPTIONS: { value: PetCoatType; label: string }[] = [
  { value: "short", label: "Short hair" },
  { value: "long", label: "Long hair" },
];

const BOOKING_STATUS_BADGE: Record<BookingStatus, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  confirmed: "bg-blue-100 text-blue-800 border-blue-200",
  checked_in: "bg-emerald-100 text-emerald-800 border-emerald-200",
  checked_out: "bg-slate-100 text-slate-600 border-slate-200",
  enquiry: "bg-amber-100 text-amber-800 border-amber-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
  no_show: "bg-rose-100 text-rose-700 border-red-200",
};

const TIME_ANCHOR = new Date(2000, 0, 1);

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

function bookingPetNames(b: BookingWithDetails): string {
  const names = b.booking_pets
    .map((bp) => bp.pets?.name)
    .filter(Boolean) as string[];
  return names.length ? names.join(", ") : "—";
}

function formatBookingStatus(status: BookingStatus): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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

type BookingDetailSelection =
  | { kind: "stay"; stay: BookingWithDetails }
  | { kind: "grooming"; groom: GroomingAppointmentWithJoins };

function petAge(dob: string | null): string {
  if (!isValidIsoDate(dob)) return "—";
  const birth = parseISO(String(dob).slice(0, 10));
  const years = differenceInYears(new Date(), birth);
  if (years >= 1) return `${years} yr${years !== 1 ? "s" : ""}`;
  const months = differenceInMonths(new Date(), birth);
  return `${months} mo${months !== 1 ? "s" : ""}`;
}

const PetProfilePage = () => {
  const { ownerId, petId } = useParams<{ ownerId: string; petId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const { data: pet, isLoading } = usePet(petId!);
  const { data: activeCredits = [], isLoading: creditsLoading } = useQuery({
    queryKey: ["pet_active_credits", petId],
    enabled: !!petId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_credits")
        .select("*, purchase_groups(package_definitions(display_name))")
        .eq("pet_id", petId!)
        .eq("status", "active")
        .gte("expires_at", new Date().toISOString().slice(0, 10))
        .order("expires_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const packageName =
          (
            row as unknown as {
              purchase_groups?: { package_definitions?: { display_name?: string | null } | null } | null;
            }
          ).purchase_groups?.package_definitions?.display_name ?? null;
        return {
          ...row,
          package_name: packageName,
          units_remaining: row.units_total - row.units_consumed,
        };
      }) as ActiveCreditRow[];
    },
  });
  const { data: petStays = [], isLoading: staysLoading } = usePetBookings(petId ?? "");
  const { data: groomingHistory = [], isLoading: groomingLoading } = useGroomingHistory(
    petId ?? "",
    80,
  );
  const { data: petGroomingNotesLog = [], isLoading: petGroomingNotesLoading } =
    usePetGroomingNotesLog(petId ?? "", !!petId);
  const updatePet = useUpdatePet();
  const updateAssessment = useUpdateAssessment();
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<PetUpdate & { id: string }>({ id: petId! });
  const [alertDraft, setAlertDraft] = useState<PetSpecialAlertsShape>({ ...EMPTY_PET_ALERTS });
  const [historyServiceFilter, setHistoryServiceFilter] =
    useState<HistoryServiceFilter>("all");
  const [bookingDetail, setBookingDetail] = useState<BookingDetailSelection | null>(null);
  const [assessmentNotesDraft, setAssessmentNotesDraft] = useState("");
  const [assessmentEditorOpen, setAssessmentEditorOpen] = useState(false);
  const [failNotes, setFailNotes] = useState("");
  const [assessmentDialogOpen, setAssessmentDialogOpen] = useState(false);
  const [assessmentDateDraft, setAssessmentDateDraft] = useState("");
  const [assessmentSlotDraft, setAssessmentSlotDraft] = useState<(typeof ASSESSMENT_SLOT_OPTIONS)[number]>("10:00");
  const [assessmentBookingPending, setAssessmentBookingPending] = useState(false);

  const { data: scheduledAssessment } = useQuery({
    queryKey: ["pets", "assessment-booking", pet?.id],
    enabled: !!pet?.id && pet.assessment_status === "scheduled",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("check_in_date, agent_notes, booking_pets!inner(pet_id)")
        .eq("booking_type", "assessment")
        .eq("booking_pets.pet_id", pet!.id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const scheduledAssessmentSlot = useMemo(() => {
    const notes = scheduledAssessment?.agent_notes;
    if (!notes) return null;
    const match = notes.match(/Assessment session\s+(\d{2}:\d{2})/i);
    return match?.[1] ?? null;
  }, [scheduledAssessment?.agent_notes]);

  const bookingTimeline = useMemo(() => {
    type Row =
      | { kind: "stay"; sortKey: string; id: string; stay: BookingWithDetails }
      | { kind: "grooming"; sortKey: string; id: string; groom: GroomingAppointmentWithJoins };

    const rows: Row[] = [];

    petStays.forEach((b) => {
      rows.push({
        kind: "stay",
        sortKey: `${b.check_in_date}T12:00:00`,
        id: b.id,
        stay: b,
      });
    });

    groomingHistory.forEach((g) => {
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
  }, [petStays, groomingHistory]);

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

  const historyLoading = staysLoading || groomingLoading;

  useEffect(() => {
    if (!pet) return;
    setAssessmentNotesDraft(pet.assessment_notes ?? "");
  }, [pet]);

  useEffect(() => {
    if (!petId) return;
    if (searchParams.get("schedule_assessment") === "1") {
      setAssessmentDialogOpen(true);
    }
  }, [petId, searchParams]);

  // photo upload
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const openEditDrawer = () => {
    if (!pet) return;
    setAlertDraft(parsePetSpecialAlerts(pet.special_alerts));
    setEditForm({
      id: pet.id,
      name: pet.name,
      species: pet.species,
      breed: pet.breed,
      colour: pet.colour,
      date_of_birth: pet.date_of_birth,
      weight_kg: pet.weight_kg,
      gender: pet.gender,
      size: pet.size,
      coat_type: pet.coat_type,
      spayed_neutered: pet.spayed_neutered,
      microchip_number: pet.microchip_number,
      feeding_notes: petFeedingNotes(pet) || null,
      medical_conditions: petMedicalConditions(pet) || null,
      medication_notes: petMedicationNotes(pet) || null,
      behaviour_notes: petBehaviourNotes(pet) || null,
      grooming_notes: pet.grooming_notes,
      other_notes: pet.other_notes,
      driver_note: pet.driver_note,
      vet_name: pet.vet_name,
      vet_phone: pet.vet_phone,
      photo_url: pet.photo_url,
      assessment_status: pet.assessment_status,
    });
    setPhotoFile(null);
    setPhotoPreview(null);
    setEditOpen(true);
  };

  const handleField = (field: keyof PetUpdate, value: unknown) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhotoSelect = (file: File) => {
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const uploadPhoto = async (): Promise<string | null> => {
    if (!photoFile) return editForm.photo_url ?? null;
    setPhotoUploading(true);
    const ext = photoFile.name.split(".").pop();
    const path = `${ownerId!}/${petId!}/${Date.now()}.${ext}`;
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const photoUrl = await uploadPhoto();
    const driverNote = (editForm.driver_note ?? "").trim() || null;
    const driverNoteEdited = driverNote !== ((pet?.driver_note ?? "").trim() || null);
    updatePet.mutate(
      {
        ...editForm,
        photo_url: photoUrl,
        special_alerts: serializePetSpecialAlerts(alertDraft),
        driver_note: driverNote,
        ...(driverNoteEdited
          ? { driver_note_source: "staff", driver_note_updated_at: new Date().toISOString() }
          : {}),
      },
      {
      onSuccess: () => {
        toast.success("Pet updated");
        setEditOpen(false);
        setPhotoFile(null);
        setPhotoPreview(null);
      },
      onError: (err) => toast.error(err.message || "Failed to update pet"),
    },
    );
  };

  const markPassed = async () => {
    if (!pet) return;
    try {
      await updateAssessment.mutateAsync({
        pet_id: pet.id,
        status: "passed",
        date: format(new Date(), "yyyy-MM-dd"),
        notes: assessmentNotesDraft || undefined,
      });
      toast.success("Assessment marked as passed.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not update status.");
    }
  };

  const markFailed = async () => {
    if (!pet) return;
    try {
      await updateAssessment.mutateAsync({
        pet_id: pet.id,
        status: "failed",
        date: format(new Date(), "yyyy-MM-dd"),
        notes: failNotes || assessmentNotesDraft || undefined,
      });
      toast.success("Assessment marked as failed.");
      setFailNotes("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not update status.");
    }
  };

  const saveAssessmentNotes = async () => {
    if (!pet) return;
    try {
      await updatePet.mutateAsync({
        id: pet.id,
        assessment_notes: assessmentNotesDraft || null,
      });
      toast.success("Assessment notes updated.");
      setAssessmentEditorOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not save notes.");
    }
  };

  const bookAssessment = async () => {
    if (!pet) return;
    if (!assessmentDateDraft) {
      toast.error("Select an assessment date.");
      return;
    }

    const todayIso = format(new Date(), "yyyy-MM-dd");
    if (assessmentDateDraft <= todayIso) {
      toast.error("Assessment date must be in the future.");
      return;
    }

    const weekday = new Date(`${assessmentDateDraft}T00:00:00`).getDay();
    if (weekday === 0 || weekday === 6) {
      toast.error("Assessment sessions are Monday to Friday only.");
      return;
    }

    setAssessmentBookingPending(true);
    const { data, error } = await supabase.rpc("create_assessment_booking", {
      p_pet_id: pet.id,
      p_session_date: assessmentDateDraft,
      p_session_start_time: assessmentSlotDraft,
      p_staff_id: null,
      p_notes: null,
    });
    setAssessmentBookingPending(false);

    if (error) {
      toast.error(error.message || "Could not book assessment.");
      return;
    }

    const row = Array.isArray(data) ? (data[0] as AssessmentBookingRpcRow | undefined) : undefined;
    const amount = Number(row?.amount_aed ?? 52.5);
    toast.success(`Assessment booked. Charge AED ${amount.toFixed(2)} applied.`);

    setAssessmentDialogOpen(false);
    setAssessmentDateDraft("");
    setAssessmentSlotDraft("10:00");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pets", "detail", pet.id] }),
      queryClient.invalidateQueries({ queryKey: ["pets"] }),
      queryClient.invalidateQueries({ queryKey: ["bookings"] }),
      queryClient.invalidateQueries({ queryKey: ["invoices"] }),
    ]);
  };

  // ── loading / not found ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <>
        <TopBar title="Pet Profile" />
        <main className="flex-1 overflow-auto p-8 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-60 w-full" />
        </main>
      </>
    );
  }

  if (!pet) {
    return (
      <>
        <TopBar title="Pet Profile" />
        <main className="flex-1 overflow-auto p-8">
          <p className="text-muted-foreground">Pet not found.</p>
        </main>
      </>
    );
  }

  const assessmentStatus = pet.assessment_status as AssessmentStatus;

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <>
      <TopBar title="Pet Profile" />
      <main className="flex-1 overflow-auto p-8 space-y-8">

        {/* Back */}
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => navigate(`/customers/${ownerId}`)}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to Owner
        </Button>

        {/* ── Pet header card ── */}
        <Card>
          <CardContent className="flex flex-col gap-6 p-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-5">
                {pet.photo_url ? (
                  <img
                    src={pet.photo_url}
                    alt={pet.name}
                    className="h-24 w-24 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-muted">
                    {pet.species === "cat"
                      ? <Cat className="h-10 w-10 text-muted-foreground" />
                      : <Dog className="h-10 w-10 text-muted-foreground" />}
                  </div>
                )}

                <div className="space-y-1.5">
                  <h2 className="text-2xl font-semibold">{pet.name}</h2>
                  <p className="text-sm text-muted-foreground capitalize">
                    {pet.species}{pet.breed ? ` · ${pet.breed}` : ""}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className={ASSESSMENT_BADGE[assessmentStatus]}
                    >
                      {ASSESSMENT_LABEL[assessmentStatus]}
                    </Badge>
                    {pet.spayed_neutered && (
                      <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                        Spayed / Neutered
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={openEditDrawer}>
                <Pencil className="mr-1.5 h-4 w-4" />
                Edit
              </Button>
            </div>
            <BookingProfileNotes
              compact
              className="max-w-xl"
              pets={[{ name: pet.name, otherNotes: pet.other_notes }]}
            />
          </CardContent>
        </Card>

        {/* ── Details ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
              {[
                { label: "Colour", value: pet.colour },
                { label: "Gender", value: pet.gender ? pet.gender.charAt(0).toUpperCase() + pet.gender.slice(1) : null },
                {
                  label: "Date of birth",
                  value: isValidIsoDate(pet.date_of_birth)
                    ? `${formatIsoDate(pet.date_of_birth, "d MMM yyyy")} (${petAge(pet.date_of_birth)})`
                    : null,
                },
                { label: "Weight", value: pet.weight_kg != null ? `${pet.weight_kg} kg` : null },
                { label: "Microchip", value: pet.microchip_number },
                { label: "Vet", value: pet.vet_name },
                { label: "Vet phone", value: pet.vet_phone },
              ].map(({ label, value }) => (
                <div key={label} className="space-y-0.5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
                  <p className="text-sm">{value ?? <span className="text-muted-foreground">—</span>}</p>
                </div>
              ))}
            </div>

          </CardContent>
        </Card>

        {/* ── Special Alerts ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Special Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {petHasSpecialAlerts(parsePetSpecialAlerts(pet.special_alerts)) ? (
              <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                {petAlertBannerLines(parsePetSpecialAlerts(pet.special_alerts)).map((line) => (
                  <li key={line}>
                    <Badge
                      variant="outline"
                      className="border-orange-300 bg-orange-50 text-orange-950 font-normal"
                    >
                      {line}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None recorded. Use Edit to add alerts.</p>
            )}
          </CardContent>
        </Card>

        {/* ── Care Notes ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Care Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Feeding instructions", value: petFeedingNotes(pet) || null },
              { label: "Medical conditions",   value: petMedicalConditions(pet) || null },
              { label: "Medications",          value: petMedicationNotes(pet) || null },
              { label: "Behavioural notes",    value: petBehaviourNotes(pet) || null },
              { label: "Grooming notes",       value: pet.grooming_notes },
              { label: "Driver note (transport)", value: pet.driver_note },
            ].map(({ label, value }) => (
              <div key={label} className="space-y-0.5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                  {label}
                </p>
                {value ? (
                  <p className="text-sm whitespace-pre-line">{value}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarCheck2 className="h-4 w-4" />
              Assessment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                  Status
                </p>
                <Badge variant="outline" className={ASSESSMENT_BADGE[assessmentStatus]}>
                  {ASSESSMENT_LABEL[assessmentStatus]}
                </Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                  Assessment date
                </p>
                <p className="text-sm">
                  {formatIsoDate(pet.assessment_date, "d MMM yyyy")}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                  Assessed by
                </p>
                <p className="text-sm">{pet.assessed_by ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                  Size
                </p>
                <p className="text-sm">
                  {pet.size
                    ? PET_SIZE_LABEL[pet.size as PetSize]
                    : "—"}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                  Notes
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAssessmentEditorOpen((v) => !v)}
                >
                  Edit Notes
                </Button>
              </div>
              {assessmentEditorOpen ? (
                <div className="space-y-2">
                  <Textarea
                    value={assessmentNotesDraft}
                    onChange={(e) => setAssessmentNotesDraft(e.target.value)}
                    rows={4}
                    placeholder="Assessment notes…"
                  />
                  <Button size="sm" onClick={saveAssessmentNotes} disabled={updatePet.isPending}>
                    Save Notes
                  </Button>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-line">
                  {pet.assessment_notes || "—"}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {assessmentStatus === "not_assessed" && (
                <Button onClick={() => setAssessmentDialogOpen(true)}>
                  Book Assessment
                </Button>
              )}
              {assessmentStatus === "scheduled" && (
                <>
                  <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
                    Assessment scheduled for{" "}
                    {scheduledAssessment?.check_in_date
                      ? formatIsoDate(scheduledAssessment.check_in_date, "d MMM yyyy")
                      : formatIsoDate(pet.assessment_date, "d MMM yyyy")}
                    {scheduledAssessmentSlot ? ` at ${scheduledAssessmentSlot}` : ""}
                  </Badge>
                  <Button onClick={markPassed} disabled={updateAssessment.isPending}>
                    Mark as Passed
                  </Button>
                  <div className="flex gap-2 items-center">
                    <Input
                      value={failNotes}
                      onChange={(e) => setFailNotes(e.target.value)}
                      placeholder="Failure notes"
                      className="w-[220px]"
                    />
                    <Button
                      variant="destructive"
                      onClick={markFailed}
                      disabled={updateAssessment.isPending}
                    >
                      Mark as Failed
                    </Button>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Active Packages</CardTitle>
          </CardHeader>
          <CardContent>
            {creditsLoading ? (
              <Skeleton className="h-20 w-full rounded-md" />
            ) : activeCredits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active packages.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(
                  activeCredits.reduce<Record<string, ActiveCreditRow[]>>((acc, row) => {
                    const key = row.package_name ?? "Package";
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(row);
                    return acc;
                  }, {}),
                ).map(([pkgName, rows]) => {
                  const bonusGroups = rows
                    .filter((r) => r.is_bonus && r.redemption_group_id)
                    .reduce<Record<string, ActiveCreditRow[]>>((acc, row) => {
                    const key = row.redemption_group_id as string;
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(row);
                    return acc;
                  }, {});
                  return (
                    <div key={pkgName} className="rounded-md border p-3 space-y-2">
                      <p className="font-medium">{pkgName}</p>
                      {rows.map((row) => (
                        <div key={row.id} className="flex items-center justify-between gap-2 text-sm">
                          <div>
                            <span className="font-medium">
                              {row.source_type === COMPLIMENTARY_DAYCARE_SOURCE
                                ? complimentaryDaycareSummary(row.units_total, row.units_consumed)
                                : `${row.units_remaining} ${creditServiceLabel(row.service_code)} remaining`}
                            </span>
                            {" "}— expires {formatIsoDate(row.expires_at, "dd MMM yyyy")}
                          </div>
                          {row.is_bonus && row.source_type !== COMPLIMENTARY_DAYCARE_SOURCE ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
                              Bonus
                            </Badge>
                          ) : null}
                        </div>
                      ))}
                      {Object.values(bonusGroups).some((items) => items.length > 1) ? (
                        <div className="rounded border border-amber-200 bg-amber-50/50 p-2 text-xs text-amber-900">
                          Bonus (choose one): consuming one bonus credit revokes the sibling credit from the same package.
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Booking history (stays, grooming) ── */}
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
                      const service =
                        boardingServiceLabel(room?.wing);
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
                            {formatIsoDate(b.check_in_date, "d MMM yyyy")}
                            {" → "}
                            {formatIsoDate(b.check_out_date, "d MMM yyyy")}
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
                    if (row.kind === "grooming") {
                      const g = row.groom;
                      const dateLine = `${formatIsoDate(g.appointment_date, "d MMM yyyy")}${
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
                            title={`${labelForGroomingService(g.service)} · ${groomerLine(g)}`}
                          >
                            {labelForGroomingService(g.service)} · {groomerLine(g)}
                          </TableCell>
                        </TableRow>
                      );
                    }
                    return null;
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-4">Grooming notes</h3>
          {petGroomingNotesLoading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : petGroomingNotesLog.length === 0 ? (
            <p className="text-sm text-muted-foreground">No grooming notes yet.</p>
          ) : (
            <ul className="space-y-3">
              {petGroomingNotesLog.map((row) => (
                <li key={row.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-1">
                    <span>{format(parseISO(row.created_at), "d MMM yyyy · HH:mm")}</span>
                    {row.grooming_appointments?.service ? (
                      <span>· {labelForGroomingService(row.grooming_appointments.service)}</span>
                    ) : null}
                    <span>· {row.written_by}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{row.note}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <VaccicheckPanel pet={pet} />

        {/* ── Vaccination Information ── */}
        <section>
          <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Syringe className="h-5 w-5" />
            Vaccination Information
          </h3>

          <VaccinationInformationTable petId={petId!} vaccinations={pet.vaccinations} />
        </section>

        {/* ── Passport / Documents ── */}
        <section>
          <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <BookImage className="h-5 w-5" />
            Passport &amp; Documents
          </h3>
          <PetDocuments petId={petId!} />
        </section>

      </main>

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
                      {bookingDetail.stay.owners.first_name}{" "}
                      {bookingDetail.stay.owners.last_name}
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
                            navigate(`/customers/${ownerId}/pets/${bp.pet_id}`)
                          }
                        >
                          {bp.pets?.name ?? "Pet"}
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <BookingProfileNotes
                  pets={bookingDetail.stay.booking_pets.map((bp) => ({
                    name: bp.pets?.name ?? "Pet",
                    otherNotes: bp.pets?.other_notes,
                  }))}
                />
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
                      {formatIsoDate(bookingDetail.stay.check_in_date, "d MMM yyyy")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground font-medium">Check-out</p>
                    <p className="text-sm">
                      {formatIsoDate(bookingDetail.stay.check_out_date, "d MMM yyyy")}
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
                  {formatIsoDate(bookingDetail.groom.appointment_date, "EEEE, d MMMM yyyy")}
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
                  {bookingDetail.groom.pet_id === petId ? (
                    <p className="text-sm font-medium">{pet.name}</p>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      onClick={() =>
                        navigate(`/customers/${ownerId}/pets/${bookingDetail.groom.pet_id}`)
                      }
                    >
                      {bookingDetail.groom.pets?.name ?? "—"}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <BookingProfileNotes
                  compact
                  pets={[
                    {
                      name: bookingDetail.groom.pets?.name ?? pet.name,
                      otherNotes: bookingDetail.groom.pets?.other_notes,
                    },
                  ]}
                />
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

      <Dialog open={assessmentDialogOpen} onOpenChange={setAssessmentDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Book Assessment</DialogTitle>
            <DialogDescription>
              Assessment + first hour daycare is AED 52.50. Sessions run Mon-Fri between 10:00 and 15:00.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="assessment_date">Date</Label>
              <Input
                id="assessment_date"
                type="date"
                value={assessmentDateDraft}
                min={format(new Date(Date.now() + 24 * 60 * 60 * 1000), "yyyy-MM-dd")}
                onChange={(e) => setAssessmentDateDraft(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assessment_slot">Slot</Label>
              <Select value={assessmentSlotDraft} onValueChange={(v) => setAssessmentSlotDraft(v as (typeof ASSESSMENT_SLOT_OPTIONS)[number])}>
                <SelectTrigger id="assessment_slot">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSESSMENT_SLOT_OPTIONS.map((slot) => (
                    <SelectItem key={slot} value={slot}>
                      {slot}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssessmentDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void bookAssessment()} disabled={assessmentBookingPending}>
              {assessmentBookingPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm Booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════
          EDIT PET DRAWER
      ══════════════════════════════════════════ */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Pet</SheetTitle>
            <SheetDescription>Update {pet.name}'s details.</SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">

            {/* Photo */}
            <div className="space-y-2">
              <Label>Photo</Label>
              <div className="flex items-center gap-4">
                {(photoPreview ?? editForm.photo_url) ? (
                  <img
                    src={photoPreview ?? editForm.photo_url!}
                    alt="Preview"
                    className="h-16 w-16 rounded-lg object-cover shrink-0"
                  />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground text-xs">
                    No photo
                  </div>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.[0]) handlePhotoSelect(e.target.files[0]); }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => photoInputRef.current?.click()}>
                  {editForm.photo_url || photoPreview ? "Change photo" : "Upload photo"}
                </Button>
                {(photoPreview ?? editForm.photo_url) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setPhotoFile(null); setPhotoPreview(null); handleField("photo_url", ""); }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <Separator />

            {/* Basic info */}
            <div className="space-y-2">
              <Label htmlFor="edit_pet_name">Name <span className="text-destructive">*</span></Label>
              <Input id="edit_pet_name" required value={editForm.name ?? ""} onChange={(e) => handleField("name", e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_species">Species</Label>
                <Select value={editForm.species ?? "dog"} onValueChange={(v) => handleField("species", v)}>
                  <SelectTrigger id="edit_species"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dog">Dog</SelectItem>
                    <SelectItem value="cat">Cat</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_breed">Breed</Label>
                <PetBreedCombobox
                  id="edit_breed"
                  value={editForm.breed ?? ""}
                  onChange={(v) => handleField("breed", v)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_colour">Colour</Label>
                <Input id="edit_colour" value={editForm.colour ?? ""} onChange={(e) => handleField("colour", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_dob">Date of birth</Label>
                <Input id="edit_dob" type="date" value={editForm.date_of_birth ?? ""} onChange={(e) => handleField("date_of_birth", e.target.value || null)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_weight">Weight (kg)</Label>
                <Input
                  id="edit_weight"
                  type="number"
                  step="0.1"
                  min="0"
                  value={editForm.weight_kg ?? ""}
                  onChange={(e) => handleField("weight_kg", e.target.value ? Number(e.target.value) : null)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_gender">Gender</Label>
                <Select value={editForm.gender ?? ""} onValueChange={(v) => handleField("gender", v || null)}>
                  <SelectTrigger id="edit_gender"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_size">Size</Label>
                <Select
                  value={editForm.size ?? "__unset__"}
                  onValueChange={(v) =>
                    handleField("size", v === "__unset__" ? null : (v as PetSize))
                  }
                >
                  <SelectTrigger id="edit_size" data-testid="pet-edit-size">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unset__">Not set</SelectItem>
                    {PET_SIZE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Used for size-tiered boarding and grooming package pricing.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_coat_type">Coat type</Label>
                <Select
                  value={editForm.coat_type ?? "__unset__"}
                  onValueChange={(v) =>
                    handleField("coat_type", v === "__unset__" ? null : (v as PetCoatType))
                  }
                >
                  <SelectTrigger id="edit_coat_type" data-testid="pet-edit-coat-type">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unset__">Not set</SelectItem>
                    {PET_COAT_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                    {/* Preserve legacy mid_length if already stored; not offered for new picks. */}
                    {editForm.coat_type === "mid_length" ? (
                      <SelectItem value="mid_length">Mid-length</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Required for coat-dependent grooming package pricing (e.g. Summer Splash).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_microchip">Microchip number</Label>
                <Input id="edit_microchip" value={editForm.microchip_number ?? ""} onChange={(e) => handleField("microchip_number", e.target.value)} />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="edit_spayed" className="cursor-pointer">Spayed / Neutered</Label>
                <Switch id="edit_spayed" checked={editForm.spayed_neutered ?? false} onCheckedChange={(v) => handleField("spayed_neutered", v)} />
              </div>
            </div>

            <Separator />

            {/* Special alerts */}
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Special Alerts
            </p>
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              {(Object.entries(PET_ALERT_LABELS) as [keyof typeof PET_ALERT_LABELS, string][]).map(
                ([key, label]) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={`edit_alert_${key}`}
                      checked={alertDraft[key]}
                      onCheckedChange={(v) =>
                        setAlertDraft((d) => ({ ...d, [key]: !!v }))
                      }
                    />
                    <Label htmlFor={`edit_alert_${key}`} className="cursor-pointer font-normal leading-snug">
                      {label}
                    </Label>
                  </div>
                ),
              )}
              <div className="space-y-1 pt-1">
                <Label htmlFor="edit_alert_other" className="text-xs text-muted-foreground font-normal">
                  Other (free text)
                </Label>
                <Textarea
                  id="edit_alert_other"
                  rows={2}
                  placeholder="Additional alert details…"
                  value={alertDraft.other_text}
                  onChange={(e) =>
                    setAlertDraft((d) => ({ ...d, other_text: e.target.value }))
                  }
                />
              </div>
            </div>

            <Separator />

            {/* Vet */}
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vet Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_vet_name">Vet name</Label>
                <VetClinicCombobox
                  id="edit_vet_name"
                  value={editForm.vet_name ?? ""}
                  onChange={(v) => handleField("vet_name", v)}
                  onPhoneChange={(p) => handleField("vet_phone", p)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_vet_phone">Vet phone</Label>
                <Input id="edit_vet_phone" type="tel" value={editForm.vet_phone ?? ""} onChange={(e) => handleField("vet_phone", e.target.value)} />
              </div>
            </div>

            <Separator />

            {/* Care notes */}
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Care Notes</p>

            <div className="space-y-2">
              <Label htmlFor="edit_feeding">Feeding instructions</Label>
              <Textarea id="edit_feeding" rows={2} value={editForm.feeding_notes ?? ""} onChange={(e) => handleField("feeding_notes", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_medical">Medical conditions</Label>
              <Textarea id="edit_medical" rows={2} value={editForm.medical_conditions ?? ""} onChange={(e) => handleField("medical_conditions", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_meds">Medications</Label>
              <Textarea id="edit_meds" rows={2} value={editForm.medication_notes ?? ""} onChange={(e) => handleField("medication_notes", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_behaviour">Behavioural notes</Label>
              <Textarea id="edit_behaviour" rows={2} value={editForm.behaviour_notes ?? ""} onChange={(e) => handleField("behaviour_notes", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_grooming">Grooming notes</Label>
              <Textarea id="edit_grooming" rows={2} value={editForm.grooming_notes ?? ""} onChange={(e) => handleField("grooming_notes", e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_driver_note">Driver note (transport)</Label>
              <Textarea
                id="edit_driver_note"
                data-testid="pet-driver-note-input"
                rows={2}
                value={editForm.driver_note ?? ""}
                onChange={(e) => handleField("driver_note", e.target.value)}
                placeholder="What the driver needs to know about this dog"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_other_notes">Other notes (bookings &amp; appointments)</Label>
              <Textarea id="edit_other_notes" rows={2} value={editForm.other_notes ?? ""} onChange={(e) => handleField("other_notes", e.target.value)} placeholder="Shown on boarding, grooming…" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_assessment">Assessment status</Label>
              <Select value={editForm.assessment_status ?? "not_assessed"} onValueChange={(v) => handleField("assessment_status", v)}>
                <SelectTrigger id="edit_assessment"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_assessed">Not Assessed</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="passed">Passed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" className="w-full" disabled={updatePet.isPending || photoUploading}>
              {(updatePet.isPending || photoUploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {photoUploading ? "Uploading photo…" : "Save Changes"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default PetProfilePage;
