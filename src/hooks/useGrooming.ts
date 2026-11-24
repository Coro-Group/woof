import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";
import {
  groomingCapacityKeys,
} from "@/hooks/useGroomingCapacity";
import { mergeGroomingBookingLinkHits, type GroomingBookingLinkHit } from "@/lib/groomingBookingLinkSearch";
import {
  finalizeGroomingCheckoutInvoice,
  groomingPriceAed,
  syncGroomingInvoicePriceFromAppointment,
  type GroomingInvoicePriceSyncResult,
} from "@/lib/groomingCheckoutInvoice";
import { withoutSupersededInvoices } from "@/lib/invoiceStatus";
import { MULTIPLE_SERVICES_LABEL, serviceRevenueShare } from "@/lib/sameDayServiceInvoice";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { withoutDogSizeColumn } from "@/lib/dogSizeNotes";
import {
  GROOMING_WORKFLOW_STATUSES,
  timestampClearsForUndoTo,
  timestampSetsForForwardStep,
  type GroomingWorkflowStatus,
} from "@/lib/groomingWorkflow";
import type { GroomingLinkedBookingInfo } from "@/lib/groomingBoardUi";

type GroomingRow = Database["public"]["Tables"]["grooming_appointments"]["Row"];
type GroomingInsert = Database["public"]["Tables"]["grooming_appointments"]["Insert"];
type GroomingUpdate = Database["public"]["Tables"]["grooming_appointments"]["Update"];

const GROOMING_JOIN_SELECT =
  "*, owners(first_name, last_name, phone, other_notes), pets(name, breed, size, weight_kg, grooming_notes, colour, other_notes, special_alerts), grooming_stations(name), bookings(booking_type, status, booking_ref, check_in_date, check_out_date), invoices(status, total, invoice_line_items(description))";

export type GroomingAppointmentWithJoins = GroomingRow & {
  owners: { first_name: string; last_name: string; phone: string; other_notes: string | null } | null;
  pets: {
    name: string;
    breed: string | null;
    size: string | null;
    weight_kg: number | null;
    grooming_notes: string | null;
    colour: string | null;
    other_notes: string | null;
    special_alerts: Database["public"]["Tables"]["pets"]["Row"]["special_alerts"];
  } | null;
  bookings: GroomingLinkedBookingInfo | null;
  grooming_stations: { name: string } | null;
  invoices: {
    status: Database["public"]["Enums"]["invoice_status"];
    total: number | null;
    invoice_line_items: { description: string | null }[] | null;
  } | null;
};

export const queryKeys = {
  groomingDay: (date: string) => ["grooming", "day", date] as const,
  groomingHistory: (petId: string) => ["grooming", "history", petId] as const,
  groomingHistoryList: (beforeDate: string) => ["grooming", "history-list", beforeDate] as const,
  groomingSearch: (term: string) => ["grooming", "search", term] as const,
  ownerGrooming: (ownerId: string) => ["grooming", "owner", ownerId] as const,
};

export function invalidateGrooming(
  qc: QueryClient,
  opts: { appointmentDate?: string; petId?: string; ownerId?: string },
) {
  if (opts.appointmentDate) {
    qc.invalidateQueries({ queryKey: queryKeys.groomingDay(opts.appointmentDate) });
    qc.invalidateQueries({ queryKey: groomingCapacityKeys.day(opts.appointmentDate) });
  }
  if (opts.petId) {
    qc.invalidateQueries({ queryKey: queryKeys.groomingHistory(opts.petId) });
  }
  if (opts.ownerId) {
    qc.invalidateQueries({ queryKey: queryKeys.ownerGrooming(opts.ownerId) });
  }
  qc.invalidateQueries({ queryKey: ["grooming", "search"] });
  qc.invalidateQueries({ queryKey: ["grooming", "history-list"] });
  qc.invalidateQueries({ queryKey: ["grooming", "lastCompletedByPets"] });
  qc.invalidateQueries({ queryKey: ["grooming", "dayInvoices"] });
}

export function useGroomingAppointments(date: string) {
  return useQuery({
    queryKey: queryKeys.groomingDay(date),
    enabled: !!date,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grooming_appointments")
        .select(GROOMING_JOIN_SELECT)
        .eq("appointment_date", date)
        .order("appointment_time", { ascending: true, nullsFirst: false });

      if (error) throw error;
      return data as GroomingAppointmentWithJoins[];
    },
  });
}

