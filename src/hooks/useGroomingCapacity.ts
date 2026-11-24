import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  GROOMING_DAY_END_TIME,
  GROOMING_DAY_START_TIME,
} from "@/lib/groomingScheduleUtils";
import type { GroomingLinkedBookingInfo } from "@/lib/groomingBoardUi";

type GroomingRow = Database["public"]["Tables"]["grooming_appointments"]["Row"];
type GroomingInsert = Database["public"]["Tables"]["grooming_appointments"]["Insert"];
type GroomingService = Database["public"]["Enums"]["grooming_service"];

export type GroomingDayCapacity = {
  stations: number;
  window_minutes: number;
  total_minutes: number;
  committed_minutes: number;
  free_minutes: number;
  pinned_minutes: number;
  floating_minutes: number;
  feasible: boolean;
};

export type GroomingStationLoad = {
  station_id: string;
  station_name: string;
  window_minutes: number;
  used_minutes: number;
  free_minutes: number;
};

export type GroomingBacklogRow = {
  appt_id: string;
  pet_id: string;
  owner_id: string;
  dog_name: string | null;
  pet_breed: string | null;
  pet_size: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  service: GroomingService;
  duration_minutes: number;
  source_booking_id: string | null;
  booking_ref: string | null;
  must_finish_by: string | null;
  payment_method: string | null;
  status: string;
  groomer_id: string | null;
  grooming_notes: string | null;
  booking_type: Database["public"]["Enums"]["booking_type"] | null;
  booking_status: Database["public"]["Enums"]["booking_status"] | null;
  booking_check_in_date: string | null;
  booking_check_out_date: string | null;
};

export type GroomingLinkedBooking = GroomingLinkedBookingInfo;

export type GroomingPinnedAppt = Pick<
  GroomingRow,
  | "id"
  | "pet_id"
  | "owner_id"
  | "station_id"
  | "groomer_id"
  | "service"
  | "appointment_date"
  | "appointment_time"
  | "duration_minutes"
  | "status"
  | "no_show"
  | "booking_id"
  | "notes"
  | "grooming_notes"
  | "must_finish_by"
  | "payment_method"
  | "invoice_id"
  | "price"
> & {
  pets: { name: string; size: string | null; breed: string | null } | null;
  owners: { first_name: string; last_name: string; phone: string | null } | null;
  bookings: GroomingLinkedBooking | null;
  invoices: {
    status: Database["public"]["Enums"]["invoice_status"];
    total: number | null;
    invoice_line_items: { description: string | null }[] | null;
  } | null;
};

export type GroomingApptValidation = {
  ok: boolean;
  warnings: { code: string; msg: string }[];
};

export const groomingCapacityKeys = {
  day: (date: string) => ["grooming-day", date] as const,
  defaultMinutes: (service: string, size: string) =>
    ["groom-default", service, size] as const,
};

const PINNED_SELECT =
  "id, pet_id, owner_id, station_id, groomer_id, service, appointment_date, appointment_time, duration_minutes, status, no_show, booking_id, notes, grooming_notes, must_finish_by, payment_method, invoice_id, price, pets(name, size, breed), owners(first_name, last_name, phone), bookings(booking_type, status, booking_ref, check_in_date, check_out_date), invoices(status, total, invoice_line_items(description))";

const FLOATING_SELECT =
  "id, pet_id, owner_id, service, duration_minutes, booking_id, must_finish_by, payment_method, status, groomer_id, grooming_notes, pets(name, size, breed), owners(first_name, last_name), bookings(booking_type, status, booking_ref, check_in_date, check_out_date)";

type FloatingRow = {
  id: string;
  pet_id: string;
  owner_id: string;
  service: GroomingService;
  duration_minutes: number | null;
  booking_id: string | null;
  must_finish_by: string | null;
  payment_method: string | null;
  status: string;
  groomer_id: string | null;
  grooming_notes: string | null;
  pets: { name: string | null; size: string | null; breed: string | null } | null;
  owners: { first_name: string; last_name: string } | null;
  bookings: GroomingLinkedBooking | null;
};

function mapFloatingRow(row: FloatingRow): GroomingBacklogRow {
  return {
    appt_id: row.id,
    pet_id: row.pet_id,
    owner_id: row.owner_id,
    dog_name: row.pets?.name ?? null,
    pet_breed: row.pets?.breed ?? null,
    pet_size: row.pets?.size ?? null,
    owner_first_name: row.owners?.first_name ?? null,
    owner_last_name: row.owners?.last_name ?? null,
    service: row.service,
    duration_minutes: row.duration_minutes ?? 45,
    source_booking_id: row.booking_id,
    booking_ref: row.bookings?.booking_ref ?? null,
    must_finish_by: row.must_finish_by,
    payment_method: row.payment_method,
    status: row.status,
    groomer_id: row.groomer_id,
    grooming_notes: row.grooming_notes,
    booking_type: row.bookings?.booking_type ?? null,
    booking_status: row.bookings?.status ?? null,
    booking_check_in_date: row.bookings?.check_in_date ?? null,
    booking_check_out_date: row.bookings?.check_out_date ?? null,
  };
}

