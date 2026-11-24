import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, parse, parseISO } from "date-fns";
import { Pencil, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { GroomingConflictOverrideDialog } from "@/components/grooming/GroomingConflictOverrideDialog";
import { ownerDisplayName } from "@/lib/bookingUtils";
import type { GroomingScheduleConflict } from "@/lib/groomingScheduleUtils";
import { labelForGroomingService } from "@/lib/groomingCatalog";
import { parseGroomingMeta } from "@/lib/groomingAppointmentMeta";
import {
  activeLinkedStayLabel,
  clockMinutes,
  formatHourTick,
  formatMinutes12,
  formatMustFinishBy,
  formatTimeRange,
  groomingBoardPaymentBadgeClass,
  groomingBoardPaymentLabel,
  groomingCardGroomerLabel,
  groomingStatusBadgeClass,
  invoiceCoveredByPackage,
  isGroomingDueSoon,
  nextFreeSlotMinutes,
  petSizeLabel,
  shortOwnerName,
  stationAccentClass,
} from "@/lib/groomingBoardUi";
import { workflowStatusLabel } from "@/lib/groomingWorkflow";
import {
  GroomingScheduleNeedsOverrideError,
  useGroomingDay,
  useGroomDefaultMinutes,
  useScheduleGroomingAppt,
  useUpdateGroomingMustFinishBy,
  type GroomingBacklogRow,
  type GroomingPinnedAppt,
  type ScheduleGroomingApptInput,
} from "@/hooks/useGroomingCapacity";
import { GroomingGroomerSelect } from "@/components/grooming/GroomingGroomerSelect";
import { useGroomingGroomers, type GroomingGroomerRow } from "@/hooks/useGroomingGroomers";
import { useStationGroomersForDate } from "@/hooks/useGroomingStationGroomerSchedule";
import { useStaff } from "@/hooks/useStaff";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 19 * 60;
const PX_PER_MINUTE = 4;
const TIMELINE_HEIGHT_PX = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MINUTE;
const DRAG_MIME = "application/x-woof-grooming-appt";

type Props = {
  date?: string;
  onDateChange?: (date: string) => void;
  staffLabel?: string;
  onAppointmentClick?: (apptId: string) => void;
  onEmptySlotClick?: (stationId: string, timeHHMM: string) => void;
};

function timeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const slice = t.length >= 8 ? t.slice(0, 8) : `${t}:00`.slice(0, 8);
  try {
    const d = parse(slice, "HH:mm:ss", new Date(2000, 0, 1));
    return d.getHours() * 60 + d.getMinutes();
  } catch {
    return null;
  }
}

function minutesToTimeString(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function minutesToHHMM(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function snapMinutes(min: number): number {
  const snapped = Math.round(min / 15) * 15;
  return Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - 15, snapped));
}

function minutesFromTimelineY(clientY: number, rect: DOMRect): number {
  const pct = (clientY - rect.top) / rect.height;
  const raw = DAY_START_MIN + pct * (DAY_END_MIN - DAY_START_MIN);
  return snapMinutes(raw);
}

function blockStyle(startMin: number, durationMin: number) {
  const top = ((startMin - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN)) * 100;
  const height = (durationMin / (DAY_END_MIN - DAY_START_MIN)) * 100;
  return { top: `${Math.max(0, top)}%`, height: `${Math.max(3, Math.min(100, height))}%` };
}

function userVisitNotesFromStored(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return null;
  const metaPrefixes = ["services:", "grooming date:", "discount:", "estimated pickup:"];
  const text = notes
    .split("\n")
    .filter((l) => !metaPrefixes.some((p) => l.toLowerCase().trimStart().startsWith(p)))
    .join("\n")
    .trim();
  return text || null;
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm");
  } catch {
    return "";
  }
}