export function useGroomingHistory(petId: string, limit = 20) {
  return useQuery({
    queryKey: [...queryKeys.groomingHistory(petId), limit] as const,
    enabled: !!petId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grooming_appointments")
        .select(GROOMING_JOIN_SELECT)
        .eq("pet_id", petId)
        .order("appointment_date", { ascending: false })
        .order("appointment_time", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as GroomingAppointmentWithJoins[];
    },
  });
}

/** Past appointments and any cancelled (including today), for the History tab. */
export function useGroomingHistoryList(beforeDate: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.groomingHistoryList(beforeDate),
    enabled: enabled && !!beforeDate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grooming_appointments")
        .select(GROOMING_JOIN_SELECT)
        .or(`appointment_date.lt.${beforeDate},status.eq.cancelled`)
        .order("appointment_date", { ascending: false })
        .order("appointment_time", { ascending: false, nullsFirst: false })
        .limit(500);

      if (error) throw error;
      return data as GroomingAppointmentWithJoins[];
    },
  });
}

/** Client-filtered search across loaded rows (pet / owner names). */
export function useGroomingGlobalSearch(searchTerm: string) {
  const term = searchTerm.trim();
  return useQuery({
    queryKey: queryKeys.groomingSearch(term),
    enabled: term.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grooming_appointments")
        .select(GROOMING_JOIN_SELECT)
        .order("appointment_date", { ascending: false })
        .order("appointment_time", { ascending: false })
        .limit(400);

      if (error) throw error;
      const rows = data as GroomingAppointmentWithJoins[];
      const q = term.toLowerCase();
      return rows.filter((r) => {
        const pet = r.pets?.name?.toLowerCase() ?? "";
        const o = r.owners;
        const ownerStr = o ? `${o.first_name} ${o.last_name}`.toLowerCase() : "";
        const phone = o?.phone?.toLowerCase() ?? "";
        return pet.includes(q) || ownerStr.includes(q) || phone.includes(q);
      });
    },
  });
}

export function useCreateGroomingAppointment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (row: GroomingInsert) => {
      const payload = withoutDogSizeColumn(row);
      const { data, error } = await supabase
        .from("grooming_appointments")
        .insert({
          ...payload,
          status: row.status ?? "new",
          no_show: row.no_show ?? false,
        })
        .select()
        .single();

      if (error) throw error;
      return data as GroomingRow;
    },
    onSuccess: (data) => {
      invalidateGrooming(qc, {
        appointmentDate: data.appointment_date,
        petId: data.pet_id,
        ownerId: data.owner_id,
      });
    },
  });
}

export type DeleteGroomingAppointmentWithLogInput = {
  appointmentId: string;
  appointmentDate: string;
  petName: string;
  ownerName: string;
  service: string;
  price: number | null;
  reason: string;
  deletedByEmail: string;
};

export function useDeleteGroomingAppointment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: DeleteGroomingAppointmentWithLogInput) => {
      const trimmedReason = input.reason.trim();
      if (!trimmedReason) {
        throw new Error("A deletion reason is required.");
      }

      const id = input.appointmentId;

      // Step 1: remove status history (must complete before appointment delete).
      const { error: statusEventsError } = await supabase
        .from("grooming_status_events")
        .delete()
        .eq("appointment_id", id);
      if (statusEventsError) throw statusEventsError;

      // Step 2: remove appointment row.
      const { error: appointmentError } = await supabase
        .from("grooming_appointments")
        .delete()
        .eq("id", id);
      if (appointmentError) throw appointmentError;

      // Audit log (do not fail the mutation if logging is unavailable).
      const { error: logError } = await supabase.from("grooming_appointment_deletion_log" as never).insert({
        appointment_id: input.appointmentId,
        appointment_date: input.appointmentDate,
        pet_name: input.petName,
        owner_name: input.ownerName,
        service: input.service,
        price: input.price,
        deleted_by: input.deletedByEmail,
        reason: trimmedReason,
      } as never);
      if (logError) {
        console.error("grooming_appointment_deletion_log insert failed:", logError);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grooming"] });
    },
  });
}

