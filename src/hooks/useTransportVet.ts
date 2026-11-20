import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { vetClinicsQueryKey } from "@/hooks/useVetClinics";
import {
  legNote,
  legsForVisit,
  normaliseVisit,
  visitColumns,
  type VetVisitInput,
} from "@/lib/transportVetVisit";

export type VetVisitRow = Database["public"]["Tables"]["transport_vet_visit"]["Row"];
export type TransportVetClinic = {
  id: string;
  name: string;
  phone: string | null;
  address_label: string | null;
  lat: number | null;
  lng: number | null;
};

export type VetVisitWithDetails = VetVisitRow & {
  owners: { id: string; first_name: string; last_name: string | null; phone: string | null; pin_lat: number | null; pin_lng: number | null } | null;
  petNames: string[];
};

/** Saved clinics with their pins (AE transport_vet_place = Petzania vet_clinics). */
export function useTransportVetClinics() {
  return useQuery({
    queryKey: [...vetClinicsQueryKey, "transport"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vet_clinics")
        .select("id, name, phone, address_label, lat, lng")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as TransportVetClinic[];
    },
  });
}

/** Save a clinic (or give an existing one its pin) for next time. */
export function useSaveVetClinic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: { name: string; address_label: string | null; lat: number; lng: number; maps_link?: string | null }) => {
      const name = c.name.trim();
      const { data: existing } = await supabase.from("vet_clinics").select("id").ilike("name", name).maybeSingle();
      const patch = { address_label: c.address_label, lat: c.lat, lng: c.lng, maps_link: c.maps_link ?? null, location_source: "maps_pin" };
      if (existing) {
        const { error } = await supabase.from("vet_clinics").update(patch).eq("id", existing.id);
        if (error) throw error;
        return existing.id as string;
      }
      const { data, error } = await supabase.from("vet_clinics").insert({ name, ...patch, is_active: true }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: vetClinicsQueryKey }),
  });
}

/**
 * Visits still open: upcoming, owed a return, or the pet is still away. Filtering to
 * what the Desk lists happens in the panel (it needs the visit rules).
 */
export function useOpenVetVisits() {
  return useQuery({
    queryKey: ["transport", "vet-visits", "open"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_vet_visit")
        .select("*, owners(id, first_name, last_name, phone, pin_lat, pin_lng)")
        .in("status", ["planned", "at_vet"])
        .order("appointment_date")
        .order("appointment_time_min");
      if (error) throw error;
      const rows = (data ?? []) as unknown as (VetVisitRow & { owners: VetVisitWithDetails["owners"] })[];
      const petIds = [...new Set(rows.flatMap((r) => r.pet_ids))];
      const names = new Map<string, string>();
      if (petIds.length) {
        const { data: pets, error: petError } = await supabase.from("pets").select("id, name").in("id", petIds);
        if (petError) throw petError;
        for (const p of pets ?? []) names.set(p.id, p.name);
      }
      return rows.map((r) => ({ ...r, petNames: r.pet_ids.map((id) => names.get(id) ?? "Pet") })) as VetVisitWithDetails[];
    },
  });
}

export type VetVisitSave = {
  id?: string | null;
  branchId: string;
  ownerId: string;
  petIds: string[];
  clinic: { id: string | null; label: string; lat: number; lng: number };
  home: { lat: number | null; lng: number | null; label: string | null };
  notes: string | null;
  input: VetVisitInput;
  actor: string;
};

/**
 * Book a visit or change its return: the rules (validation, which legs) run here with
 * AE's logic, and transport_vet_visit_write stores the visit and its legs atomically.
 */
export function useWriteVetVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: VetVisitSave) => {
      if (s.petIds.length === 0) throw new Error("Pick at least one pet");
      const v = normaliseVisit(s.input);
      const { legs, pending } = legsForVisit(v);
      const meta = { vetLabel: s.clinic.label, appointmentTimeMin: v.appointmentTimeMin, visitMode: v.visitMode, notes: s.notes };
      const legRows = legs.map((l) => ({
        role: l.role,
        direction: l.direction,
        service_date: l.service_date,
        deadline_min: l.deadline_min,
        window_start_min: l.window_start_min,
        window_end_min: l.window_end_min,
        // Clinic legs carry the clinic; the drop-off home goes to the household pin.
        location_text: l.atClinic ? s.clinic.label : s.home.label,
        location_lat: l.atClinic ? s.clinic.lat : s.home.lat,
        location_lng: l.atClinic ? s.clinic.lng : s.home.lng,
        notes: legNote(meta, l),
      }));
      const visit = {
        id: s.id ?? null,
        branch_id: s.branchId,
        owner_id: s.ownerId,
        pet_ids: s.petIds,
        vet_clinic_id: s.clinic.id,
        vet_label: s.clinic.label,
        vet_lat: s.clinic.lat,
        vet_lng: s.clinic.lng,
        notes: s.notes,
        ...visitColumns(v),
      };
      const { data, error } = await supabase.rpc("transport_vet_visit_write", {
        p_visit: visit,
        p_legs: legRows,
        p_actor: s.actor,
      });
      if (error) throw error;
      return { id: data as string, pending };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["transport"] }),
  });
}

export function useSetVetVisitStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, actor }: { id: string; status: "planned" | "at_vet" | "returned" | "cancelled"; actor: string }) => {
      const { error } = await supabase.rpc("transport_vet_visit_set_status", { p_id: id, p_status: status, p_actor: actor });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["transport"] }),
  });
}
