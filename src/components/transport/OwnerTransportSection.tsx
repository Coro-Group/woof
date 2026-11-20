import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useOwner } from "@/hooks/useOwners";
import { useOwnerTransport } from "@/hooks/useTransport";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { WEEKDAY_LABELS, dubaiToday, pausedLabel, runSlotLabel } from "@/lib/transportSchedule";
import {
  TONE_BADGE,
  cardSummary,
  groupRequests,
  kindLabel,
  kindTone,
  shortDate,
  statusLabel,
  statusTone,
} from "@/lib/transportRequests";
import { RequestForm } from "@/components/transport/RequestForm";
import { NewRegularDialog } from "@/components/transport/RegularsTab";
import { DirectionBadge, RequestPetNames } from "@/components/transport/transportShared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VaccineStatusBadge } from "@/components/VaccineStatusBadge";

/** The household's van runs: active regulars and open or upcoming requests (this branch's only). */
export function OwnerTransportSection({ ownerId }: { ownerId: string }) {
  const today = dubaiToday();
  const { data: owner } = useOwner(ownerId);
  const { data, isLoading, error } = useOwnerTransport(ownerId, today);
  const [requestOpen, setRequestOpen] = useState(false);
  const [regularOpen, setRegularOpen] = useState(false);
  const fixedOwner = owner ? { id: owner.id, label: ownerDisplayName(owner.first_name, owner.last_name) } : null;

  const regulars = (data?.regulars ?? []).filter((r) => !r.ends_on || r.ends_on >= today);
  const cards = useMemo(() => groupRequests(data?.requests ?? []), [data?.requests]);

  return (
    <Card data-testid="owner-transport-section">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Transport runs</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRegularOpen(true)} disabled={!owner}>
            <Plus className="mr-1 h-3 w-3" /> Regular
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRequestOpen(true)} disabled={!owner}>
            <Plus className="mr-1 h-3 w-3" /> Request
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error ? (
          <p className="text-xs text-muted-foreground">Transport isn't available yet.</p>
        ) : isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : regulars.length === 0 && cards.length === 0 ? (
          <p className="text-xs text-muted-foreground">No regular runs or open requests.</p>
        ) : (
          <>
            {regulars.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Regulars</p>
                <div className="flex flex-wrap gap-2">
                  {regulars.map((r) => (
                    <div key={r.id} className="flex items-center gap-1.5 rounded border bg-muted/40 px-2 py-1 text-xs">
                      <span className="font-medium">{WEEKDAY_LABELS[r.weekday].slice(0, 3)}</span>
                      <span>{r.pets?.name}</span>
                      <VaccineStatusBadge petId={r.pet_id} variant="dot" />
                      <DirectionBadge direction={r.direction} />
                      {r.direction !== "dropoff" && <span>PU {runSlotLabel(r.pickup_time, r.pickup_window_start_min, r.pickup_window_end_min) ?? "no slot time"}</span>}
                      {r.direction !== "pickup" && <span>DO {runSlotLabel(r.dropoff_time, r.dropoff_window_start_min, r.dropoff_window_end_min) ?? "no slot time"}</span>}
                      {r.transfer_to_branch_id && <span className="text-teal-700 dark:text-teal-400">Cross-branch</span>}
                      {pausedLabel(r, today) && <span className="text-amber-700 dark:text-amber-400">{pausedLabel(r, today)}</span>}
                      {r.ends_on && <span className="text-red-700">Ends {shortDate(r.ends_on)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {cards.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Requests</p>
                {cards.map((c) => (
                  <Link
                    key={c.groupId}
                    to={`/transport?tab=requests${c.status === "approved" ? "&view=approved" : ""}&request=${c.groupId}`}
                    className="flex flex-wrap items-center gap-2 text-xs hover:underline"
                  >
                    <Badge variant="outline" className={`text-xs ${TONE_BADGE[kindTone(c.kind, c.lead.purpose)]}`}>{kindLabel(c.kind, c.lead.purpose)}</Badge>
                    <RequestPetNames rows={c.rows} />
                    <span className="text-muted-foreground">{cardSummary(c)}</span>
                    <Badge variant="outline" className={`text-xs ${TONE_BADGE[statusTone(c.status)]}`}>{statusLabel(c.status)}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
      <Sheet open={requestOpen} onOpenChange={setRequestOpen}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Request{fixedOwner ? ` · ${fixedOwner.label}` : ""}</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            {requestOpen && <RequestForm fixedOwner={fixedOwner} onSaved={() => setRequestOpen(false)} />}
          </div>
        </SheetContent>
      </Sheet>
      <NewRegularDialog open={regularOpen} onOpenChange={setRegularOpen} fixedOwner={fixedOwner} />
    </Card>
  );
}