export function useOwnerGroomingAppointments(ownerId: string) {
  return useQuery({
    queryKey: queryKeys.ownerGrooming(ownerId),
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grooming_appointments")
        .select(GROOMING_JOIN_SELECT)
        .eq("owner_id", ownerId)
        .order("appointment_date", { ascending: false })
        .order("appointment_time", { ascending: false, nullsFirst: false })
        .limit(80);

      if (error) throw error;
      return data as GroomingAppointmentWithJoins[];
    },
  });
}

export type UpdateGroomingAppointmentResult = {
  row: GroomingRow;
  invoiceSync: GroomingInvoicePriceSyncResult | null;
};

export function useUpdateGroomingAppointment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: GroomingUpdate & { id: string }): Promise<UpdateGroomingAppointmentResult> => {
      const payload = withoutDogSizeColumn(updates);
      const { data, error } = await supabase
        .from("grooming_appointments")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      let invoiceSync: GroomingInvoicePriceSyncResult | null = null;
      try {
        invoiceSync = await syncGroomingInvoicePriceFromAppointment(
          supabase,
          id,
          groomingPriceAed(data.price),
        );
      } catch (syncErr) {
        invoiceSync = {
          kind: "skipped",
          reason:
            syncErr instanceof Error
              ? syncErr.message
              : "Linked invoice could not be updated.",
        };
      }

      return { row: data as GroomingRow, invoiceSync };
    },
    onSuccess: ({ row: data, invoiceSync }, variables) => {
      invalidateGrooming(qc, {
        appointmentDate: data.appointment_date,
        petId: data.pet_id,
        ownerId: data.owner_id,
      });
      qc.invalidateQueries({ queryKey: ["invoice", "grooming", data.id] });
      qc.invalidateQueries({ queryKey: ["grooming", "dayInvoices"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      if (data.invoice_id) {
        qc.invalidateQueries({ queryKey: ["invoice", data.invoice_id] });
      }
      void variables;
      void invoiceSync;
    },
  });
}

export function useSyncGroomingInvoicePrice() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      appointmentId: string;
      price: number | null;
      invoiceId?: string | null;
      appointmentDate?: string;
      petId?: string;
      ownerId?: string;
    }) =>
      syncGroomingInvoicePriceFromAppointment(
        supabase,
        params.appointmentId,
        groomingPriceAed(params.price),
      ),
    onSuccess: (result, params) => {
      invalidateGrooming(qc, {
        appointmentDate: params.appointmentDate,
        petId: params.petId,
        ownerId: params.ownerId,
      });
      qc.invalidateQueries({ queryKey: ["invoice", "grooming", params.appointmentId] });
      qc.invalidateQueries({ queryKey: ["grooming", "dayInvoices"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      if (params.invoiceId) {
        qc.invalidateQueries({ queryKey: ["invoice", params.invoiceId] });
      }
      if (result.kind === "synced" && result.invoiceId) {
        qc.invalidateQueries({ queryKey: ["invoice", result.invoiceId] });
      }
    },
  });
}

/** Insert audit row + update appointment status (and workflow timestamps). */
export async function runGroomingStatusTransition(params: {
  id: string;
  toStatus: string;
  isUndo?: boolean;
}): Promise<GroomingRow> {
  const { data: current, error: fetchErr } = await supabase
    .from("grooming_appointments")
    .select("id, status, appointment_date, pet_id, owner_id")
    .eq("id", params.id)
    .single();
  if (fetchErr) throw fetchErr;

  const fromStatus = current.status;
  const now = new Date().toISOString();

  const patch: GroomingUpdate = { status: params.toStatus };
  if (params.toStatus === "cancelled") {
    patch.no_show = false;
  }

  if (params.isUndo) {
    const target = params.toStatus as GroomingWorkflowStatus;
    if ((GROOMING_WORKFLOW_STATUSES as readonly string[]).includes(target)) {
      Object.assign(patch, timestampClearsForUndoTo(target) as GroomingUpdate);
    }
  } else if (
    (GROOMING_WORKFLOW_STATUSES as readonly string[]).includes(params.toStatus)
  ) {
    Object.assign(
      patch,
      timestampSetsForForwardStep(params.toStatus as GroomingWorkflowStatus, now) as GroomingUpdate,
    );
  }

  const { error: logErr } = await supabase.from("grooming_status_events").insert({
    appointment_id: params.id,
    from_status: fromStatus,
    to_status: params.toStatus,
  });
  if (logErr) throw logErr;

  const { data: updated, error: upErr } = await supabase
    .from("grooming_appointments")
    .update(patch)
    .eq("id", params.id)
    .select()
    .single();
  if (upErr) throw upErr;
  return updated as GroomingRow;
}

