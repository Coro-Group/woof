import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useBranch } from "@/contexts/BranchContext";
import { useTransportBoard, useTransportDay, useTransportRequestRows, type BoardStop } from "@/hooks/useTransport";
import { cardNeedsTime, groupRequests } from "@/lib/transportRequests";
import { safeFormatDate } from "@/lib/safeDates";
import { dubaiToday, liveStops } from "@/lib/transportSchedule";
import { cn } from "@/lib/utils";
import { SharedBoardNotice } from "@/components/transport/transportShared";
import { VetVisitsPanel } from "@/components/transport/VetVisitsPanel";
import { DirectionBadge, StopCard, stopHasPin } from "@/components/transport/transportShared";
import { Skeleton } from "@/components/ui/skeleton";

// Yesterday to the day after tomorrow, opening on today (as in AE's DeskTab).
const DAY_OFFSETS = [-1, 0, 1, 2];

type Issue = { stop: BoardStop; reasons: string[] };

/** What stops a van reaching this dog: no pin, no time, or a request nobody confirmed. */
export function stopIssues(stop: BoardStop): string[] {
  const reasons: string[] = [];
  if (!stopHasPin(stop)) reasons.push("No home pin");
  if (!stop.time) reasons.push("No time set");
  if (stop.source === "request" && (stop.status === "received" || stop.status === "offered")) reasons.push("Request not approved");
  return reasons;
}

function DayTile({ date, active, onClick }: { date: string; active: boolean; onClick: () => void }) {
  const { data: stops = [], isLoading } = useTransportBoard(date);
  const issues = stops.filter((s) => stopIssues(s).length > 0).length;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`transport-desk-day-${date}`}
      className={cn(
        "rounded-md border p-3 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <p className="text-xs text-muted-foreground">
        {date === dubaiToday() ? "Today" : safeFormatDate(date, "EEE")} · {safeFormatDate(date, "d MMM")}
      </p>
      {isLoading ? (
        <Skeleton className="mt-1 h-5 w-20" />
      ) : (
        <>
          <p className="text-lg font-semibold">{stops.length} runs</p>
          <p className={cn("text-xs", issues ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>
            {issues ? `${issues} need attention` : "All set"}
          </p>
        </>
      )}
    </button>
  );
}

function Tile({
  label,
  value,
  hint,
  tone = "neutral",
  to,
  testId,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "neutral" | "warn" | "critical" | "info";
  to?: string;
  testId: string;
}) {
  const toneClass = {
    neutral: "",
    warn: value ? "border-amber-300 dark:border-amber-700" : "",
    critical: value ? "border-red-300 dark:border-red-700" : "",
    info: value ? "border-sky-300 dark:border-sky-700" : "",
  }[tone];
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </>
  );
  return to && value ? (
    <Link to={to} className={cn("rounded-md border p-3 hover:bg-muted/50", toneClass)} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={cn("rounded-md border p-3", toneClass)} data-testid={testId}>
      {body}
    </div>
  );
}

/**
 * The day in numbers (AE's DaySummary, without the GPS/Voltlines tiles): what runs,
 * what is still unanswered or untimed (linking to the requests that fix it), who is
 * boarding instead, and who is going to the vet.
 */
function DaySummary({ date }: { date: string }) {
  const { data: all = [] } = useTransportDay(date, null);
  const { data: open = [] } = useTransportRequestRows("open");
  const { data: approved = [] } = useTransportRequestRows("approved", { from: date });
  const live = liveStops(all);
  const openAsks = groupRequests(open.filter((r) => r.service_date === date || r.from_date === date)).length;
  const noTime = groupRequests(approved.filter((r) => r.service_date === date)).filter(cardNeedsTime).length;
  const boardingPaused = all.filter((s) => s.struck === "Boarding").length;
  const boardingRuns = live.filter((s) => s.source === "boarding").length;
  const vet = live.filter((s) => s.purpose === "vet").length;
  const off = all.length - live.length;
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" data-testid="transport-desk-summary">
      <Tile label="Runs" value={live.length} hint={`${live.filter((s) => s.direction === "pickup").length} PU · ${live.filter((s) => s.direction === "dropoff").length} DO`} testId="transport-desk-tile-runs" />
      <Tile label="Open asks" value={openAsks} hint="Requests for this day still to answer" tone="warn" to="/transport?tab=requests" testId="transport-desk-tile-open" />
      <Tile label="No time set" value={noTime} hint="Approved, no slot yet" tone="warn" to={`/transport?tab=requests&view=approved&needsTime=1&date=${date}`} testId="transport-desk-tile-notime" />
      <Tile label="Boarding" value={boardingRuns + boardingPaused} hint={`${boardingRuns} check-in/out runs · ${boardingPaused} regulars paused`} testId="transport-desk-tile-boarding" />
      <Tile label="Vet trips" value={vet} tone="info" testId="transport-desk-tile-vet" />
      <Tile label="Off today" value={off} hint="Cancelled, moved, paused, at the vet" testId="transport-desk-tile-off" />
    </div>
  );
}

/** Desk: the shared day check — four days at a glance and what needs fixing. Read-only. */
export function DeskTab() {
  const { branches } = useBranch();
  const [date, setDate] = useState(dubaiToday());
  const { data: stops = [], isLoading, error } = useTransportBoard(date);
  const branchLabel = (id: string) => branches.find((b) => b.id === id)?.short_name ?? null;

  const issues: Issue[] = useMemo(
    () => stops.map((stop) => ({ stop, reasons: stopIssues(stop) })).filter((i) => i.reasons.length > 0),
    [stops],
  );

  return (
    <div className="space-y-4">
      <SharedBoardNotice />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {DAY_OFFSETS.map((o) => {
          const d = dubaiToday(o);
          return <DayTile key={d} date={d} active={d === date} onClick={() => setDate(d)} />;
        })}
      </div>

      <DaySummary date={date} />
      <VetVisitsPanel />

      {error ? (
        <p className="text-sm text-red-700">Couldn't load the desk: {(error as Error).message}</p>
      ) : isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <section className="space-y-2" data-testid="transport-desk-attention">
          <h3 className="font-semibold">Needs attention · {safeFormatDate(date, "EEEE d MMM")}</h3>
          {issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {stops.length === 0 ? "No runs this day." : "Every run has a pin and a time."}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {issues.map(({ stop, reasons }) => (
                <div key={stop.key} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <DirectionBadge direction={stop.direction} />
                    {reasons.map((r) => (
                      <span key={r} className="text-xs text-red-700 dark:text-red-400">
                        {r}
                      </span>
                    ))}
                  </div>
                  <StopCard stop={stop} branchLabel={branchLabel(stop.branchId)} compact />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
