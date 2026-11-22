import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

type AutoSyncRow = {
  generation: number;
  synced_generation: number;
  running_until: string | null;
  last_ok_at: string | null;
  last_error: string | null;
};

/**
 * The automatic sync to the transport hub (migration 20261123100000): every change
 * that moves a dog's transport is sent to Desk and Master within seconds. This line
 * says when it last got through, and whether anything is still waiting.
 */
export function HubAutoSyncLine() {
  const q = useQuery({
    queryKey: ["transport-hub-autosync"],
    refetchInterval: 15_000,
    queryFn: async () => {
      // Not in the generated types yet.
      const { data, error } = await (supabase as unknown as { from: (t: string) => any })
        .from("transport_hub_autosync")
        .select("generation, synced_generation, running_until, last_ok_at, last_error")
        .maybeSingle();
      if (error) throw error;
      return data as AutoSyncRow | null;
    },
  });
  const r = q.data;
  if (!r) return null;
  const running = !!r.running_until && new Date(r.running_until).getTime() > Date.now();
  const waiting = r.generation > r.synced_generation;
  const last = r.last_ok_at ? `last sent ${formatDistanceToNow(new Date(r.last_ok_at), { addSuffix: true })}` : "not sent yet";
  const text = running
    ? `Automatic: sending now (${last}).`
    : r.last_error && waiting
      ? `Automatic: the last try failed — ${r.last_error}. It retries every 10 minutes (${last}).`
      : waiting
        ? `Automatic: changes waiting to go (${last}).`
        : `Automatic: up to date, ${last}.`;
  return (
    <p className="text-xs text-muted-foreground" data-testid="transport-hub-autosync">
      {text}
    </p>
  );
}