export function useGroomingStatusTransition() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: runGroomingStatusTransition,
    onSuccess: (data) => {
      invalidateGrooming(qc, {
        appointmentDate: data.appointment_date,
        petId: data.pet_id,
        ownerId: data.owner_id,
      });
    },
  });
}

/** Draft invoice created at booking time (service_id = grooming appointment id). */
export function useInvoiceForGroomingAppointment(appointmentId: string | null) {
  return useQuery({
    queryKey: ["invoice", "grooming", appointmentId],
    enabled: !!appointmentId,
    queryFn: async () => {
      const { data: appt, error: apptErr } = await supabase
        .from("grooming_appointments")
        .select("invoice_id")
        .eq("id", appointmentId!)
        .maybeSingle();
      if (apptErr) throw apptErr;

      const invoiceSelect =
        "id, invoice_number, status, subtotal, discount_amount, total, vat_aed, amount_paid, payment_method, invoice_payments(payment_method, created_at)";

      let data: Record<string, unknown> | null = null;
      let error: { message: string } | null = null;

      if (appt?.invoice_id) {
        const res = await withoutSupersededInvoices(
          supabase
            .from("invoices")
            .select(invoiceSelect)
            .eq("id", appt.invoice_id)
            .maybeSingle(),
        );
        data = res.data as Record<string, unknown> | null;
        error = res.error;
      }

      if (!data && !error) {
        const res = await withoutSupersededInvoices(
          supabase
            .from("invoices")
            .select(invoiceSelect)
            .eq("service_id", appointmentId!)
            .in("service_type", ["grooming", "Multiple services"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        );
        data = res.data as Record<string, unknown> | null;
        error = res.error;
      }

      if (error) throw error;
      if (!data) return null;

      const payments =
        ((data as { invoice_payments?: Array<{ payment_method: string | null; created_at: string }> })
          .invoice_payments ?? [])
          .slice()
          .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      // TODO: deprecate invoices.payment_method
      const paymentMethod =
        payments[0]?.payment_method ?? (data.payment_method as string | null) ?? null;

      return {
        id: data.id as string,
        invoice_number: data.invoice_number as string | null,
        status: data.status as string,
        subtotal: data.subtotal as number | null,
        discount_amount: data.discount_amount as number | null,
        total: data.total as number | null,
        vat_aed: data.vat_aed as number | null,
        amount_paid: data.amount_paid as number | null,
        payment_method: paymentMethod,
      };
    },
  });
}

export function useFinalizeGroomingCheckout() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (params: { appointmentId: string; performedBy?: string }) =>
      finalizeGroomingCheckoutInvoice(supabase, params),
    onSuccess: (_result, params) => {
      qc.invalidateQueries({ queryKey: ["invoice", "grooming", params.appointmentId] });
      qc.invalidateQueries({ queryKey: ["grooming", "dayInvoices"] });
    },
  });
}

export function useMarkInProgress() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => runGroomingStatusTransition({ id, toStatus: "in_progress" }),
    onSuccess: (data) => {
      invalidateGrooming(qc, {
        appointmentDate: data.appointment_date,
        petId: data.pet_id,
        ownerId: data.owner_id,
      });
    },
  });
}

export function useMarkComplete() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => runGroomingStatusTransition({ id, toStatus: "completed" }),
    onSuccess: (data) => {
      invalidateGrooming(qc, {
        appointmentDate: data.appointment_date,
        petId: data.pet_id,
        ownerId: data.owner_id,
      });
    },
  });
}

export function useMarkNoShow() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("grooming_appointments")
        .update({
          status: "cancelled",
          no_show: true,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as GroomingRow;
    },
    onSuccess: (data) => {
      invalidateGrooming(qc, {
        appointmentDate: data.appointment_date,
        petId: data.pet_id,
        ownerId: data.owner_id,
      });
    },
  });
}

export type BookingLinkRow = GroomingBookingLinkHit;

const GROOMING_BOOKING_LINK_SELECT =
  "id, booking_ref, owner_id, booking_type, check_in_date, check_out_date, status, owners(first_name, last_name, phone), booking_pets(pet_id, pets(name))";

const GROOMING_LINKABLE_STATUS_FILTER = ["confirmed", "checked_in"] as const;

