import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCurrentStaffName as useSignedInStaff } from "@/hooks/useCurrentStaffName";
import { useMemo } from "react";
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
      if (scope === "open") q = q.eq("status", "received");
      else if (scope === "missed") {
        // Dated additions in the range, answered or not; rowMissed() decides which were late.
        q = q.eq("kind", "one_off").in("status", ["received", "approved", "rejected"]);
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
export function useSameDayConflicts(ownerId: string | null, petIds: string[], dates: string[], directions: string[]) {
  const key = [ownerId, [...petIds].sort().join(","), [...dates].sort().join(","), [...directions].sort().join(",")];
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
          if (s.ownerId === ownerId && petIds.includes(s.petId) && directions.includes(s.direction)) {
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
          .in("status", ["received", "approved"])
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
    }) => hubApi<HubQuote>({ method: "POST", body: JSON.stringify({ op: "quote", ...input }) }),
  });
}

export function useTransportHubSync() {
  return useMutation({
    mutationFn: () => hubApi<HubSyncResult>({ method: "POST", body: JSON.stringify({ op: "sync" }) }),
  });
}

