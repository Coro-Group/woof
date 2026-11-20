import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type VoltlinesHit = {
  passengerId: string | null;
  name: string | null;
  petName: string | null;
  ownerName: string | null;
  address: string | null;
  claimedByPetId: string | null;
  claimedByPetName: string | null;
  pinUsable: boolean;
};

async function voltlinesApi<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `Voltlines did not answer (${res.status})`);
  return body;
}

export function useSearchVoltlinesPassengers() {
  return useMutation({
    mutationFn: (term: string) =>
      voltlinesApi<{ query: string; passengers: VoltlinesHit[] }>(`/api/transport-voltlines?passengers=${encodeURIComponent(term)}`),
  });
}

export function useLinkVoltlinesPassenger() {
  return useMutation({
    mutationFn: (input: { petId: string; passengerId: string }) =>
      voltlinesApi<{ message: string; passengerId: string }>("/api/transport-voltlines", {
        method: "POST",
        body: JSON.stringify({ op: "link", ...input }),
      }),
  });
}

export function useUnlinkVoltlinesPassenger() {
  return useMutation({
    mutationFn: (petId: string) =>
      voltlinesApi<{ message: string }>("/api/transport-voltlines", {
        method: "POST",
        body: JSON.stringify({ op: "unlink", petId }),
      }),
  });
}
