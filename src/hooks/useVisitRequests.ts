import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// visit_requests is newer than the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type VisitRequestStatus = "new" | "contacted" | "booked" | "closed";
export type VisitRequestInterest = "daycare" | "boarding" | "training" | "grooming" | "transport";

export interface VisitRequest {
  id: string;
  contact_name: string;
  phone: string;
  pet_name: string | null;
  interest: VisitRequestInterest | null;
  client_note: string | null;
  source: string;
  status: VisitRequestStatus;
  staff_note: string | null;
  handled_by: string | null;
  contacted_at: string | null;
  created_at: string;
}

export const VISIT_STATUS_LABEL: Record<VisitRequestStatus, string> = {
  new: "New",
  contacted: "Contacted",
  booked: "Trial booked",
  closed: "Closed",
};

export const VISIT_INTEREST_LABEL: Record<VisitRequestInterest, string> = {
  daycare: "Daycare",
  boarding: "Boarding",
  training: "Training",
  grooming: "Grooming",
  transport: "Transport",
};

export function useVisitRequests() {
  return useQuery({
    queryKey: ["visit-requests"],
    queryFn: async (): Promise<VisitRequest[]> => {
      const { data, error } = await db
        .from("visit_requests")
        .select("id, contact_name, phone, pet_name, interest, client_note, source, status, staff_note, handled_by, contacted_at, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as VisitRequest[];
    },
    refetchInterval: 30_000,
  });
}

export function useUpdateVisitRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; status?: VisitRequestStatus; staff_note?: string | null; handled_by?: string | null }) => {
      const { id, ...patch } = args;
      const { error } = await db.from("visit_requests").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["visit-requests"] }),
  });
}

