import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCurrentStaffName as useSignedInStaff } from "@/hooks/useCurrentStaffName";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { pinAreaLabel } from "@/lib/transportPin";
import { SOURCE_LABEL, liveStops, mergeDemand, type BoardingStay, type DemandRow, type ScheduleStop } from "@/lib/transportSchedule";

export type TransportRequest = Database["public"]["Tables"]["transport_request"]["Row"];
export type TransportRequestInsert = Database["public"]["Tables"]["transport_request"]["Insert"];
export type TransportRegular = Database["public"]["Tables"]["transport_regular"]["Row"];
export type TransportRegularInsert = Database["public"]["Tables"]["transport_regular"]["Insert"];

type OwnerLite = {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  pin_lat: number | null;
  pin_lng: number | null;
  transport_notes: string | null;
};
type PetLite = { id: string; name: string; breed: string | null; driver_note: string | null; voltlines_passenger_id: string | null };

const OWNER_LITE = "id, first_name, last_name, phone, address, pin_lat, pin_lng, transport_notes";
const PET_LITE = "id, name, breed, driver_note, voltlines_passenger_id";

export type TransportSlot = Database["public"]["Tables"]["transport_slots"]["Row"];
export type TransportRequestEvent = Database["public"]["Tables"]["transport_request_event"]["Row"];

export type TransportRequestWithDetails = TransportRequest & {
  owners: OwnerLite | null;
  transport_request_pet: { pet_id: string; pets: PetLite | null }[];
  transport_slots: { id: string; label: string; start_min: number; end_min: number } | null;
};

const REQUEST_SELECT = `*, owners(${OWNER_LITE}), transport_request_pet(pet_id, pets(${PET_LITE})), transport_slots(id, label, start_min, end_min)`;

export type TransportRegularWithDetails = TransportRegular & {
  owners: OwnerLite | null;
  pets: PetLite | null;
};

export type BoardStop = ScheduleStop & { owner: OwnerLite | null; pet: PetLite | null };

const KEY = {
  day: (date: string, branchId: string | null) => ["transport", "day", date, branchId] as const,
  regulars: (branchId: string | null) => ["transport", "regulars", branchId] as const,
  owner: (ownerId: string) => ["transport", "owner", ownerId] as const,
};

// Polled like AE's transport screens: the board changes as reception works.
const REFETCH_MS = 60_000;

/**
 * Every pet that needs a van on a date, merged and joined to owner + pet details.
 * branchId null = every branch the signed-in staff member may see.
 */
export function useTransportDay(date: string, branchId: string | null) {
  return useQuery({
    queryKey: KEY.day(date, branchId),
    enabled: !!date,
    refetchInterval: REFETCH_MS,
    queryFn: async (): Promise<BoardStop[]> => {
      const { data, error } = await supabase.rpc("transport_day_demand", {
        p_date: date,
        ...(branchId ? { p_branch_id: branchId } : {}),
      });
      if (error) throw error;
      const stops = mergeDemand((data ?? []) as DemandRow[]);
      if (stops.length === 0) return [];

      const ownerIds = [...new Set(stops.map((s) => s.ownerId))];
      const petIds = [...new Set(stops.map((s) => s.petId))];
      const [owners, pets] = await Promise.all([
        supabase.from("owners").select(OWNER_LITE).in("id", ownerIds),
        supabase.from("pets").select(PET_LITE).in("id", petIds),
      ]);
      if (owners.error) throw owners.error;
      if (pets.error) throw pets.error;
      const ownerById = new Map((owners.data as OwnerLite[]).map((o) => [o.id, o]));
      const petById = new Map((pets.data as PetLite[]).map((p) => [p.id, p]));
      return stops.map((s) => ({ ...s, owner: ownerById.get(s.ownerId) ?? null, pet: petById.get(s.petId) ?? null }));
    },
  });
}

/**
 * The shared board (Desk): every branch's pets, whatever the viewer's home branch.
 * Petzania only; the all-brand Master board lives in admin-essentials.
 */
export function useTransportBoard(date: string) {
  const query = useTransportDay(date, null);
  // The boards show what is actually running; the Schedule keeps struck runs.
  const data = useMemo(() => (query.data ? liveStops(query.data) : query.data), [query.data]);
  return { ...query, data };
}

/** The shared van time slots (same catalogue as AE), active only, by start time. */
export function useTransportSlots() {
  return useQuery({
    queryKey: ["transport", "slots"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_slots")
        .select("*")
        .eq("is_active", true)
        .order("start_min");
      if (error) throw error;
      return (data ?? []) as TransportSlot[];
    },
  });
}

