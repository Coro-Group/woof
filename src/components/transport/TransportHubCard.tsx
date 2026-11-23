import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTransportHubStatus, useTransportHubSync } from "@/hooks/useTransport";
import { useVoltlinesDirectorySync } from "@/hooks/useVoltlines";
import { Button } from "@/components/ui/button";
import { HubAutoSyncLine } from "@/components/transport/HubAutoSyncLine";

/** Sends Woof's requests and regulars onto Admin Essentials Desk and Master. */
export function TransportHubCard() {
  const status = useTransportHubStatus();
  const sync = useTransportHubSync();
  const directory = useVoltlinesDirectorySync();
  const enabled = !!status.data?.enabled;
  const configured = !!status.data?.configured;
  const hubOn = status.data?.hub?.enabled === true;

  const line = !configured
    ? "The Admin Essentials address is not set. Requests, the schedule and regulars stay here."
    : !enabled
      ? "The link to Admin Essentials is switched off. Desk and Master stay with the dispatch team."
      : hubOn
        ? "Connected. Every accepted change goes onto Desk and Master within seconds; Sync re-sends the next 8 weeks. Dispatch plans the vans there."
        : `Admin Essentials is not accepting partners yet${status.data?.hub?.error ? `: ${status.data.hub.error}` : "."}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2" data-testid="transport-hub-card">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm text-muted-foreground">{status.isLoading ? "Checking the transport hub…" : line}</p>
        {enabled && configured && hubOn && <HubAutoSyncLine />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
                const back = [
                  `${res.linked ?? 0} linked`,
                  `${res.pinned ?? 0} pinned`,
                  ...(res.mismatched ? [`${res.mismatched} id mismatch${res.mismatched === 1 ? "" : "es"}`] : []),
                ].join(", ");
                toast.success(
                  `Sent ${res.sent.dogs} dogs, ${res.sent.regulars} regulars, ${res.sent.dated} dated runs · ${back}${skipped ? `. ${skipped} not sent` : ""}`,
                );
              },
              onError: (err) => toast.error(err.message),
            })
          }
        >
          {sync.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Sync to Desk and Master
        </Button>
        {/* Woof's own copy of the Voltlines passenger list. It is what lets a client with
            no pin borrow the one Voltlines already holds for their dog, and it is read
            only — the account belongs to MSH dispatch, so an admin presses this, never a cron. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={directory.isPending}
          data-testid="transport-voltlines-directory-sync"
          onClick={() =>
            directory.mutate(
              {
                onPage: (saved, total) =>
                  toast.loading(`Read ${saved}${total ? ` of ${total}` : ""} passengers…`, { id: "voltlines-directory" }),
              },
              {
                onSuccess: (res) =>
                  toast.success(`Voltlines directory updated — ${res.saved} passengers`, { id: "voltlines-directory" }),
                onError: (err) => toast.error(err.message, { id: "voltlines-directory" }),
              },
            )
          }
        >
          {directory.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Read Voltlines directory
        </Button>
      </div>
    </div>
  );
}
