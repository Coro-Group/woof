import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, MapPin, Printer, StickyNote } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { useDayNotes, useTransportDay, type BoardStop } from "@/hooks/useTransport";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { safeFormatDate } from "@/lib/safeDates";
import { dubaiToday, groupBySlot, liveStops, shiftIsoDate, type SlotGroup } from "@/lib/transportSchedule";
import { ClientScheduleSearch } from "@/components/transport/ClientScheduleSearch";
import { SchedulePrintSheet } from "@/components/transport/SchedulePrintSheet";
import { StatTile } from "@/components/transport/StatTile";
import { TONE, TRANSFER_BADGE } from "@/components/transport/status";
import {
  BranchBadge,
  BranchFilterToggle,
  DayNoteButton,
  readableDates,
  stopHasPin,
  useTransferLabel,
  vetLine,
  type BranchFilter,
} from "@/components/transport/transportShared";
import { VaccineStatusBadge } from "@/components/VaccineStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Daily schedule, laid out as AE's ScheduleLoadTab / ScheduleDayView: one client's days
 * up top, then the chosen date — four tiles, and Pickup / Dropoff side by side, grouped
 * by hour slot ("07-08AM · 3 stops"). Runs that are off stay, crossed out with why.
 */
export function ScheduleTab() {
  const { branchId: homeBranchId, branchLocked, branches } = useBranch();
  const today = dubaiToday();
  const [date, setDate] = useState(today);
  const [branch, setBranch] = useState<BranchFilter>("all");
  // Null asks for every branch, which only someone free to see them all may do.
  const scope = branchLocked ? homeBranchId : branch === "all" ? null : branch;
  const { data: all = [], isLoading, error } = useTransportDay(date, scope);
  const { data: dayNotes = new Map() } = useDayNotes(date);
  const branchLabel = (id: string) => branches.find((b) => b.id === id)?.short_name ?? null;
  const scopeLabel = scope ? `${branchLabel(scope)} only` : "All branches";

  const { pickup, dropoff, stops, additions, boardingPaused, cancellations } = useMemo(() => {
    const live = liveStops(all);
    return {
      pickup: groupBySlot(all.filter((s) => s.direction === "pickup")),
      dropoff: groupBySlot(all.filter((s) => s.direction === "dropoff")),
      stops: live.length,
      additions: live.filter((s) => s.source === "request").length,
      boardingPaused: all.filter((s) => s.struck === "Boarding").length,
      cancellations: all.filter((s) => s.struck === "Cancelled").length,
    };
  }, [all]);

  const noteFor = (s: BoardStop) => (s.owner ? dayNotes.get(`${s.owner.id}|${s.direction}`)?.note ?? null : null);

  return (
    <div className="space-y-8">
      <div className="print:hidden">
        <ClientScheduleSearch />
      </div>
      <div className="space-y-6 print:hidden">
        <div>
          <h2 className="text-base font-medium">Daily schedule</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Who is travelling on the selected day — regulars plus accepted additions, minus cancellations and boarding
            pauses.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate(shiftIsoDate(date, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="font-medium w-44 text-center tabular-nums" data-testid="transport-schedule-date">
              {safeFormatDate(date, "EEE d MMM yyyy")}
              {date === today && <span className="block text-[10px] font-normal text-primary">today</span>}
            </p>
            <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDate(shiftIsoDate(date, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={date === today} onClick={() => setDate(today)}>
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={() => window.print()}
              data-testid="transport-schedule-print"
            >
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <div className="ml-auto">
              <BranchFilterToggle value={branch} onChange={setBranch} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="transport-schedule-counts">
            <StatTile label="Stops that day" value={stops} hint="recurring plus approved changes" />
            <StatTile
              label="Additions"
              value={additions}
              tone={additions > 0 ? "warn" : undefined}
              hint="extra trips accepted for this date"
            />
            <StatTile
              label="Boarding pauses"
              value={boardingPaused}
              tone={boardingPaused > 0 ? "warn" : "good"}
              hint="regular directions not needed during a boarding stay"
            />
            <StatTile
              label="Cancellations"
              value={cancellations}
              tone={cancellations > 0 ? "critical" : "good"}
              hint="regulars not travelling this date"
            />
          </div>

          {error ? (
            <p className="text-sm text-red-700">Couldn't load the schedule: {(error as Error).message}</p>
          ) : isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <div className="grid gap-6 lg:grid-cols-2" data-testid="transport-schedule">
              <DirectionColumn title="Pickup" groups={pickup} date={date} showBranch={!scope} noteFor={noteFor} />
              <DirectionColumn title="Dropoff" groups={dropoff} date={date} showBranch={!scope} noteFor={noteFor} />
            </div>
          )}
        </div>
      </div>

      <SchedulePrintSheet
        date={date}
        scopeLabel={scopeLabel}
        pickups={pickup}
        dropoffs={dropoff}
        branchLabel={branchLabel}
        dayNotes={dayNotes}
      />
    </div>
  );
}

function DirectionColumn({
  title,
  groups,
  date,
  showBranch,
  noteFor,
}: {
  title: string;
  groups: SlotGroup<BoardStop>[];
  date: string;
  showBranch: boolean;
  noteFor: (s: BoardStop) => string | null;
}) {
  return (
    <div className="space-y-4">
      <p className="font-medium">{title}</p>
      {!groups.length && <p className="text-sm text-muted-foreground">Nothing scheduled.</p>}
      {groups.map((g) => {
        const live = g.stops.filter((s) => !s.struck).length;
        const untimed = g.startMin == null;
        return (
          <div key={g.key} className={`rounded-md border ${untimed ? TONE.warn.border : ""}`} data-testid="transport-schedule-slot">
            <p className={`px-3 py-2 text-sm font-medium border-b bg-muted/50 ${untimed ? TONE.warn.text : ""}`}>
              {g.label} · {live} stop{live === 1 ? "" : "s"}
            </p>
            <div className="divide-y">
              {g.stops.map((s) => (
                <StopRow key={s.key} stop={s} date={date} showBranch={showBranch} dayNote={noteFor(s)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What a struck run says, as AE's schedule badges. */
function struckLabel(struck: string): string {
  if (struck === "Cancelled") return "Cancelled on this day only";
  if (struck.startsWith("Moved")) return readableDates(struck);
  return struck;
}

function StopRow({
  stop,
  date,
  showBranch,
  dayNote,
}: {
  stop: BoardStop;
  date: string;
  showBranch: boolean;
  dayNote: string | null;
}) {
  const owner = stop.owner;
  const transfer = useTransferLabel(stop.transferFromBranchId, stop.transferToBranchId);
  const vet = vetLine(stop);
  const struck = stop.struck ? "line-through text-muted-foreground" : "";
  const name = (
    <>
      {stop.pet?.name ?? "—"}
      <span className="text-muted-foreground"> · {owner ? ownerDisplayName(owner.first_name, owner.last_name) : ""}</span>
    </>
  );
  const transportNote = owner?.transport_notes?.trim() || null;
  return (
    <div className="px-3 py-1.5 text-sm" data-testid="transport-stop-card">
      <div className="flex flex-wrap items-center gap-2">
        {owner ? (
          <Link
            to={stop.pet ? `/customers/${owner.id}/pets/${stop.petId}` : `/customers/${owner.id}`}
            className={`capitalize truncate hover:underline focus-visible:underline ${struck}`}
            title={`Open ${stop.pet?.name ?? "this dog"}'s profile`}
          >
            {name}
          </Link>
        ) : (
          <span className={`capitalize truncate ${struck}`}>{name}</span>
        )}
        <VaccineStatusBadge petId={stop.petId} variant="dot" />
        {showBranch && <BranchBadge branchId={stop.branchId} />}
        {stop.badge === "one_off" && (
          <Badge variant="outline" className={`shrink-0 ${TONE.warn.badge}`}>
            one-off
          </Badge>
        )}
        {stop.badge === "moved_in" && (
          <Badge variant="outline" className={`shrink-0 ${TONE.warn.badge}`}>
            moved in
          </Badge>
        )}
        {transfer && (
          <Badge variant="outline" className={`shrink-0 ${TRANSFER_BADGE}`} data-testid="transport-stop-transfer">
            Branch move · {transfer}
          </Badge>
        )}
        {vet && (
          <Badge variant="outline" className={`shrink-0 ${TONE.critical.badge}`}>
            VET · {vet}
          </Badge>
        )}
        {stop.struck && (
          <Badge
            variant="outline"
            className={`shrink-0 ${stop.struck === "Boarding" || stop.struck === "Paused" ? TONE.warn.badge : TONE.critical.badge}`}
            data-testid="transport-stop-struck"
          >
            {struckLabel(stop.struck)}
          </Badge>
        )}
        {stop.locationText && (
          <Badge
            variant="outline"
            className={`shrink-0 max-w-[16rem] truncate ${TONE.warn.badge}`}
            title={stop.locationText}
          >
            <MapPin className="h-3 w-3 mr-0.5 shrink-0" />
            {stop.locationText}
          </Badge>
        )}
        {!stopHasPin(stop) && (
          <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${TONE.critical.text}`} aria-label="no usable pin">
            <title>No home pin</title>
          </AlertTriangle>
        )}
        {!stop.struck && owner && (
          <DayNoteButton date={date} direction={stop.direction} ownerId={owner.id} note={dayNote} />
        )}
      </div>
      {!stop.struck && (transportNote || dayNote?.trim() || stop.note?.trim()) && (
        <div className="mt-0.5 text-xs space-y-0.5">
          {transportNote && (
            <p className="font-medium whitespace-pre-wrap">
              <StickyNote className="h-3 w-3 mr-1 inline-block -mt-0.5" aria-label="Customer transport note" />
              {transportNote}
            </p>
          )}
          {dayNote?.trim() && (
            <p className="whitespace-pre-wrap" data-testid="transport-stop-day-note">
              {dayNote.trim()}
            </p>
          )}
          {stop.note?.trim() && <p className="text-muted-foreground whitespace-pre-wrap">{stop.note.trim()}</p>}
        </div>
      )}
    </div>
  );
}
