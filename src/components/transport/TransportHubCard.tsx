import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTransportHubStatus, useTransportHubSync } from "@/hooks/useTransport";
import { Button } from "@/components/ui/button";

/** Sends Woof's requests and regulars onto Admin Essentials Desk and Master. */
export function TransportHubCard() {
  const status = useTransportHubStatus();
  const sync = useTransportHubSync();
  const enabled = !!status.data?.enabled;
  const configured = !!status.data?.configured;
  const hubOn = status.data?.hub?.enabled === true;

  const line = !configured
    ? "The Admin Essentials address is not set. Requests, the schedule and regulars stay here."
    : !enabled
      ? "The link to Admin Essentials is switched off. Desk and Master stay with the dispatch team."
      : hubOn
        ? "Connected. Sync sends the next 8 weeks onto Desk and Master. Dispatch plans the vans there."
        : `Admin Essentials is not accepting partners yet${status.data?.hub?.error ? `: ${status.data.hub.error}` : "."}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2" data-testid="transport-hub-card">
      <p className="text-sm text-muted-foreground">{status.isLoading ? "Checking the transport hub…" : line}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!enabled || !configured || sync.isPending}
        data-testid="transport-hub-sync"
        onClick={() =>
          sync.mutate(undefined, {
            onSuccess: (res) => {
              const skipped = res.notSent.length;
              toast.success(
                `Sent ${res.sent.dogs} dogs, ${res.sent.regulars} regulars, ${res.sent.dated} dated runs${skipped ? `. ${skipped} not sent` : ""}`,
              );
            },
            onError: (err) => toast.error(err.message),
          })
        }
      >
        {sync.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Sync to Desk and Master
      </Button>
    </div>
  );
}