export function useGroomingDay(date: string) {
  return useQuery({
    queryKey: groomingCapacityKeys.day(date),
    enabled: !!date,
    queryFn: async () => {
      const [capRes, loadRes, pinnedRes, floatingRes] = await Promise.all([
        supabase.rpc("woof_grooming_day_capacity", {
          p_date: date,
          p_day_start: GROOMING_DAY_START_TIME,
          p_day_end: GROOMING_DAY_END_TIME,
        }),
        supabase.rpc("woof_grooming_station_load", {
          p_date: date,
          p_day_start: GROOMING_DAY_START_TIME,
          p_day_end: GROOMING_DAY_END_TIME,
        }),
        supabase
          .from("grooming_appointments")
          .select(PINNED_SELECT)
          .eq("appointment_date", date)
          .not("appointment_time", "is", null)
          .not("station_id", "is", null)
          .neq("status", "cancelled")
          .eq("no_show", false),
        supabase
          .from("grooming_appointments")
          .select(FLOATING_SELECT)
          .eq("appointment_date", date)
          .or("appointment_time.is.null,station_id.is.null")
          .neq("status", "cancelled")
          .eq("no_show", false)
          .limit(500),
      ]);
      if (capRes.error) throw capRes.error;
      if (loadRes.error) throw loadRes.error;
      if (pinnedRes.error) throw pinnedRes.error;
      if (floatingRes.error) throw floatingRes.error;

      const pinned = (pinnedRes.data ?? []) as GroomingPinnedAppt[];
      const backlog = ((floatingRes.data ?? []) as FloatingRow[]).map(mapFloatingRow);

      return {
        capacity: (capRes.data?.[0] ?? null) as GroomingDayCapacity | null,
        stations: (loadRes.data ?? []) as GroomingStationLoad[],
        pinned,
        backlog,
      };
    },
  });
}

/** @deprecated Prefer `useGroomingDay` — same query. */
export const useGroomingDayBoard = useGroomingDay;

export function useGroomDefaultMinutes(service?: string, size?: string) {
  return useQuery({
    enabled: !!service && !!size,
    queryKey: groomingCapacityKeys.defaultMinutes(service ?? "", size ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("woof_grooming_default_minutes", {
        p_service: service as GroomingService,
        p_size: size!,
      });
      if (error) throw error;
      return data as number;
    },
  });
}

export function useUpdateGroomingMustFinishBy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      apptId: string;
      appointmentDate: string;
      mustFinishBy: string | null;
    }) => {
      const { error } = await supabase
        .from("grooming_appointments")
        .update({ must_finish_by: input.mustFinishBy })
        .eq("id", input.apptId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: groomingCapacityKeys.day(vars.appointmentDate) });
      qc.invalidateQueries({ queryKey: ["grooming", "day", vars.appointmentDate] });
    },
  });
}

export type ScheduleGroomingApptInput = GroomingInsert & {
  id?: string;
  overrideReason?: string;
  staff?: string;
};

export class GroomingScheduleNeedsOverrideError extends Error {
  warnings: { code: string; msg: string }[];

  constructor(warnings: { code: string; msg: string }[]) {
    super("Grooming schedule needs override");
    this.name = "GroomingScheduleNeedsOverrideError";
    this.warnings = warnings;
  }
}

export async function rpcValidateGroomingAppt(params: {
  date: string;
  stationId: string | null;
  start: string | null;
  duration: number;
  apptId?: string | null;
}): Promise<GroomingApptValidation> {
  if (!params.start || !params.stationId) {
    return { ok: true, warnings: [] };
  }
  const { data, error } = await supabase.rpc("woof_validate_grooming_appt", {
    p_date: params.date,
    p_station_id: params.stationId,
    p_start: params.start,
    p_duration: params.duration,
    p_day_start: GROOMING_DAY_START_TIME,
    p_day_end: GROOMING_DAY_END_TIME,
    p_appt_id: params.apptId ?? null,
  });
  if (error) throw error;
  return data as GroomingApptValidation;
}

export async function logGroomingCapacityOverride(params: {
  appointmentId: string | null;
  jobDate: string;
  warnings: { code: string; msg: string }[];
  reason: string;
  staff?: string | null;
}) {
  const { error } = await supabase.from("grooming_overrides").insert({
    appointment_id: params.appointmentId,
    job_date: params.jobDate,
    warnings: params.warnings,
    reason: params.reason.trim(),
    overridden_by: params.staff ?? null,
  });
  if (error) throw error;
}

export function useScheduleGroomingAppt() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: ScheduleGroomingApptInput) => {
      const duration = input.duration_minutes ?? 45;
      const hasSchedule = !!(input.appointment_time && input.station_id);

      if (hasSchedule) {
        const { data: validation, error: valErr } = await supabase.rpc(
          "woof_validate_grooming_appt",
          {
            p_date: input.appointment_date,
            p_station_id: input.station_id ?? null,
            p_start: input.appointment_time ?? null,
            p_duration: duration,
            p_day_start: GROOMING_DAY_START_TIME,
            p_day_end: GROOMING_DAY_END_TIME,
            p_appt_id: input.id ?? null,
          },
        );
        if (valErr) throw valErr;

        const v = validation as GroomingApptValidation;
        if (!v.ok) {
          if (!input.overrideReason?.trim()) {
            throw new GroomingScheduleNeedsOverrideError(v.warnings ?? []);
          }
          const { error: ovErr } = await supabase.from("grooming_overrides").insert({
            appointment_id: input.id ?? null,
            job_date: input.appointment_date,
            warnings: v.warnings,
            reason: input.overrideReason.trim(),
            overridden_by: input.staff ?? null,
          });
          if (ovErr) throw ovErr;
        }
      }

      const { id, overrideReason: _r, staff: _s, ...row } = input;
      const payload = { ...row, duration_minutes: duration };
      if (id) {
        const { error } = await supabase.from("grooming_appointments").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("grooming_appointments").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: groomingCapacityKeys.day(vars.appointment_date) });
      qc.invalidateQueries({ queryKey: ["grooming", "day", vars.appointment_date] });
    },
  });
}