/**
 * Request rows for the Requests views. Branch scoping is RLS's job (a receptionist
 * with a home branch only ever gets theirs); the All / DIP / BB toggle filters on top.
 *   open     → everything still received (Inbox and Missed)
 *   approved → approved rows dated from `from` on, plus undated weekly asks
 *   past     → approved rows dated within [from, to]
 *   missed   → dated additions within [from, to], answered or not (for the Missed view)
 */
export function useTransportRequestRows(
  scope: "open" | "approved" | "past" | "missed",
  range: { from: string; to?: string } | null = null,
) {
  return useQuery({
    queryKey: ["transport", "requests", scope, range?.from ?? null, range?.to ?? null],
    refetchInterval: REFETCH_MS,
    queryFn: async () => {
      let q = supabase.from("transport_request").select(REQUEST_SELECT).order("created_at", { ascending: false }).limit(1000);
      if (scope === "open") q = q.in("status", ["received", "offered"]);
      else if (scope === "missed") {
        // Dated additions in the range, answered or not; rowMissed() decides which were late.
        q = q.eq("kind", "one_off").in("status", ["received", "offered", "approved", "rejected"]);
        if (range) q = q.gte("service_date", range.from).lte("service_date", range.to ?? range.from);
      } else {
        q = q.eq("status", "approved");
        if (scope === "approved" && range) q = q.or(`service_date.gte.${range.from},service_date.is.null`);
        if (scope === "past" && range) q = q.gte("service_date", range.from).lte("service_date", range.to ?? range.from);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as TransportRequestWithDetails[];
    },
  });
}

/** Every row of one card, and its history. */
export function useTransportRequestGroup(groupId: string | null) {
  return useQuery({
    queryKey: ["transport", "request-group", groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const [rows, events] = await Promise.all([
        supabase.from("transport_request").select(REQUEST_SELECT).eq("group_id", groupId!).order("service_date").order("weekday"),
        supabase.from("transport_request_event").select("*").eq("group_id", groupId!).order("at"),
      ]);
      if (rows.error) throw rows.error;
      if (events.error) throw events.error;
      return {
        rows: (rows.data ?? []) as unknown as TransportRequestWithDetails[],
        events: (events.data ?? []) as TransportRequestEvent[],
      };
    },
  });
}

/** The signed-in staff member's name, for "who did it" on requests. */
export function useCurrentStaffName() {
  const { staffName, isLoading } = useSignedInStaff();
  return { data: staffName.trim() ? staffName : null, isLoading };
}

export type SameDayConflict = { date: string; petId: string; petName: string; direction: string; time: string | null; source: string };

/**
 * AE's same-day notice: which of these pets already have a live run on these dates and
 * directions, so reception doesn't book the same trip twice.
 */
export function useSameDayConflicts(
  ownerId: string | null,
  petIds: string[],
  dates: string[],
  directions: string[],
  /** The request being approved: its own trip is not a clash with itself. */
  excludeRequestIds: string[] = [],
) {
  const key = [
    ownerId,
    [...petIds].sort().join(","),
    [...dates].sort().join(","),
    [...directions].sort().join(","),
    [...excludeRequestIds].sort().join(","),
  ];
  const { data = [] } = useQuery({
    queryKey: ["transport", "same-day", ...key],
    enabled: !!ownerId && petIds.length > 0 && dates.length > 0 && directions.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<SameDayConflict[]> => {
      const out: SameDayConflict[] = [];
      const { data: pets } = await supabase.from("pets").select("id, name").in("id", petIds);
      const names = new Map((pets ?? []).map((p) => [p.id, p.name]));
      for (const date of dates) {
        const { data: rows, error } = await supabase.rpc("transport_day_demand", { p_date: date });
        if (error) throw error;
        for (const s of liveStops(mergeDemand((rows ?? []) as DemandRow[]))) {
          const onlyItself = s.sources.every((src) => src === "request") && excludeRequestIds.includes(s.sourceId);
          if (!onlyItself && s.ownerId === ownerId && petIds.includes(s.petId) && directions.includes(s.direction)) {
            out.push({
              date,
              petId: s.petId,
              petName: names.get(s.petId) ?? "This dog",
              direction: s.direction,
              time: s.time,
              source: s.purpose === "vet" ? "Vet visit" : s.purpose === "transfer" ? "Branch move" : SOURCE_LABEL[s.source],
            });
          }
        }
      }
      return out;
    },
  });
  return data;
}

/**
 * Boarding stays of these dogs that touch any of these dates (AE useBoardingStaysFor),
 * for the form's "this trip will not run" warning.
 */
export function useBoardingStaysFor(petIds: string[], dates: string[]) {
  const sortedDates = [...dates].filter(Boolean).sort();
  const from = sortedDates[0];
  const to = sortedDates[sortedDates.length - 1];
  return useQuery({
    queryKey: ["transport", "boarding-stays", [...petIds].sort().join(","), from ?? null, to ?? null],
    enabled: petIds.length > 0 && !!from,
    staleTime: 60_000,
    queryFn: async (): Promise<BoardingStay[]> => {
      const { data, error } = await supabase
        .from("booking_pets")
        .select("pet_id, bookings!inner(id, check_in_date, check_out_date, status, booking_type)")
        .in("pet_id", petIds)
        .lte("bookings.check_in_date", to!)
        .gte("bookings.check_out_date", from!)
        .in("bookings.status", ["confirmed", "checked_in"]);
      if (error) throw error;
      const byStay = new Map<string, BoardingStay>();
      for (const row of (data ?? []) as unknown as {
        pet_id: string;
        bookings: { id: string; check_in_date: string; check_out_date: string; booking_type: string | null };
      }[]) {
        const b = row.bookings;
        if (b.booking_type && b.booking_type !== "boarding") continue;
        const stay = byStay.get(b.id) ?? { check_in_date: b.check_in_date, check_out_date: b.check_out_date, petIds: [] };
        stay.petIds.push(row.pet_id);
        byStay.set(b.id, stay);
      }
      return [...byStay.values()];
    },
  });
}

export type DayNote = Database["public"]["Tables"]["transport_day_note"]["Row"];

/** Household notes for a date (AE transport_day_note), keyed `${owner_id}|${direction}`. */
export function useDayNotes(date: string) {
  return useQuery({
    queryKey: ["transport", "day-notes", date],
    enabled: !!date,
    refetchInterval: REFETCH_MS,
    queryFn: async () => {
      const { data, error } = await supabase.from("transport_day_note").select("*").eq("service_date", date);
      if (error) throw error;
      return new Map((data ?? []).map((n) => [`${n.owner_id}|${n.direction}`, n as DayNote]));
    },
  });
}

/** Set (or clear, with an empty note) a household's note for a date and direction. */
export function useSaveDayNote() {
  const invalidate = useInvalidateTransport();
  return useMutation({
    mutationFn: async (n: { date: string; direction: string; ownerId: string; note: string; actor: string }) => {
      const note = n.note.trim();
      if (!note) {
        const { error } = await supabase
          .from("transport_day_note")
          .delete()
          .eq("service_date", n.date)
          .eq("direction", n.direction)
          .eq("owner_id", n.ownerId);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from("transport_day_note")
        .upsert(
          { service_date: n.date, direction: n.direction, owner_id: n.ownerId, note: note.slice(0, 1000), updated_by: n.actor },
          { onConflict: "service_date,direction,owner_id" },
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export type ClientDay = { date: string; stops: BoardStop[] };

/** One household's travel days (AE ClientScheduleSearch), merged per day, struck rows kept. */
export function useClientSchedule(ownerId: string | null, from: string, days: number) {
  return useQuery({
    queryKey: ["transport", "client-schedule", ownerId, from, days],
    enabled: !!ownerId,
    queryFn: async (): Promise<ClientDay[]> => {
      const { data, error } = await supabase.rpc("transport_client_schedule", {
        p_owner_id: ownerId!,
        p_from: from,
        p_days: days,
      });
      if (error) throw error;
      const rows = (data ?? []) as (DemandRow & { service_date: string })[];
      if (!rows.length) return [];
      const petIds = [...new Set(rows.map((r) => r.pet_id))];
      const [owner, pets] = await Promise.all([
        supabase.from("owners").select(OWNER_LITE).eq("id", ownerId!).maybeSingle(),
        supabase.from("pets").select(PET_LITE).in("id", petIds),
      ]);
      const petById = new Map(((pets.data ?? []) as PetLite[]).map((p) => [p.id, p]));
      const byDate = new Map<string, DemandRow[]>();
      for (const r of rows) {
        const day = String(r.service_date).slice(0, 10);
        byDate.set(day, [...(byDate.get(day) ?? []), r]);
      }
      return [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, list]) => ({
          date,
          stops: mergeDemand(list).map((s) => ({ ...s, owner: (owner.data as OwnerLite) ?? null, pet: petById.get(s.petId) ?? null })),
        }));
    },
  });
}

export type ActivityEvent = TransportRequestEvent & {
  transport_request: {
    kind: string;
    purpose: string;
    direction: string;
    service_date: string | null;
    weekday: number | null;
    branch_id: string;
    owners: { first_name: string; last_name: string | null } | null;
    transport_request_pet: { pets: { name: string } | null }[];
  } | null;
};

/** Who did what to requests, newest first (AE's Activity tab). */
export function useTransportActivity(limit = 300) {
  return useQuery({
    queryKey: ["transport", "activity", limit],
    refetchInterval: REFETCH_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_request_event")
        .select(
          "*, transport_request(kind, purpose, direction, service_date, weekday, branch_id, owners(first_name, last_name), transport_request_pet(pets(name)))",
        )
        .order("at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as ActivityEvent[];
    },
  });
}

export function useTransportRegulars(branchId: string | null) {
  return useQuery({
    queryKey: KEY.regulars(branchId),
    refetchInterval: REFETCH_MS,
    queryFn: async () => {
      let q = supabase
        .from("transport_regular")
        .select(`*, owners(${OWNER_LITE}), pets(${PET_LITE})`)
        .eq("is_active", true)
        .order("weekday")
        .order("pickup_time", { nullsFirst: false });
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as TransportRegularWithDetails[];
    },
  });
}

/** A household's transport: its active regulars and its requests from today on. */
export function useOwnerTransport(ownerId: string, fromDate: string) {
  return useQuery({
    queryKey: KEY.owner(ownerId),
    enabled: !!ownerId,
    queryFn: async () => {
      const [regulars, requests] = await Promise.all([
        supabase
          .from("transport_regular")
          .select(`*, pets(${PET_LITE})`)
          .eq("owner_id", ownerId)
          .eq("is_active", true)
          .order("weekday"),
        supabase
          .from("transport_request")
          .select(REQUEST_SELECT)
          .eq("owner_id", ownerId)
          .in("status", ["received", "offered", "approved"])
          .or(`service_date.gte.${fromDate},service_date.is.null`)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (regulars.error) throw regulars.error;
      if (requests.error) throw requests.error;
      return {
        regulars: (regulars.data ?? []) as unknown as TransportRegularWithDetails[],
        requests: (requests.data ?? []) as unknown as TransportRequestWithDetails[],
      };
    },
  });
}

function useInvalidateTransport() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["transport"] });
}

/**
 * Records one ask: every row (one direction × one date or weekday) in a single group,
 * each carrying all the chosen pets.
 */
export function useRecordTransportRequest() {
  const invalidate = useInvalidateTransport();
  return useMutation({
    mutationFn: async ({ rows, petIds }: { rows: Omit<TransportRequestInsert, "group_id">[]; petIds: string[] }) => {
      if (petIds.length === 0) throw new Error("Pick at least one dog");
      if (rows.length === 0) throw new Error("Nothing to record");
      const groupId = crypto.randomUUID();
      const { data, error } = await supabase
        .from("transport_request")
        .insert(rows.map((r) => ({ ...r, group_id: groupId })))
        .select("id");
      if (error) throw error;
      const ids = (data ?? []).map((r) => r.id);
      const { error: petsError } = await supabase
        .from("transport_request_pet")
        .insert(ids.flatMap((request_id) => petIds.map((pet_id) => ({ request_id, pet_id }))));
      if (petsError) {
        // No half-made request without dogs: it would never reach the board.
        await supabase.from("transport_request").delete().eq("group_id", groupId);
        throw petsError;
      }
      return { groupId, count: ids.length };
    },
    onSuccess: invalidate,
  });
}

/** Edits rows of a card in place (slot, date, notes, branch, customer, location). */
export function useUpdateTransportRequestRows() {
  const invalidate = useInvalidateTransport();
  return useMutation({
    mutationFn: async ({ ids, patch }: { ids: string[]; patch: Partial<TransportRequest> }) => {
      const { error } = await supabase.from("transport_request").update(patch).in("id", ids);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Replaces which dogs a card is for (Change customer / dogs). */
export function useSetTransportRequestPets() {
  const invalidate = useInvalidateTransport();
  return useMutation({
    mutationFn: async ({ ids, petIds }: { ids: string[]; petIds: string[] }) => {
      if (petIds.length === 0) throw new Error("Pick at least one dog");
      const { error: delError } = await supabase.from("transport_request_pet").delete().in("request_id", ids);
      if (delError) throw delError;
      const { error } = await supabase
        .from("transport_request_pet")
        .insert(ids.flatMap((request_id) => petIds.map((pet_id) => ({ request_id, pet_id }))));
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Approve / reject / withdraw a card's still-received rows (transport_request_decide). */
export function useDecideTransportRequest() {
  const invalidate = useInvalidateTransport();
  return useMutation({
    mutationFn: async ({
      ids,
      action,
      actor,
      reason,
    }: {
      ids: string[];
      action: "approve" | "reject" | "cancel";
      actor: string;
      reason?: string;
    }) => {
      const { data, error } = await supabase.rpc("transport_request_decide", {
        p_request_ids: ids,
        p_action: action,
        p_actor: actor,
        ...(reason ? { p_reason: reason } : {}),
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: invalidate,
  });
}

export function useCreateTransportRegulars() {
  const invalidate = useInvalidateTransport();
  return useMutation({
    mutationFn: async (rows: TransportRegularInsert[]) => {
      if (rows.length === 0) throw new Error("Pick at least one pet and one day");
      const { error } = await supabase.from("transport_regular").insert(rows);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateTransportRegular() {
  const invalidate = useInvalidateTransport();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TransportRegular> & { id: string }) => {
      const { error } = await supabase.from("transport_regular").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Every regular row a pet has had, newest first — the Edit pattern history (AE RuleHistory). */
export function usePetRegularHistory(petId: string | null) {
  return useQuery({
    queryKey: ["transport", "regular-history", petId],
    enabled: !!petId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_regular")
        .select("*")
        .eq("pet_id", petId!)
        .order("starts_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TransportRegular[];
    },
  });
}

export type RegularDayChange = {
  /** The row running on this weekday today, if any. */
  existing: TransportRegular | null;
  /** For a new row: who and where. */
  base: Pick<TransportRegularInsert, "branch_id" | "owner_id" | "pet_id" | "weekday"> & {
    transfer_to_branch_id?: string | null;
  };
  direction: "pickup" | "dropoff";
  /** "HH:00" of the new hour slot, or null for no transport that way. */
  time: string | null;
  today: string;
  yesterday: string;
  actor: string;
};

/**
 * AE's Edit pattern change: one weekday, one direction, from today. The old row is kept
 * as history (it ends yesterday) unless it only began today, then it is edited in place.
 * Moving a direction to a new hour clears that direction's flexible window, as AE's
 * custom window follows the slot.
 */
export function useChangeRegularDay() {
  const invalidate = useInvalidateTransport();
  return useMutation({
    mutationFn: async (c: RegularDayChange) => {
      const ex = c.existing;
      const pu = c.direction === "pickup" ? c.time : ex && ex.direction !== "dropoff" ? ex.pickup_time : null;
      const dr = c.direction === "dropoff" ? c.time : ex && ex.direction !== "pickup" ? ex.dropoff_time : null;
      const wantsPu = c.direction === "pickup" ? !!c.time : !!ex && ex.direction !== "dropoff";
      const wantsDo = c.direction === "dropoff" ? !!c.time : !!ex && ex.direction !== "pickup";
      const direction = wantsPu && wantsDo ? "both" : wantsPu ? "pickup" : wantsDo ? "dropoff" : null;
      const windows = {
        pickup_window_start_min: c.direction === "pickup" || !ex ? null : ex.pickup_window_start_min,
        pickup_window_end_min: c.direction === "pickup" || !ex ? null : ex.pickup_window_end_min,
        dropoff_window_start_min: c.direction === "dropoff" || !ex ? null : ex.dropoff_window_start_min,
        dropoff_window_end_min: c.direction === "dropoff" || !ex ? null : ex.dropoff_window_end_min,
      };
      const next = direction
        ? {
            direction,
            pickup_time: direction !== "dropoff" ? pu : null,
            dropoff_time: direction !== "pickup" ? dr : null,
            ...(direction === "dropoff" ? { pickup_window_start_min: null, pickup_window_end_min: null } : {}),
            ...(direction === "pickup" ? { dropoff_window_start_min: null, dropoff_window_end_min: null } : {}),
          }
        : null;

      if (ex && ex.starts_on >= c.today) {
        const { error } = next
          ? await supabase.from("transport_regular").update({ ...windows, ...next }).eq("id", ex.id)
          : await supabase.from("transport_regular").update({ is_active: false, ends_on: c.today }).eq("id", ex.id);
        if (error) throw error;
        return;
      }
      if (ex) {
        const { error } = await supabase.from("transport_regular").update({ ends_on: c.yesterday }).eq("id", ex.id);
        if (error) throw error;
      }
      if (!next) return;
      const { error } = await supabase.from("transport_regular").insert({
        branch_id: ex?.branch_id ?? c.base.branch_id,
        owner_id: ex?.owner_id ?? c.base.owner_id,
        pet_id: ex?.pet_id ?? c.base.pet_id,
        weekday: ex?.weekday ?? c.base.weekday,
        transfer_to_branch_id: ex ? ex.transfer_to_branch_id : c.base.transfer_to_branch_id ?? null,
        notes: ex?.notes ?? null,
        starts_on: c.today,
        created_by: c.actor,
        ...windows,
        ...next,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export type HubStatus = {
  enabled: boolean;
  configured: boolean;
  hub: { enabled?: boolean; error?: string } | null;
};

export type HubOffer = {
  slotLabel: string | null;
  startMin: number | null;
  promisedSlotLabel: string | null;
  eta: string | null;
  shiftHours: number;
  /** "costs {km} km / {min} min" on AE's offer list. */
  addedKm?: number | null;
  addedMinutes?: number | null;
  /** Off the published hour grid: "outside the windows we publish". */
  outsideWindows?: boolean;
  recommended: boolean;
  fitsClient: boolean | null;
  displaces: number;
  needsVan: boolean;
  van: string | null;
  basis: string;
};

export type HubQuote = { outcome: string; reason: string | null; offers: HubOffer[]; estimated?: boolean };

export type HubSyncResult = {
  ok: boolean;
  range: { from: string; to: string };
  sent: { dogs: number; regulars: number; dated: number };
  hub: {
    clients: { written: number; retired: number; skipped: Array<{ ref: string; reason: string }> };
    rules: { written: number; suspended: number; skipped: Array<{ ref: string; reason: string }> };
    requests: { written: number; cancelled: number; skipped: Array<{ ref: string; reason: string }> };
  };
  notSent: Array<{ petId: string; pet: string | null; reason: string; count: number }>;
};

async function hubApi<T>(init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(init?.body ? "/api/transport-hub" : "/api/transport-hub?status=1", {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `The transport hub did not answer (${res.status})`);
  return body;
}

export function useTransportHubStatus() {
  return useQuery({
    queryKey: ["transport", "hub-status"],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => hubApi<HubStatus>(),
  });
}

export function useTransportHubQuote() {
  return useMutation({
    mutationFn: (input: {
      petId: string;
      date: string;
      direction: "pickup" | "dropoff";
      startMin: number;
      location?: { label: string; lat: number; lng: number };
      /** new_recurring: quoted against the Master base for the weekday of `date`. */
      kind?: "one_off" | "new_recurring";
      /** A vet leg: AE keeps only times that reach the clinic by deadlineMin, or collect after readyMin. */
      vet?: { deadlineMin?: number; readyMin?: number; windowStartMin?: number; windowEndMin?: number };
    }) => hubApi<HubQuote>({ method: "POST", body: JSON.stringify({ op: "quote", ...input }) }),
  });
}

export function useTransportHubSync() {
  return useMutation({
    mutationFn: () => hubApi<HubSyncResult>({ method: "POST", body: JSON.stringify({ op: "sync" }) }),
  });
}


// ── Offers and promises on a request — AE's Offer / Accept (transport_request_offer) ──

export type TransportRequestOffer = Database["public"]["Tables"]["transport_request_offer"]["Row"];

/** "HH:MM" from minutes after midnight (AE's hhmm); "—" when unknown. */
export function hhmm(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "08:20" → 500. */
export function minutesOf(clock: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(clock ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The stored offers of these request rows, by row, in rank order. */
export function useRequestOffers(requestIds: string[]) {
  const ids = [...requestIds].sort();
  return useQuery({
    queryKey: ["transport", "request-offers", ...ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_request_offer")
        .select("*")
        .in("request_id", ids)
        .order("rank");
      if (error) throw error;
      const by = new Map<string, TransportRequestOffer[]>();
      for (const o of data ?? []) by.set(o.request_id, [...(by.get(o.request_id) ?? []), o]);
      return by;
    },
  });
}

/** One hub quote stored as offer rows (AE persistOffersOnRequest). */
export function offerRowsOf(requestId: string, quote: HubQuote, actor: string | null) {
  return quote.offers.map((o, i) => ({
    request_id: requestId,
    rank: i + 1,
    outcome: quote.outcome,
    reason: quote.reason,
    slot_start_min: o.startMin,
    slot_label: o.slotLabel,
    promised_slot_label: o.promisedSlotLabel,
    outside_windows: !!o.outsideWindows,
    shift_hours: o.shiftHours ?? 0,
    eta_min: minutesOf(o.eta),
    added_km: o.addedKm ?? null,
    added_minutes: o.addedMinutes ?? null,
    displaces: o.displaces ?? 0,
    recommended: !!o.recommended,
    basis: o.basis ?? null,
    created_by: actor,
  }));
}

export type OfferLeg = {
  requestId: string;
  petId: string;
  date: string;
  direction: "pickup" | "dropoff";
  startMin: number;
  location?: { label: string; lat: number; lng: number };
  /** new_recurring: `date` is the first day it runs, quoted against that weekday's Master base. */
  kind?: "one_off" | "new_recurring";
};

/**
 * AE's Offer / Offer again: quote every leg on the hub, store its options, and mark the
 * request offered. A second Offer replaces the options not yet decided.
 */
export function useOfferRequest() {
  const invalidate = useInvalidateTransport();
  return useMutation({
    mutationFn: async ({ legs, actor }: { legs: OfferLeg[]; actor: string }) => {
      const results: Array<{ requestId: string; quote: HubQuote | null; error: string | null }> = [];
      for (const leg of legs) {
        try {
          const quote = await hubApi<HubQuote>({
            method: "POST",
            body: JSON.stringify({
              op: "quote",
              petId: leg.petId,
              date: leg.date,
              direction: leg.direction,
              startMin: leg.startMin,
              ...(leg.location ? { location: leg.location } : {}),
              ...(leg.kind === "new_recurring" ? { kind: "new_recurring" } : {}),
            }),
          });
          const { error: delErr } = await supabase
            .from("transport_request_offer")
            .delete()
            .eq("request_id", leg.requestId)
            .eq("chosen_by_staff", false);
          if (delErr) throw delErr;
          const rows = offerRowsOf(leg.requestId, quote, actor);
          if (rows.length) {
            const { error: insErr } = await supabase.from("transport_request_offer").insert(rows);
            if (insErr) throw insErr;
          }
          const { error: upErr } = await supabase
            .from("transport_request")
            .update({ status: "offered", offered_by: actor, offered_at: new Date().toISOString(), updated_by: actor })
            .eq("id", leg.requestId)
            .in("status", ["received", "offered"]);
          if (upErr) throw upErr;
          results.push({ requestId: leg.requestId, quote, error: null });
        } catch (err) {
          results.push({ requestId: leg.requestId, quote: null, error: (err as Error).message });
        }
      }
      return results;
    },
    onSuccess: invalidate,
  });
}

/** The promise AE records on accept: the hour, its window, and when the van comes. */
export function promiseFields(
  offer: Pick<TransportRequestOffer, "id" | "slot_start_min" | "eta_min">,
  slots: TransportSlot[],
  direction: string,
) {
  const slot = slots.find((s) => s.direction === direction && s.start_min === offer.slot_start_min) ?? null;
  const eta = offer.eta_min;
  return {
    accepted_offer_id: offer.id,
    promised_slot_id: slot?.id ?? null,
    requested_slot_id: slot?.id ?? null,
    promised_window_start_min: slot ? slot.start_min : eta != null ? Math.max(0, eta - 30) : null,
    promised_window_end_min: slot ? slot.end_min : eta != null ? Math.min(1439, eta + 30) : null,
    promised_eta_min: eta,
  };
}

/**
 * AE's Accept (api/transport-accept): the promise is recorded against the person and the
 * trip is approved; options the client turned down are marked declined.
 */
export function useAcceptRequestOffer() {
  const invalidate = useInvalidateTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      direction,
      offer,
      declinedOfferIds,
      slots,
      actor,
      kind,
    }: {
      requestId: string;
      direction: string;
      offer: TransportRequestOffer;
      declinedOfferIds: string[];
      slots: TransportSlot[];
      actor: string;
      kind?: string | null;
    }) => {
      if (declinedOfferIds.length) {
        const { error } = await supabase
          .from("transport_request_offer")
          .update({ declined_by_client: true })
          .in("id", declinedOfferIds);
        if (error) throw error;
      }
      const { error: chosenErr } = await supabase
        .from("transport_request_offer")
        .update({ chosen_by_staff: true })
        .eq("id", offer.id);
      if (chosenErr) throw chosenErr;
      // The promised hour becomes the trip's (or the regular's) time, then the request is
      // approved the way Approve does it, so a new regular is created at that hour.
      const { error } = await supabase
        .from("transport_request")
        .update({ ...promiseFields(offer, slots, direction), updated_by: actor })
        .eq("id", requestId);
      if (error) throw error;
      const { error: decideErr } = await supabase.rpc("transport_request_decide", {
        p_request_ids: [requestId],
        p_action: "approve",
        p_actor: actor,
      });
      if (decideErr) throw decideErr;
      return {
        message:
          kind === "new_recurring"
            ? "Promise recorded and the regular approved. It is on the Master base within seconds."
            : "Promise recorded. It is on the schedule and on the Master within seconds.",
      };
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["transport", "request-offers"] });
    },
  });
}

/**
 * AE's Book by hand: no quote is possible (no Voltlines passenger, or no usable pin),
 * so the trip is approved at the hour on the card and flagged for review.
 */
export function useBookByHand() {
  const invalidate = useInvalidateTransport();
  return useMutation({
    mutationFn: async ({ ids, reason, actor }: { ids: string[]; reason: string; actor: string }) => {
      const { error } = await supabase
        .from("transport_request")
        .update({ updated_by: actor, needs_review: true, review_reason: reason })
        .in("id", ids)
        .in("status", ["received", "offered"]);
      if (error) throw error;
      // Approve the way Approve does it, so a new regular is created at the hour on the card.
      const { error: decideErr } = await supabase.rpc("transport_request_decide", {
        p_request_ids: ids,
        p_action: "approve",
        p_actor: actor,
      });
      if (decideErr) throw decideErr;
    },
    onSuccess: invalidate,
  });
}

/**
 * A promise accepted on the new-request form: store the quote's options on the saved
 * rows and mark the chosen one, so the request reads as one offered and accepted in the
 * Inbox (same rows, same promise).
 */
export async function storeFormOffers(
  groupId: string,
  // index = the option accepted; null keeps the options with none chosen (an Offered request).
  accepted: Partial<Record<"pickup" | "dropoff", { quote: HubQuote; index?: number | null }>>,
  actor: string | null,
): Promise<string[]> {
  const chosenIds: string[] = [];
  const { data: saved, error } = await supabase.from("transport_request").select("id, direction").eq("group_id", groupId);
  if (error) throw error;
  for (const row of saved ?? []) {
    const choice = accepted[row.direction as "pickup" | "dropoff"];
    if (!choice) continue;
    const rows = offerRowsOf(row.id, choice.quote, actor).map((o, i) => ({ ...o, chosen_by_staff: choice.index != null && i === choice.index }));
    if (!rows.length) continue;
    const { data: inserted, error: insErr } = await supabase.from("transport_request_offer").insert(rows).select("id, rank");
    if (insErr) throw insErr;
    const chosen = choice.index != null ? (inserted ?? []).find((o) => o.rank === choice.index! + 1) : undefined;
    if (chosen) {
      const { error: upErr } = await supabase.from("transport_request").update({ accepted_offer_id: chosen.id }).eq("id", row.id);
      if (upErr) throw upErr;
      chosenIds.push(row.id);
    }
  }
  return chosenIds;
}

/**
 * A client with no home pin, but a dog already on Voltlines: the van's pin is the one
 * Voltlines has. Copy it onto the profile (and the address line, when Woof has none)
 * so the request form stops saying the van has nowhere to go.
 *
 * It reads the local copy of the directory (voltlines_passenger_directory), never
 * Voltlines itself — the account is MSH dispatch's. An admin refreshes that copy from
 * Transport; until they have, this simply finds nothing.
 */
export function useAdoptVoltlinesHomePin(
  owner: { id: string; pin_lat: number | null; pin_lng: number | null; address: string | null } | null | undefined,
) {
  const qc = useQueryClient();
  const writing = useRef<string | null>(null);
  const home = useQuery({
    queryKey: ["transport", "voltlines-home", owner?.id ?? null],
    enabled: !!owner?.id && owner.pin_lat == null,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: pets, error } = await supabase
        .from("pets")
        .select("name, voltlines_passenger_id")
        .eq("owner_id", owner!.id)
        .not("voltlines_passenger_id", "is", null);
      if (error) throw error;
      const ids = (pets ?? []).map((p) => p.voltlines_passenger_id).filter((id): id is string => !!id);
      if (!ids.length) return null;
      const { data: rows, error: dirError } = await supabase
        .from("voltlines_passenger_directory")
        .select("passenger_id, address_line, lat, lng")
        .in("passenger_id", ids);
      if (dirError) throw dirError;
      const hit = (rows ?? []).find((r) => r.lat != null && r.lng != null && pinAreaLabel(r.lat, r.lng));
      if (!hit || hit.lat == null || hit.lng == null) return null;
      return {
        lat: hit.lat,
        lng: hit.lng,
        address: hit.address_line,
        petName: (pets ?? []).find((p) => p.voltlines_passenger_id === hit.passenger_id)?.name ?? null,
      };
    },
  });

  useEffect(() => {
    if (!home.error || !owner?.id || writing.current === `err:${owner.id}`) return;
    writing.current = `err:${owner.id}`;
    toast.error(home.error instanceof Error ? home.error.message : "Couldn't read the Voltlines home pin");
  }, [home.error, owner?.id]);

  useEffect(() => {
    const row = home.data;
    if (!owner?.id || owner.pin_lat != null || !row || writing.current === owner.id) return;
    writing.current = owner.id;
    void supabase
      .from("owners")
      .update({
        pin_lat: row.lat,
        pin_lng: row.lng,
        pin_source: "voltlines",
        pin_updated_at: new Date().toISOString(),
        ...(owner.address?.trim() || !row.address ? {} : { address: row.address }),
      })
      .eq("id", owner.id)
      .then(({ error }) => {
        if (error) {
          writing.current = null;
          toast.error(error.message);
          return;
        }
        toast.success(`Home pin taken from Voltlines${row.petName ? ` (${row.petName})` : ""}`);
        qc.invalidateQueries({ queryKey: ["owners"] });
        qc.invalidateQueries({ queryKey: ["transport"] });
      });
  }, [owner?.id, owner?.pin_lat, owner?.address, home.data, qc]);

  return owner?.pin_lat == null ? home.data ?? null : null;
}