/** Search stays by booking ref, owner name/phone, or pet name for grooming link. */
export function useBookingsForGroomingLink(searchTerm: string) {
  const q = useDebounce(searchTerm.trim(), 300);
  return useQuery({
    queryKey: ["grooming", "bookingLink", q] as const,
    enabled: q.length >= 2,
    queryFn: async () => {
      const pat = `%${q}%`;
      const orOwners = `first_name.ilike.${pat},last_name.ilike.${pat},phone.ilike.${pat}`;
      let merged: GroomingBookingLinkHit[] = [];

      const pushRows = (rows: GroomingBookingLinkHit[] | null | undefined) => {
        merged = mergeGroomingBookingLinkHits(merged, rows);
      };

      const { data: byRef, error: e1 } = await supabase
        .from("bookings")
        .select(GROOMING_BOOKING_LINK_SELECT)
        .ilike("booking_ref", pat)
        .in("booking_type", ["boarding", "daycare"])
        .in("status", [...GROOMING_LINKABLE_STATUS_FILTER])
        .order("check_in_date", { ascending: false })
        .limit(12);

      if (e1) throw e1;
      pushRows((byRef ?? []) as GroomingBookingLinkHit[]);

      const { data: ownerRows, error: e2 } = await supabase
        .from("owners")
        .select("id")
        .or(orOwners)
        .limit(12);

      if (e2) throw e2;

      const ownerIds = ownerRows?.map((o) => o.id) ?? [];
      if (ownerIds.length) {
        const { data: byOwner, error: e3 } = await supabase
          .from("bookings")
          .select(GROOMING_BOOKING_LINK_SELECT)
          .in("owner_id", ownerIds)
          .in("booking_type", ["boarding", "daycare"])
          .in("status", [...GROOMING_LINKABLE_STATUS_FILTER])
          .order("check_in_date", { ascending: false })
          .limit(12);

        if (e3) throw e3;
        pushRows((byOwner ?? []) as GroomingBookingLinkHit[]);
      }

      const { data: petRows, error: e4 } = await supabase
        .from("pets")
        .select("id")
        .ilike("name", pat)
        .limit(20);

      if (e4) throw e4;

      const petIds = petRows?.map((p) => p.id) ?? [];
      if (petIds.length) {
        const { data: bpRows, error: e5 } = await supabase
          .from("booking_pets")
          .select("booking_id")
          .in("pet_id", petIds);

        if (e5) throw e5;

        const bookingIds = [...new Set((bpRows ?? []).map((r) => r.booking_id))];
        if (bookingIds.length) {
          const { data: byPet, error: e6 } = await supabase
            .from("bookings")
            .select(GROOMING_BOOKING_LINK_SELECT)
            .in("id", bookingIds)
            .in("booking_type", ["boarding", "daycare"])
            .in("status", [...GROOMING_LINKABLE_STATUS_FILTER])
            .order("check_in_date", { ascending: false })
            .limit(12);

          if (e6) throw e6;
          pushRows((byPet ?? []) as GroomingBookingLinkHit[]);
        }
      }

      merged.sort((a, b) => b.check_in_date.localeCompare(a.check_in_date));
      return merged.slice(0, 20);
    },
  });
}

export type GroomingDayInvoiceRow = {
  id: string;
  service_id: string;
  status: string;
  total: number | null;
};