function fromDatetimeLocalValue(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toScheduleInput(
  date: string,
  fields: ScheduleGroomingApptInput,
): ScheduleGroomingApptInput {
  return { ...fields, appointment_date: date };
}

const GRID_HALF_HOURS = Array.from(
  { length: (DAY_END_MIN - DAY_START_MIN) / 30 + 1 },
  (_, i) => DAY_START_MIN + i * 30,
);

export function GroomingDayBoard({
  date: controlledDate,
  staffLabel = "staff",
  onAppointmentClick,
  onEmptySlotClick,
}: Props) {
  const date = controlledDate ?? format(new Date(), "yyyy-MM-dd");

  const [placedSession, setPlacedSession] = useState(0);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideConflicts, setOverrideConflicts] = useState<GroomingScheduleConflict[]>([]);
  const [pendingSave, setPendingSave] = useState<ScheduleGroomingApptInput | null>(null);
  const [hiddenStations, setHiddenStations] = useState<Set<string>>(new Set());

  const { data, isLoading } = useGroomingDay(date);
  const schedule = useScheduleGroomingAppt();
  const updateMustFinishBy = useUpdateGroomingMustFinishBy();
  const { data: groomers = [] } = useGroomingGroomers();
  const { data: staffRows = [] } = useStaff();
  const { resolveStationGroomer } = useStationGroomersForDate(date);

  const visibleStations = useMemo(
    () => (data?.stations ?? []).filter((s) => !hiddenStations.has(s.station_id)),
    [data?.stations, hiddenStations],
  );

  const stationIndexById = useMemo(() => {
    const map = new Map<string, number>();
    (data?.stations ?? []).forEach((s, i) => map.set(s.station_id, i));
    return map;
  }, [data?.stations]);

  const pinnedByStation = useMemo(() => {
    const pinned = new Map<string, GroomingPinnedAppt[]>();
    for (const a of data?.pinned ?? []) {
      if (a.status === "cancelled" || a.no_show || !a.station_id || !a.appointment_time) continue;
      const list = pinned.get(a.station_id) ?? [];
      list.push(a);
      pinned.set(a.station_id, list);
    }
    return pinned;
  }, [data?.pinned]);

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of staffRows) {
      map.set(s.id, [s.first_name, s.last_name].filter(Boolean).join(" "));
    }
    return map;
  }, [staffRows]);

  const cap = data?.capacity;
  const meterPct =
    cap && cap.total_minutes > 0
      ? Math.min(100, (cap.committed_minutes / cap.total_minutes) * 100)
      : 0;
  const overBudget = cap != null && cap.committed_minutes > cap.total_minutes;

  const saveAppt = useCallback(
    async (input: ScheduleGroomingApptInput, opts?: { countPlaced?: boolean }) => {
      try {
        await schedule.mutateAsync(toScheduleInput(date, { ...input, staff: staffLabel }));
        if (opts?.countPlaced) setPlacedSession((n) => n + 1);
        toast.success("Appointment saved");
        setOverrideOpen(false);
        setPendingSave(null);
      } catch (err) {
        if (err instanceof GroomingScheduleNeedsOverrideError) {
          setPendingSave(input);
          setOverrideConflicts(
            err.warnings.map((w, i) => ({
              conflictType: "appointment_overlap" as const,
              conflictedWithId: `warn-${i}`,
              label: w.msg,
            })),
          );
          setOverrideOpen(true);
          return;
        }
        toast.error(err instanceof Error ? err.message : "Could not save");
      }
    },
    [date, schedule, staffLabel],
  );

  const placeBacklog = (
    row: GroomingBacklogRow,
    stationId: string,
    time: string,
    duration: number,
    groomerName: string | null,
  ) => {
    const resolvedGroomer =
      groomerName?.trim() || resolveStationGroomer(stationId)?.trim() || null;
    void saveAppt(
      {
        id: row.appt_id,
        pet_id: row.pet_id,
        owner_id: row.owner_id,
        service: row.service,
        appointment_date: date,
        station_id: stationId,
        appointment_time: time,
        duration_minutes: duration,
        groomer_id: null,
        grooming_notes: resolvedGroomer,
      },
      { countPlaced: true },
    );
  };

  const onLaneDrop = (e: React.DragEvent, stationId: string) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    let payload: { apptId: string; duration: number; groomerName: string | null };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return;
    }
    const row = data?.backlog.find((b) => b.appt_id === payload.apptId);
    if (!row) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const startMin = minutesFromTimelineY(e.clientY, rect);
    placeBacklog(row, stationId, minutesToTimeString(startMin), payload.duration, payload.groomerName);
  };

  const onLaneClick = (e: React.MouseEvent<HTMLDivElement>, stationId: string) => {
    if (!onEmptySlotClick) return;
    if ((e.target as HTMLElement).closest("[data-pinned-block]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const startMin = minutesFromTimelineY(e.clientY, rect);
    onEmptySlotClick(stationId, minutesToHHMM(startMin));
  };

  const toggleStation = (stationId: string, visible: boolean) => {
    setHiddenStations((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(stationId);
      else next.add(stationId);
      return next;
    });
  };

  return (
    <div className="flex w-full min-h-[calc(100vh-14rem)] flex-col gap-4" data-testid="grooming-day-board">
      <div className="flex flex-wrap items-start gap-4">
        {(data?.stations ?? []).length > 0 ? (
          <div className="flex min-w-[12rem] flex-col gap-2">
            <Label className="text-xs text-muted-foreground">Stations</Label>
            <div className="flex flex-wrap gap-2">
              {(data?.stations ?? []).map((st) => {
                const visible = !hiddenStations.has(st.station_id);
                const stationGroomer = resolveStationGroomer(st.station_id);
                return (
                  <label
                    key={st.station_id}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                  >
                    <Checkbox
                      checked={visible}
                      onCheckedChange={(c) => toggleStation(st.station_id, c === true)}
                    />
                    {st.station_name}
                    {stationGroomer ? (
                      <span className="text-muted-foreground">· {stationGroomer.split(" ")[0]}</span>
                    ) : (
                      <span className="text-amber-700">· —</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <Skeleton className="h-6 w-56" />
        ) : cap ? (
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <div
              className={cn(
                "flex flex-wrap items-center gap-2 text-xs",
                (overBudget || !cap.feasible) && "text-amber-900",
              )}
              data-testid="grooming-day-board-meter"
            >
              <span className="tabular-nums font-medium">
                {cap.committed_minutes}/{cap.total_minutes} min
              </span>
              <span className="text-muted-foreground">
                pinned {cap.pinned_minutes} · floating {cap.floating_minutes}
              </span>
              <span className="text-muted-foreground">Placed this session · {placedSession}</span>
              {(overBudget || !cap.feasible) && (
                <span className="flex items-center gap-1">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  Over daily budget
                </span>
              )}
            </div>
            <Progress
              value={meterPct}
              className="h-2"
              indicatorClassName={cn(overBudget && "bg-amber-500")}
            />
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <Skeleton className="min-h-[480px] w-full flex-1" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
          <div className="min-h-0 flex-1 overflow-auto">
            <div
              className="grid min-w-[640px]"
              style={{
                gridTemplateColumns: `4rem repeat(${visibleStations.length}, minmax(9rem, 1fr))`,
                minHeight: TIMELINE_HEIGHT_PX,
              }}
            >
              <div className="sticky top-0 z-20 border-b bg-muted/40 p-2 text-xs text-muted-foreground">
                Time
              </div>
              {visibleStations.map((st) => {
                const stationGroomer = resolveStationGroomer(st.station_id);
                return (
                <div
                  key={st.station_id}
                  className="sticky top-0 z-20 border-b border-l bg-muted/40 p-2 text-sm font-medium"
                >
                  {st.station_name}
                  <div
                    className={cn(
                      "text-xs font-normal",
                      stationGroomer ? "text-foreground" : "text-amber-700",
                    )}
                    data-testid={`grooming-station-groomer-${st.station_id}`}
                  >
                    {stationGroomer ?? "Unassigned"}
                  </div>
                  <StationHeaderSummary
                    bookings={(pinnedByStation.get(st.station_id) ?? []).length}
                    freeMinutes={st.free_minutes}
                    nextFree={nextFreeSlotMinutes(
                      (pinnedByStation.get(st.station_id) ?? []).flatMap((appt) => {
                        const startMin = clockMinutes(appt.appointment_time);
                        if (startMin == null) return [];
                        return [{ startMin, durationMin: appt.duration_minutes ?? 45 }];
                      }),
                      DAY_START_MIN,
                      DAY_END_MIN,
                    )}
                  />
                </div>
                );
              })}

              <div
                className="relative border-r bg-muted/20"
                style={{ height: TIMELINE_HEIGHT_PX }}
              >
                {GRID_HALF_HOURS.map((min) => {
                  const isHour = min % 60 === 0;
                  return (
                    <div
                      key={min}
                      className={cn(
                        "absolute left-0 right-0 border-t pl-1 text-[10px] text-muted-foreground",
                        isHour ? "border-border/60" : "border-dashed border-border/35",
                      )}
                      style={{
                        top: `${((min - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN)) * 100}%`,
                      }}
                    >
                      {isHour ? formatHourTick(min) : null}
                    </div>
                  );
                })}
              </div>

              {visibleStations.map((st) => {
                const stationIdx = stationIndexById.get(st.station_id) ?? 0;
                return (
                  <div
                    key={st.station_id}
                    className={cn(
                      "relative border-l bg-muted/5",
                      onEmptySlotClick && "cursor-pointer",
                    )}
                    style={{ height: TIMELINE_HEIGHT_PX }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onLaneDrop(e, st.station_id)}
                    onClick={(e) => onLaneClick(e, st.station_id)}
                    data-testid={`grooming-day-board-lane-${st.station_id}`}
                  >
                    {GRID_HALF_HOURS.filter((m) => m < DAY_END_MIN).map((min) => {
                      const isHour = min % 60 === 0;
                      return (
                        <div
                          key={min}
                          className={cn(
                            "pointer-events-none absolute left-0 right-0 border-t",
                            isHour ? "border-border/40" : "border-dashed border-border/25",
                          )}
                          style={{
                            top: `${((min - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN)) * 100}%`,
                          }}
                        />
                      );
                    })}

                    {(pinnedByStation.get(st.station_id) ?? []).map((a) => (
                      <PinnedAppointmentCard
                        key={a.id}
                        appt={a}
                        stationName={st.station_name}
                        stationIndex={stationIdx}
                        staffNameById={staffNameById}
                        onOpen={() => onAppointmentClick?.(a.id)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <section className="shrink-0 space-y-2">
        <h3 className="text-sm font-semibold">
          Floating backlog
          <span className="ml-2 font-normal text-muted-foreground">
            ({data?.backlog.length ?? 0} to place)
          </span>
        </h3>
        {(data?.backlog.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">No floating grooming jobs for this day.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.backlog ?? []).map((row) => (
              <FloatingBacklogCard
                key={row.appt_id}
                row={row}
                boardDate={date}
                stations={visibleStations}
                allStations={data?.stations ?? []}
                groomers={groomers}
                staffNameById={staffNameById}
                resolveStationGroomer={resolveStationGroomer}
                onPlace={placeBacklog}
                onOpen={() => onAppointmentClick?.(row.appt_id)}
                onSaveMustFinishBy={(mustFinishBy) =>
                  updateMustFinishBy.mutate(
                    { apptId: row.appt_id, appointmentDate: date, mustFinishBy },
                    {
                      onSuccess: () => toast.success("Deadline updated"),
                      onError: (e) =>
                        toast.error(e instanceof Error ? e.message : "Could not save deadline"),
                    },
                  )
                }
                isSavingDeadline={updateMustFinishBy.isPending}
              />
            ))}
          </ul>
        )}
      </section>

      <GroomingConflictOverrideDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        conflicts={overrideConflicts}
        isPending={schedule.isPending}
        onConfirm={(reason) => {
          if (!pendingSave) return;
          void saveAppt({ ...pendingSave, overrideReason: reason });
        }}
      />
    </div>
  );
}

function StationHeaderSummary({
  bookings,
  freeMinutes,
  nextFree,
}: {
  bookings: number;
  freeMinutes: number;
  nextFree: number | null;
}) {
  return (
    <div className="text-[10px] font-normal text-muted-foreground tabular-nums leading-tight">
      <div>
        {bookings} booking{bookings === 1 ? "" : "s"} · {freeMinutes} min free
      </div>
      <div>Next free {nextFree == null ? "—" : formatMinutes12(nextFree)}</div>
    </div>
  );
}

function appointmentServiceLine(appt: GroomingPinnedAppt): string {
  const primary = labelForGroomingService(appt.service);
  const extras = parseGroomingMeta(appt.notes).services.filter(
    (label) => label.toLowerCase() !== primary.toLowerCase(),
  );
  return [primary, ...extras].join(" + ");
}

function PinnedAppointmentCard({
  appt,
  stationName,
  stationIndex,
  staffNameById,
  onOpen,
}: {
  appt: GroomingPinnedAppt;
  stationName: string;
  stationIndex: number;
  staffNameById: Map<string, string>;
  onOpen: () => void;
}) {
  const start = timeToMinutes(appt.appointment_time);
  if (start == null || !appt.station_id) return null;

  const duration = appt.duration_minutes ?? 45;
  const style = blockStyle(start, duration);
  const compact = duration < 25;
  const ownerName = appt.owners
    ? ownerDisplayName(appt.owners.first_name, appt.owners.last_name)
    : "—";
  const ownerShort = shortOwnerName(appt.owners?.first_name, appt.owners?.last_name);
  const breedSize = [appt.pets?.breed, petSizeLabel(appt.pets?.size)].filter(Boolean).join(" · ");
  const serviceLine = appointmentServiceLine(appt);
  const visitNotes = userVisitNotesFromStored(appt.notes);
  const meta = parseGroomingMeta(appt.notes);
  const pickupLabel = meta.estimatedPickup?.trim() || formatMinutes12(start + duration);
  const transportLines = (appt.invoices?.invoice_line_items ?? [])
    .map((line) => line.description ?? "")
    .filter((description) => /transport|pick-?up|drop-?off/i.test(description));
  const dueSoon = isGroomingDueSoon(appt.must_finish_by);
  const accent = stationAccentClass(stationIndex);
  const coveredByPackage = invoiceCoveredByPackage(appt.invoices?.invoice_line_items);
  const paymentLabel = groomingBoardPaymentLabel({
    status: appt.status,
    payment_method: appt.payment_method,
    invoice_status: appt.invoices?.status,
    coveredByPackage,
  });
  const paymentBadgeClass = groomingBoardPaymentBadgeClass({
    status: appt.status,
    payment_method: appt.payment_method,
    invoice_status: appt.invoices?.status,
    coveredByPackage,
  });
  const linkedStay = activeLinkedStayLabel(appt.bookings, appt.appointment_date);
  const groomerLabel = groomingCardGroomerLabel({
    groomerId: appt.groomer_id,
    groomingNotes: appt.grooming_notes,
    staffNameById,
  });
  const placeLabel = [groomerLabel !== "—" ? groomerLabel : null, stationName].filter(Boolean).join(" · ");
  const invoiceTotal = appt.invoices?.total ?? appt.price;
  const timeLabel = formatTimeRange(appt.appointment_time, duration);

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-pinned-block
          data-testid={`grooming-day-card-${appt.id}`}
          className={cn(
            "absolute left-0.5 right-0.5 z-10 overflow-hidden rounded border border-border/60 bg-card px-1.5 py-0.5 text-left text-[10px] leading-tight shadow-sm hover:z-30 hover:shadow-md border-l-4",
            accent,
          )}
          style={style}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {compact ? (
            <>
              <div className="truncate font-medium">
                {formatMinutes12(start)} · {appt.pets?.name ?? "Pet"}
                {breedSize ? ` (${breedSize})` : ""} · {ownerShort} · {serviceLine}
              </div>
              <div className="flex items-center gap-1 truncate">
                <span className="truncate text-muted-foreground">{placeLabel}</span>
                <Badge variant="outline" className={cn("shrink-0 px-1 py-0 text-[8px]", groomingStatusBadgeClass(appt.status))}>
                  {workflowStatusLabel(appt.status)}
                </Badge>
                <Badge variant="outline" className={cn("shrink-0 px-1 py-0 text-[8px]", paymentBadgeClass)}>
                  {paymentLabel}
                </Badge>
              </div>
            </>
          ) : (
            <>
              <div className="truncate font-semibold tabular-nums">{timeLabel}</div>
              <div className="truncate font-medium">
                {appt.pets?.name ?? "Pet"}
                {breedSize ? <span className="font-normal text-muted-foreground"> · {breedSize}</span> : null}
              </div>
              <div className="truncate">{ownerName}</div>
              <div className="truncate">{serviceLine}</div>
              <div className="truncate text-muted-foreground">{placeLabel}</div>
              <div className="flex flex-wrap items-center gap-1">
                <Badge variant="outline" className={cn("px-1 py-0 text-[8px]", groomingStatusBadgeClass(appt.status))}>
                  {workflowStatusLabel(appt.status)}
                </Badge>
                <Badge variant="outline" className={cn("px-1 py-0 text-[8px]", paymentBadgeClass)}>
                  {paymentLabel}
                </Badge>
              </div>
            </>
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-72 space-y-2 text-sm">
        <p className="font-semibold tabular-nums">{timeLabel}</p>
        <p>
          <span className="text-muted-foreground">Pet:</span> {appt.pets?.name ?? "Pet"}
          {breedSize ? ` · ${breedSize}` : ""}
        </p>
        <p>
          <span className="text-muted-foreground">Owner:</span>{" "}
          <Link to={`/customers/${appt.owner_id}`} className="text-primary hover:underline">
            {ownerName}
          </Link>
          {appt.owners?.phone ? ` · ${appt.owners.phone}` : ""}
        </p>
        <p>
          <span className="text-muted-foreground">Service:</span> {serviceLine}
        </p>
        <p>
          <span className="text-muted-foreground">Groomer / station:</span> {placeLabel || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Pickup:</span> {pickupLabel}
        </p>
        <p>
          <span className="text-muted-foreground">Transport:</span>{" "}
          {transportLines.length > 0 ? transportLines.join("; ") : "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Invoice:</span>{" "}
          {invoiceTotal != null ? `AED ${Number(invoiceTotal).toFixed(2)}` : "—"}
        </p>
        {visitNotes ? (
          <p className="whitespace-pre-wrap text-xs">
            <span className="text-muted-foreground">Notes:</span> {visitNotes}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Notes: —</p>
        )}
        <p>
          <span className="text-muted-foreground">Payment:</span> {paymentLabel}
        </p>
        {linkedStay ? (
          <p>
            <span className="text-muted-foreground">Linked stay:</span> {linkedStay}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className={groomingStatusBadgeClass(appt.status)}>
            {workflowStatusLabel(appt.status)}
          </Badge>
          {dueSoon ? (
            <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-900">
              Due soon
            </Badge>
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function FloatingBacklogCard({
  row,
  boardDate,
  stations,
  allStations,
  groomers,
  staffNameById,
  resolveStationGroomer,
  onPlace,
  onOpen,
  onSaveMustFinishBy,
  isSavingDeadline,
}: {
  row: GroomingBacklogRow;
  boardDate: string;
  stations: { station_id: string; station_name: string }[];
  allStations: { station_id: string; station_name: string }[];
  groomers: GroomingGroomerRow[];
  staffNameById: Map<string, string>;
  resolveStationGroomer: (stationId: string) => string | null;
  onPlace: (
    row: GroomingBacklogRow,
    stationId: string,
    time: string,
    duration: number,
    groomerName: string | null,
  ) => void;
  onOpen: () => void;
  onSaveMustFinishBy: (iso: string | null) => void;
  isSavingDeadline: boolean;
}) {
  const petSize = row.pet_size ?? "medium";
  const defaultDur = useGroomDefaultMinutes(row.service, petSize);
  const pickStations = stations.length > 0 ? stations : allStations;
  const [stationId, setStationId] = useState(pickStations[0]?.station_id ?? "");
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState(row.duration_minutes);
  const [groomerName, setGroomerName] = useState(row.grooming_notes?.trim() ?? "");
  const [deadlineDraft, setDeadlineDraft] = useState(toDatetimeLocalValue(row.must_finish_by));
  const [deadlineOpen, setDeadlineOpen] = useState(false);

  useEffect(() => {
    setDeadlineDraft(toDatetimeLocalValue(row.must_finish_by));
  }, [row.must_finish_by]);

  useEffect(() => {
    if (defaultDur.data != null && row.duration_minutes === defaultDur.data) {
      setDuration(defaultDur.data);
    }
  }, [defaultDur.data, row.duration_minutes]);

  useEffect(() => {
    setDuration(row.duration_minutes);
  }, [row.duration_minutes]);

  useEffect(() => {
    setGroomerName((prev) => {
      if (prev.trim()) return prev;
      return resolveStationGroomer(stationId) ?? "";
    });
  }, [stationId, resolveStationGroomer]);

  const ownerName = ownerDisplayName(row.owner_first_name, row.owner_last_name);
  const dueSoon = isGroomingDueSoon(row.must_finish_by);
  const deadlineLabel = formatMustFinishBy(row.must_finish_by);
  const paymentLabel = groomingBoardPaymentLabel({
    status: row.status,
    payment_method: row.payment_method,
  });
  const linkedStay = activeLinkedStayLabel(
    row.booking_type && row.booking_status
      ? {
          booking_type: row.booking_type,
          status: row.booking_status,
          booking_ref: row.booking_ref,
          check_in_date: row.booking_check_in_date ?? "",
          check_out_date: row.booking_check_out_date ?? "",
        }
      : null,
    boardDate,
  );
  const groomerLabel = groomingCardGroomerLabel({
    groomerId: row.groomer_id,
    groomingNotes: row.grooming_notes,
    staffNameById,
  });

  const dragPayload = JSON.stringify({
    apptId: row.appt_id,
    duration,
    groomerName: groomerName.trim() || null,
  });

  return (
    <li
      className="rounded-lg border bg-card p-3 text-sm space-y-2 cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, dragPayload);
        e.dataTransfer.effectAllowed = "move";
      }}
      data-testid={`grooming-day-board-backlog-${row.appt_id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" className="font-medium text-left hover:underline" onClick={onOpen}>
          {row.dog_name ?? "Pet"}
        </button>
        {dueSoon ? (
          <Badge variant="outline" className="shrink-0 border-amber-400 bg-amber-50 text-amber-900 text-[10px]">
            Due soon
          </Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{ownerName}</p>
      <p className="text-xs text-muted-foreground">Groomer: {groomerLabel}</p>
      <p className="text-xs">{labelForGroomingService(row.service)} · {duration} min</p>
      <div className="flex flex-wrap gap-1">
        {paymentLabel !== "—" ? (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              groomingBoardPaymentBadgeClass({
                status: row.status,
                payment_method: row.payment_method,
              }),
            )}
          >
            {paymentLabel}
          </Badge>
        ) : null}
        {linkedStay ? (
          <Badge variant="outline" className="text-[10px] border-slate-300 bg-slate-50 text-slate-800">
            {linkedStay}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center gap-1 text-xs">
        {deadlineLabel ? (
          <span className="text-muted-foreground">By {deadlineLabel}</span>
        ) : (
          <span className="text-muted-foreground">No deadline</span>
        )}
        <Popover open={deadlineOpen} onOpenChange={setDeadlineOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label="Edit deadline">
              <Pencil className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2" align="start">
            <Label className="text-xs">Must finish by</Label>
            <Input
              type="datetime-local"
              value={deadlineDraft}
              onChange={(e) => setDeadlineDraft(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isSavingDeadline}
                onClick={() => {
                  onSaveMustFinishBy(fromDatetimeLocalValue(deadlineDraft));
                  setDeadlineOpen(false);
                }}
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isSavingDeadline}
                onClick={() => {
                  setDeadlineDraft("");
                  onSaveMustFinishBy(null);
                  setDeadlineOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {row.booking_ref && !linkedStay ? (
        <p className="text-[10px] text-muted-foreground">Stay {row.booking_ref}</p>
      ) : null}

      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <Label className="text-[10px]">Duration (min)</Label>
          <Input
            type="number"
            className="h-8 w-20"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) || defaultDur.data || 45)}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <GroomingGroomerSelect
            groomers={groomers}
            value={groomerName}
            onChange={setGroomerName}
            label="Groomer"
          />
        </div>
        <div>
          <Label className="text-[10px]">Station</Label>
          <select
            className="h-8 rounded border px-2 text-xs"
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
          >
            {pickStations.map((s) => (
              <option key={s.station_id} value={s.station_id}>
                {s.station_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[10px]">Time</Label>
          <Input
            type="time"
            className="h-8"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground tabular-nums">{formatMinutes12(clockMinutes(time) ?? 0)}</p>
        </div>
        <Button
          type="button"
          size="sm"
          data-testid="grooming-day-board-place-btn"
          disabled={!stationId}
          onClick={() => onPlace(row, stationId, `${time}:00`, duration, groomerName.trim() || null)}
        >
          Place
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">Or drag onto a station lane</p>
    </li>
  );
}
