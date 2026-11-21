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

/**
 * Read the Voltlines passenger list into Woof's own copy, a few pages per call until
 * the server stops handing back a `next`. Reads only; nothing is written to Voltlines.
 *
 * Admin or management only (the server checks). The account is MSH dispatch's, so this
 * is always a person pressing a button — never a schedule — and `onPage` lets the
 * caller show how far it has got on a long directory.
 */
export function useVoltlinesDirectorySync() {
  return useMutation({
    mutationFn: async (opts?: { onPage?: (saved: number, total: number | null) => void }) => {
      let next: string | null = null;
      let saved = 0;
      let total: number | null = null;
      // A guard, not a limit: a directory that never stops paging is a bug, not a big list.
      for (let round = 0; round < 200; round += 1) {
        const page: { saved: number; next: string | null; total: number | null } = await voltlinesApi(
          "/api/transport-voltlines",
          { method: "POST", body: JSON.stringify({ op: "directory_sync", ...(next ? { next } : {}) }) },
        );
        saved += page.saved;
        total = page.total ?? total;
        opts?.onPage?.(saved, total);
        next = page.next;
        if (!next) break;
      }
      return { saved, total, complete: !next };
    },
  });
}