/** Grooming revenue for the day. Combined invoices contribute their grooming share only. */
export function useGroomingDayInvoices(
  appointmentIds: readonly string[],
  options?: { enabled?: boolean },
) {
  const sortedKey = [...appointmentIds].sort().join(",");
  const extraEnabled = options?.enabled !== false;
  return useQuery({
    queryKey: ["grooming", "dayInvoices", sortedKey] as const,
    enabled: extraEnabled && appointmentIds.length > 0,
    queryFn: async () => {
      const ids = [...appointmentIds];
      const [{ data: linkedAppointments, error: linkErr }, { data: byService, error: serviceErr }] =
        await Promise.all([
          supabase.from("grooming_appointments").select("invoice_id").in("id", ids),
          supabase
            .from("invoices")
            .select("id, service_id, service_type, status, total")
            .in("service_type", ["grooming", MULTIPLE_SERVICES_LABEL])
            .in("service_id", ids),
        ]);
      if (linkErr) throw linkErr;
      if (serviceErr) throw serviceErr;

      const linkedIds = Array.from(
        new Set(
          (linkedAppointments ?? [])
            .map((row) => row.invoice_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      let linkedInvoices: typeof byService = [];
      if (linkedIds.length > 0) {
        const { data, error } = await supabase
          .from("invoices")
          .select("id, service_id, service_type, status, total")
          .in("id", linkedIds);
        if (error) throw error;
        linkedInvoices = (data ?? []).filter(
          (row) => row.service_type === "grooming" || row.service_type === MULTIPLE_SERVICES_LABEL,
        );
      }

      const invoices = new Map<string, NonNullable<typeof byService>[number]>();
      for (const row of [...(byService ?? []), ...(linkedInvoices ?? [])]) {
        invoices.set(row.id, row);
      }

      const mixedIds = [...invoices.values()]
        .filter((row) => row.service_type === MULTIPLE_SERVICES_LABEL)
        .map((row) => row.id);
      const linesByInvoice = new Map<
        string,
        { service_type: string | null; quantity: number; unit_price: number }[]
      >();
      if (mixedIds.length > 0) {
        const { data: lines, error: lineErr } = await supabase
          .from("invoice_line_items")
          .select("invoice_id, service_type, quantity, unit_price")
          .in("invoice_id", mixedIds);
        if (lineErr) throw lineErr;
        for (const line of lines ?? []) {
          const bucket = linesByInvoice.get(line.invoice_id) ?? [];
          bucket.push(line);
          linesByInvoice.set(line.invoice_id, bucket);
        }
      }

      return [...invoices.values()].map((row) => ({
        id: row.id,
        service_id: row.service_id ?? "",
        status: row.status,
        total:
          row.service_type === MULTIPLE_SERVICES_LABEL
            ? serviceRevenueShare(row.total, linesByInvoice.get(row.id) ?? [], "grooming")
            : row.total,
      })) satisfies GroomingDayInvoiceRow[];
    },
  });
}

function invoiceAmountAed(row: Pick<GroomingDayInvoiceRow, "total">): number {
  const n = row.total;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

const INVOICE_PENDING_REVENUE_STATUSES = [
  "draft",
  "finalised",
  "issued",
  "outstanding",
  "overdue",
  "partially_paid",
] as const;

export function sumGroomingInvoicePaidAed(rows: readonly GroomingDayInvoiceRow[]): number {
  let s = 0;
  for (const r of rows) {
    if (r.status === "paid") s += invoiceAmountAed(r);
  }
  return Number(s.toFixed(3));
}

export function sumGroomingInvoicePendingAed(rows: readonly GroomingDayInvoiceRow[]): number {
  let s = 0;
  for (const r of rows) {
    if ((INVOICE_PENDING_REVENUE_STATUSES as readonly string[]).includes(r.status)) {
      s += invoiceAmountAed(r);
    }
  }
  return Number(s.toFixed(3));
}

function apptTimeSortKey(t: string | null): string {
  if (!t || t.length < 8) return "00:00:00";
  return t.slice(0, 8);
}

/** Latest `appointment_date` per pet among `completed` / `paid` grooms. */
export function useLastGroomingDateByPetIds(
  petIds: readonly string[],
  options?: { enabled?: boolean },
) {
  const sortedKey = [...petIds].sort().join(",");
  const extraEnabled = options?.enabled !== false;
  return useQuery({
    queryKey: ["grooming", "lastCompletedByPets", sortedKey] as const,
    enabled: extraEnabled && petIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grooming_appointments")
        .select("pet_id, appointment_date, appointment_time")
        .in("pet_id", [...petIds])
        .in("status", ["completed", "paid"]);
      if (error) throw error;
      const rows = data ?? [];
      const best = new Map<string, { date: string; time: string }>();
      for (const r of rows) {
        const tk = apptTimeSortKey(r.appointment_time);
        const prev = best.get(r.pet_id);
        if (!prev) {
          best.set(r.pet_id, { date: r.appointment_date, time: tk });
          continue;
        }
        const newer =
          r.appointment_date > prev.date ||
          (r.appointment_date === prev.date && tk > prev.time);
        if (newer) best.set(r.pet_id, { date: r.appointment_date, time: tk });
      }
      const out = new Map<string, string>();
      for (const [pid, v] of best) out.set(pid, v.date);
      return out;
    },
  });
}
