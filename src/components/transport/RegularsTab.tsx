import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Clock, Loader2, Pause, Play, Plus } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { usePets } from "@/hooks/usePets";
import {
  useChangeRegularDay,
  useCreateTransportRegulars,
  useCurrentStaffName,
  usePetRegularHistory,
  useTransportDay,
  useTransportRegulars,
  useTransportSlots,
  useUpdateTransportRegular,
  type TransportRegular,
  type TransportRegularWithDetails,
} from "@/hooks/useTransport";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { isPetDeceased } from "@/lib/petDeceased";
import { safeFormatDate } from "@/lib/safeDates";
import {
  NO_SLOT_LABEL,
  WEEKDAY_LABELS,
  dubaiToday,
  pausedLabel,
  regularPausedOn,
  runSlotLabel,
  shiftIsoDate,
  slotStartOf,
  slotTime,
  weekdayOf,
} from "@/lib/transportSchedule";
import { CapacityHeatMap, HouseholdWeekSheet } from "@/components/transport/RegularsWeekViews";
import { OwnerCombobox } from "@/components/daycare/DaycareOwnerCombobox";
import { StatTile } from "@/components/transport/StatTile";
import { TONE, TRANSFER_BADGE } from "@/components/transport/status";
import { BranchBadge, BranchFilterToggle, PinBadge, dipFirst, matchesBranch, type BranchFilter } from "@/components/transport/transportShared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VaccineStatusBadge } from "@/components/VaccineStatusBadge";

// Monday-first, the way the team reads a week (0 = Sunday, as Postgres dow).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const NONE = "none";

type Mode = "capacity" | "browse" | "edit";
type Direction = "pickup" | "dropoff";

/** A row is running on a date: begun, not ended, on that weekday. */
function inForce(r: Pick<TransportRegular, "starts_on" | "ends_on">, date: string): boolean {
  return r.starts_on <= date && (!r.ends_on || r.ends_on >= date);
}

const covers = (r: Pick<TransportRegular, "direction">, dir: Direction) => r.direction === dir || r.direction === "both";

/** The label a regular's direction shows: its flexible window, else its hour slot. */
function regularSlotLabel(r: TransportRegular, dir: Direction): string {
  return (
    (dir === "pickup"
      ? runSlotLabel(r.pickup_time, r.pickup_window_start_min, r.pickup_window_end_min)
      : runSlotLabel(r.dropoff_time, r.dropoff_window_start_min, r.dropoff_window_end_min)) ?? NO_SLOT_LABEL
  );
}

function useBranchName() {
  const { branches } = useBranch();
  return (id: string | null | undefined) => branches.find((b) => b.id === id)?.short_name ?? "?";
}

/** "BB → DIP" for a cross-branch regular's leg. */
function transferLeg(r: TransportRegular, dir: Direction, name: (id: string | null | undefined) => string): string | null {
  if (!r.transfer_to_branch_id) return null;
  return dir === "pickup" ? `${name(r.branch_id)} → ${name(r.transfer_to_branch_id)}` : `${name(r.transfer_to_branch_id)} → ${name(r.branch_id)}`;
}

/** The week's Monday for a date. */
const mondayOf = (iso: string) => shiftIsoDate(iso, -((weekdayOf(iso) + 6) % 7));

/**
 * Regulars, as AE's RegularsTab: Capacity · Browse week · Edit pattern.
 *
 * Browse week reads one real date at a time, with that day's pauses, boarding and
 * cancellations laid over the pattern. Edit pattern changes one dog's master week,
 * a weekday and direction at a time, from today, keeping the old rule as history.
 */
export function RegularsTab() {
  const today = dubaiToday();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("browse");
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [selectedDate, setSelectedDate] = useState(today);
  const [branch, setBranch] = useState<BranchFilter>("all");
  const [household, setHousehold] = useState<{ ownerId: string; name: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ ownerId: string; label: string; petId: string | null } | null>(
    () => {
      const owner = searchParams.get("owner");
      return owner ? { ownerId: owner, label: "", petId: searchParams.get("pet") } : null;
    },
  );
  const { branchId: homeBranchId, branchLocked } = useBranch();
  const scope = branchLocked ? homeBranchId : branch === "all" ? null : branch;
  const { data: regulars = [], isLoading, error } = useTransportRegulars(null);
  const { data: dayStops = [] } = useTransportDay(selectedDate, scope);
  const branchName = useBranchName();

  const weekEnd = shiftIsoDate(weekStart, 6);
  const selectedWeekday = weekdayOf(selectedDate);
  const visible = useMemo(() => regulars.filter((r) => matchesBranch(r.branch_id, branch)), [regulars, branch]);

  // Rules running this week: one per weekday and direction, as AE counts "active rules".
  const summary = useMemo(() => {
    const live = visible.filter((r) => inForce(r, today));
    return {
      activeRules: live.reduce((n, r) => n + (r.direction === "both" ? 2 : 1), 0),
      pets: new Set(live.map((r) => r.pet_id)).size,
    };
  }, [visible, today]);

  const rows = useMemo(() => {
    const byPet = new Map<
      string,
      { petId: string; ownerId: string; owner: string; pet: string; branchId: string; pickup: TransportRegularWithDetails | null; dropoff: TransportRegularWithDetails | null }
    >();
    for (const r of visible) {
      if (r.weekday !== selectedWeekday || !inForce(r, selectedDate)) continue;
      const row = byPet.get(r.pet_id) ?? {
        petId: r.pet_id,
        ownerId: r.owner_id,
        owner: r.owners ? ownerDisplayName(r.owners.first_name, r.owners.last_name) : "Unknown owner",
        pet: r.pets?.name ?? "Unknown pet",
        branchId: r.branch_id,
        pickup: null,
        dropoff: null,
      };
      if (covers(r, "pickup")) row.pickup = r;
      if (covers(r, "dropoff")) row.dropoff = r;
      byPet.set(r.pet_id, row);
    }
    return [...byPet.values()].sort(
      (a, b) =>
        a.owner.localeCompare(b.owner, undefined, { sensitivity: "base" }) ||
        a.pet.localeCompare(b.pet, undefined, { sensitivity: "base" }),
    );
  }, [visible, selectedWeekday, selectedDate]);

  // Why a regular is not running on the selected date (boarding, cancelled, at the vet…).
  const struckFor = (r: TransportRegular, dir: Direction): string | null => {
    const key = r.transfer_to_branch_id ? `${r.pet_id}|${dir}|transfer|${r.id}` : `${r.pet_id}|${dir}`;
    return dayStops.find((s) => s.key === key)?.struck ?? null;
  };

  const changeWeek = (monday: string) => {
    const index = (weekdayOf(selectedDate) + 6) % 7;
    setWeekStart(monday);
    setSelectedDate(shiftIsoDate(monday, index));
  };

  const openEdit = (ownerId: string, label: string, petId: string | null) => {
    setEditTarget({ ownerId, label, petId });
    setHousehold(null);
    setMode("edit");
  };

  return (
    <div className="space-y-6" data-testid="transport-regulars">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Regular weekly transport</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {mode === "capacity"
              ? "Where the recurring week is strained before you promise another regular."
              : mode === "browse"
                ? "One weekday at a time, including cancellations and boarding pauses. The master pattern is unchanged."
                : "Edit the master weekly pattern for one pet. Temporary pauses do not live here."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BranchFilterToggle value={branch} onChange={setBranch} />
          <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as Mode)}>
            <ToggleGroupItem value="capacity" data-testid="transport-regulars-mode-capacity">
              Capacity
            </ToggleGroupItem>
            <ToggleGroupItem value="browse" data-testid="transport-regulars-mode-browse">
              Browse week
            </ToggleGroupItem>
            <ToggleGroupItem value="edit" data-testid="transport-regulars-mode-edit">
              Edit pattern
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {(mode === "capacity" || mode === "browse") && <WeekNavigator weekStart={weekStart} weekEnd={weekEnd} onChange={changeWeek} />}

      {mode === "capacity" && <CapacityHeatMap regulars={regulars} branch={branch} />}

      {mode === "browse" && (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Weekday">
            {WEEK_ORDER.map((weekday, index) => {
              const date = shiftIsoDate(weekStart, index);
              const active = date === selectedDate;
              return (
                <button
                  key={weekday}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedDate(date)}
                  className={`rounded-md border px-3 py-1.5 text-xs transition ${
                    active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                  }`}
                >
                  <span className="block font-medium">{WEEKDAY_LABELS[weekday].slice(0, 3)}</span>
                  <span className={`block tabular-nums ${active ? "opacity-90" : "text-muted-foreground"}`}>
                    {safeFormatDate(date, "d MMM")}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 max-w-md">
            <StatTile label="Active rules" value={summary.activeRules} hint="recurring directions a week" />
            <StatTile label="Pets with a pattern" value={summary.pets} hint="click any row for the owner’s full household" />
          </div>

          {error ? (
            <p className="text-sm text-red-700">Couldn't load regulars: {(error as Error).message}</p>
          ) : isLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <section className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="font-medium">{WEEKDAY_LABELS[selectedWeekday]}</h3>
                <span className="text-xs text-muted-foreground">
                  {safeFormatDate(selectedDate, "d MMM")} · {rows.length} pet{rows.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm" data-testid="transport-regulars-table">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="p-2 text-left font-medium">Owner · pet</th>
                      <th className="p-2 text-left font-medium">Pickup</th>
                      <th className="p-2 text-left font-medium">Dropoff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row) => (
                      <tr key={row.petId} className="hover:bg-muted/40" data-testid="transport-regulars-row">
                        <td className="p-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              className="text-left capitalize hover:underline focus-visible:underline"
                              onClick={() => setHousehold({ ownerId: row.ownerId, name: row.owner })}
                            >
                              <span className="font-medium">{row.owner}</span>
                              <span className="text-muted-foreground"> · {row.pet}</span>
                            </button>
                            <VaccineStatusBadge petId={row.petId} variant="dot" />
                            {branch === "all" && <BranchBadge branchId={row.branchId} />}
                          </div>
                        </td>
                        {(["pickup", "dropoff"] as const).map((dir) => {
                          const r = row[dir];
                          return (
                            <td key={dir} className="p-2">
                              <DirectionCell
                                regular={r}
                                direction={dir}
                                date={selectedDate}
                                struck={r ? struckFor(r, dir) : null}
                                transfer={r ? transferLeg(r, dir, branchName) : null}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr>
                        <td colSpan={3} className="p-3 text-muted-foreground" data-testid="transport-regulars-empty">
                          No regular transport.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {mode === "edit" && <EditPattern target={editTarget} onTarget={setEditTarget} />}

      <HouseholdWeekSheet
        open={!!household}
        onOpenChange={(o) => !o && setHousehold(null)}
        ownerName={household?.name ?? ""}
        rows={household ? regulars.filter((r) => r.owner_id === household.ownerId && (!r.ends_on || r.ends_on >= today)) : []}
        onEditPet={(petId) => household && openEdit(household.ownerId, household.name, petId)}
      />
    </div>
  );
}

function WeekNavigator({ weekStart, weekEnd, onChange }: { weekStart: string; weekEnd: string; onChange: (monday: string) => void }) {
  const thisWeek = mondayOf(dubaiToday());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => onChange(shiftIsoDate(weekStart, -7))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <p className="w-52 text-center text-sm font-medium tabular-nums">
        {safeFormatDate(weekStart, "d MMM")} – {safeFormatDate(weekEnd, "d MMM yyyy")}
      </p>
      <Button variant="outline" size="icon" aria-label="Next week" onClick={() => onChange(shiftIsoDate(weekStart, 7))}>
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" disabled={weekStart === thisWeek} onClick={() => onChange(thisWeek)}>
        This week
      </Button>
    </div>
  );
}

function DirectionCell({
  regular,
  direction,
  date,
  struck,
  transfer,
}: {
  regular: TransportRegular | null;
  direction: Direction;
  date: string;
  struck: string | null;
  transfer: string | null;
}) {
  const update = useUpdateTransportRegular();
  // Explicit "no pickup / no dropoff" — never a bare dash, which reads as a missing time.
  if (!regular) return <span className="text-muted-foreground">{direction === "pickup" ? "No pickup" : "No dropoff"}</span>;
  const paused = regularPausedOn(regular, date);
  const label = regularSlotLabel(regular, direction);
  const off = paused || !!struck;
  const resume = () =>
    update.mutate(
      regular.paused_from! <= dubaiToday()
        ? { id: regular.id, paused_until: shiftIsoDate(dubaiToday(), -1) }
        : { id: regular.id, paused_from: null, paused_until: null },
      {
        onSuccess: () => toast.success("Resumed"),
        onError: (e) => toast.error((e as Error).message || "Couldn't resume"),
      },
    );
  return (
    <div className="space-y-1">
      <p className={off ? "line-through text-muted-foreground" : label === NO_SLOT_LABEL ? TONE.warn.text : ""}>{label}</p>
      {transfer && (
        <Badge variant="outline" className={`text-[10px] ${TRANSFER_BADGE}`}>
          Branch move · {transfer}
        </Badge>
      )}
      {paused ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] ${TONE.warn.badge}`} data-testid="transport-regular-paused">
            {pausedLabel(regular, dubaiToday()) ?? "Paused"}
          </Badge>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={resume} disabled={update.isPending}>
            <Play className="mr-1 h-3 w-3" /> Resume
          </Button>
        </div>
      ) : struck ? (
        <Badge
          variant="outline"
          className={`text-[10px] ${struck === "Cancelled" || struck.startsWith("Moved") ? TONE.critical.badge : TONE.warn.badge}`}
        >
          {struck === "Cancelled" ? "Cancelled on this day only" : struck}
        </Badge>
      ) : null}
    </div>
  );
}

// ── Edit pattern ──

function EditPattern({
  target,
  onTarget,
}: {
  target: { ownerId: string; label: string; petId: string | null } | null;
  onTarget: (t: { ownerId: string; label: string; petId: string | null } | null) => void;
}) {
  const { data: pets = [] } = usePets(target?.ownerId ?? "");
  const livePets = pets.filter((p) => !isPetDeceased(p));
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    if (target && !target.petId && livePets.length === 1) onTarget({ ...target, petId: livePets[0].id });
  }, [target, livePets, onTarget]);

  const pet = livePets.find((p) => p.id === target?.petId) ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="max-w-md">
            <OwnerCombobox
              selectedId={target?.ownerId ?? null}
              selectedLabel={target?.label || (target ? "Selected client" : null)}
              onSelect={(id, label) => onTarget({ ownerId: id, label, petId: null })}
              onClear={() => onTarget(null)}
              placeholder="Find a pet or owner to edit…"
            />
          </div>
          {target && livePets.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {livePets.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={p.id === target.petId ? "default" : "outline"}
                  onClick={() => onTarget({ ...target, petId: p.id })}
                >
                  {p.name}
                </Button>
              ))}
            </div>
          )}
          {target && (
            <Button size="sm" variant="outline" onClick={() => setNewOpen(true)} data-testid="transport-regulars-new-btn">
              <Plus className="mr-1.5 h-4 w-4" /> Several dogs or days at once
            </Button>
          )}
        </CardContent>
      </Card>
      {target && pet ? (
        <WeekEditor ownerId={target.ownerId} petId={pet.id} petName={pet.name} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick a pet to change their master weekly pattern. Temporary cancellations and boarding pauses are shown in Browse
          week and do not edit this pattern.
        </p>
      )}
      <NewRegularDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        fixedOwner={target ? { id: target.ownerId, label: target.label } : null}
      />
    </div>
  );
}

function WeekEditor({ ownerId, petId, petName }: { ownerId: string; petId: string; petName: string }) {
  const today = dubaiToday();
  const { branchId: activeBranchId } = useBranch();
  const { data: regulars = [], isLoading } = useTransportRegulars(null);
  const { data: history = [] } = usePetRegularHistory(petId);
  const { data: slots = [] } = useTransportSlots();
  const { data: staffName } = useCurrentStaffName();
  const change = useChangeRegularDay();
  const update = useUpdateTransportRegular();
  const branchName = useBranchName();
  const [, setSearchParams] = useSearchParams();
  const [pending, setPending] = useState<{ weekday: number; direction: Direction; value: string; from: string | null; to: string | null } | null>(null);
  const [windowOf, setWindowOf] = useState<TransportRegular | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);

  const petRows = regulars.filter((r) => r.pet_id === petId);
  const activeFor = (weekday: number, dir: Direction) =>
    petRows.find((r) => r.weekday === weekday && covers(r, dir) && inForce(r, today)) ?? null;
  const rowFor = (weekday: number) => petRows.find((r) => r.weekday === weekday && inForce(r, today)) ?? null;
  const upcomingFor = (weekday: number, dir: Direction) =>
    petRows
      .filter((r) => r.weekday === weekday && covers(r, dir) && r.starts_on > today)
      .sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0] ?? null;
  // A new day joins the household's branch (and its cross-branch run, if it has one).
  const household = regulars.filter((r) => r.owner_id === ownerId && inForce(r, today));
  const homeBranch = petRows[0]?.branch_id ?? household[0]?.branch_id ?? activeBranchId;
  const transferTo = petRows.find((r) => inForce(r, today))?.transfer_to_branch_id ?? null;
  const pausedRows = petRows.filter((r) => pausedLabel(r, today));

  const slotValue = (r: TransportRegular | null, dir: Direction) => {
    if (!r) return NONE;
    const start = slotStartOf(dir === "pickup" ? r.pickup_time : r.dropoff_time);
    return start == null ? NONE : String(start);
  };
  const slotName = (value: string) => (value === NONE ? null : slots.find((s) => String(s.start_min) === value)?.label ?? value);

  const ask = (weekday: number, dir: Direction, value: string) => {
    const existing = activeFor(weekday, dir);
    if (!existing && value === NONE) return;
    if (existing && slotValue(existing, dir) === value) return;
    setPending({
      weekday,
      direction: dir,
      value,
      from: existing ? regularSlotLabel(existing, dir) : null,
      to: slotName(value),
    });
  };

  const apply = (p: NonNullable<typeof pending>) => {
    if (!homeBranch) return toast.error("Pick a branch first");
    const time = p.value === NONE ? null : slotTime(Number(p.value));
    change.mutate(
      {
        existing: rowFor(p.weekday),
        base: { branch_id: homeBranch, owner_id: ownerId, pet_id: petId, weekday: p.weekday, transfer_to_branch_id: transferTo },
        direction: p.direction,
        time,
        today,
        yesterday: shiftIsoDate(today, -1),
        actor: staffName ?? "Staff",
      },
      {
        onSuccess: () =>
          toast.success(
            p.to
              ? `${WEEKDAY_LABELS[p.weekday]} ${p.direction} is now ${p.to}`
              : `${WEEKDAY_LABELS[p.weekday]} ${p.direction} removed`,
          ),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const resumeAll = () =>
    Promise.all(
      pausedRows.map((r) =>
        update.mutateAsync(
          r.paused_from! <= today ? { id: r.id, paused_until: shiftIsoDate(today, -1) } : { id: r.id, paused_from: null, paused_until: null },
        ),
      ),
    )
      .then(() => toast.success("Resumed"))
      .catch((e) => toast.error((e as Error).message || "Couldn't resume"));

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-6" data-testid="transport-week-editor">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{petName}</p>
        <VaccineStatusBadge petId={petId} />
        {homeBranch && <BranchBadge branchId={homeBranch} />}
        {transferTo && (
          <Badge variant="outline" className={TRANSFER_BADGE}>
            Cross-branch · {branchName(homeBranch)} ⇄ {branchName(transferTo)}
          </Badge>
        )}
        {household[0]?.owners && <PinBadge lat={household[0].owners.pin_lat} lng={household[0].owners.pin_lng} />}
        <Link to={`/customers/${ownerId}`} className="text-xs text-muted-foreground underline">
          Client profile
        </Link>
        <div className="ml-auto flex gap-2">
          {pausedRows.length > 0 ? (
            <Button size="sm" variant="outline" onClick={resumeAll} disabled={update.isPending}>
              <Play className="mr-1 h-3.5 w-3.5" /> Resume
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setPauseOpen(true)} disabled={!petRows.length}>
              <Pause className="mr-1 h-3.5 w-3.5" /> Pause
            </Button>
          )}
        </div>
      </div>

      {pausedRows.length > 0 && (
        <div className="rounded-md border divide-y">
          <p className="p-3 text-sm font-medium">Paused</p>
          {pausedRows.map((r) => (
            <p key={r.id} className={`p-3 text-sm ${TONE.warn.text}`}>
              {WEEKDAY_LABELS[r.weekday]} · {pausedLabel(r, today)}
            </p>
          ))}
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="bg-muted/50">
              <th className="p-2 text-left font-medium w-32">Day</th>
              <th className="p-2 text-left font-medium">Pickup</th>
              <th className="p-2 text-left font-medium">Dropoff</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {WEEK_ORDER.map((day) => (
              <tr key={day}>
                <td className="p-2 font-medium">{WEEKDAY_LABELS[day]}</td>
                {(["pickup", "dropoff"] as const).map((dir) => {
                  const rule = activeFor(day, dir);
                  const upcoming = upcomingFor(day, dir);
                  const leg = rule ? transferLeg(rule, dir, branchName) : null;
                  const flexible = rule
                    ? dir === "pickup"
                      ? rule.pickup_window_start_min != null
                      : rule.dropoff_window_start_min != null
                    : false;
                  return (
                    <td key={dir} className="p-2 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Select value={slotValue(rule, dir)} disabled={change.isPending} onValueChange={(v) => ask(day, dir, v)}>
                          <SelectTrigger className={`w-full max-w-52 ${rule ? "" : "text-muted-foreground"}`} data-testid={`transport-week-${day}-${dir}`}>
                            <SelectValue>{rule ? regularSlotLabel(rule, dir) : "—"}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>No transport</SelectItem>
                            {slots
                              .filter((s) => s.direction === dir)
                              .map((s) => (
                                <SelectItem key={s.id} value={String(s.start_min)}>
                                  {s.label}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {rule && (
                          <button
                            type="button"
                            className={flexible ? TONE.info.text : "text-muted-foreground hover:text-foreground"}
                            title="Flexible window — the wider time the owner is happy with"
                            onClick={() => setWindowOf(rule)}
                            data-testid="transport-regular-window-btn"
                          >
                            <Clock className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {leg && (
                        <Badge variant="outline" className={`text-[10px] ${TRANSFER_BADGE}`}>
                          Branch move · {leg}
                        </Badge>
                      )}
                      {upcoming && (
                        <Badge variant="outline" className={`text-[10px] ${TONE.good.badge}`}>
                          {rule ? "Changes to " : ""}
                          {regularSlotLabel(upcoming, dir)} from {safeFormatDate(upcoming.starts_on, "d MMM")}
                        </Badge>
                      )}
                      {rule && pausedLabel(rule, today) && (
                        <Badge variant="outline" className={`text-[10px] ${TONE.warn.badge}`}>
                          {pausedLabel(rule, today)}
                        </Badge>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Changes take effect from today. The old rule is kept below as history.</p>

      <RuleHistory rows={history} branchName={branchName} />

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change this regular without checking?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {petName}&apos;s {pending ? WEEKDAY_LABELS[pending.weekday] : ""} {pending?.direction}
                  {pending?.from && pending?.to
                    ? ` changes from ${pending.from} to ${pending.to}`
                    : pending?.to
                      ? ` is added at ${pending.to}`
                      : ` is removed (was ${pending?.from})`}
                  , from today, every week.
                </p>
                <p className={TONE.warn.text}>
                  This is made straight away, without the checks a request gets on the Requests tab — the same-day clash and
                  boarding warnings. To check first, use New request on the Requests tab.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-transparent text-foreground border hover:bg-muted"
              onClick={() => {
                setPending(null);
                setSearchParams({ tab: "requests", new: "1" });
              }}
            >
              Check in Requests
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (pending) apply(pending);
                setPending(null);
              }}
              data-testid="transport-week-change-anyway"
            >
              Change anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FlexibleWindowDialog regular={windowOf} onClose={() => setWindowOf(null)} />
      <PauseDialog rows={pauseOpen ? petRows.filter((r) => inForce(r, today)) : null} onClose={() => setPauseOpen(false)} />
    </div>
  );
}

function RuleHistory({ rows, branchName }: { rows: TransportRegular[]; branchName: (id: string | null | undefined) => string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No transport rules yet — set one in the grid above.</p>;
  const today = dubaiToday();
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">History</p>
      <div className="space-y-1">
        {rows.map((r) => {
          const active = r.is_active && inForce(r, today);
          const parts = (["pickup", "dropoff"] as const).filter((d) => covers(r, d)).map((d) => `${d} ${regularSlotLabel(r, d)}`);
          return (
            <p key={r.id} className="text-xs text-muted-foreground">
              {WEEKDAY_LABELS[r.weekday]} · {parts.join(" · ")}
              {r.transfer_to_branch_id ? ` · ${branchName(r.branch_id)} ⇄ ${branchName(r.transfer_to_branch_id)}` : ""} ·{" "}
              <Badge variant={active ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 align-middle">
                {active ? "active" : r.starts_on > today ? "upcoming" : "ended"}
              </Badge>{" "}
              · <span className="font-mono">{r.starts_on}</span> → <span className="font-mono">{r.ends_on ?? "now"}</span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

const toHHMM = (min: number | null | undefined) =>
  min == null ? "" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * A regular's own window, per direction (AE's custom window): "any time 6–9 AM". Set
 * only on purpose — without one, the booked hour slot is the window. Blank both ends
 * to go back to the slot.
 */
function FlexibleWindowDialog({ regular, onClose }: { regular: TransportRegular | null; onClose: () => void }) {
  const update = useUpdateTransportRegular();
  const [draft, setDraft] = useState({ puFrom: "", puTo: "", doFrom: "", doTo: "" });

  useEffect(() => {
    if (!regular) return;
    setDraft({
      puFrom: toHHMM(regular.pickup_window_start_min),
      puTo: toHHMM(regular.pickup_window_end_min),
      doFrom: toHHMM(regular.dropoff_window_start_min),
      doTo: toHHMM(regular.dropoff_window_end_min),
    });
  }, [regular]);

  const leg = (from: string, to: string, label: string): [number | null, number | null] | string => {
    if (!from && !to) return [null, null];
    const a = toMin(from);
    const b = toMin(to);
    if (a == null || b == null) return `Enter both a from and an until time for the ${label}, or neither.`;
    if (b <= a) return `The ${label} window has to end after it starts.`;
    if (b - a < 30) return `Make the ${label} window at least 30 minutes.`;
    return [a, b];
  };

  const save = () => {
    if (!regular) return;
    const none: [null, null] = [null, null];
    const pu = regular.direction !== "dropoff" ? leg(draft.puFrom, draft.puTo, "pickup") : none;
    const dr = regular.direction !== "pickup" ? leg(draft.doFrom, draft.doTo, "drop-off") : none;
    if (typeof pu === "string") return toast.error(pu);
    if (typeof dr === "string") return toast.error(dr);
    update.mutate(
      {
        id: regular.id,
        pickup_window_start_min: pu[0],
        pickup_window_end_min: pu[1],
        dropoff_window_start_min: dr[0],
        dropoff_window_end_min: dr[1],
      },
      {
        onSuccess: () => {
          toast.success("Window saved");
          onClose();
        },
        onError: (err) => toast.error(err.message || "Couldn't save the window"),
      },
    );
  };

  const row = (label: string, from: "puFrom" | "doFrom", to: "puTo" | "doTo", booked: string | null) => (
    <div className="space-y-1">
      <Label className="text-xs">
        {label}
        {booked ? ` · booked ${runSlotLabel(booked)}` : ""}
      </Label>
      <div className="flex items-center gap-2">
        <Input type="time" value={draft[from]} onChange={(e) => setDraft((d) => ({ ...d, [from]: e.target.value }))} />
        <span className="text-xs text-muted-foreground">until</span>
        <Input type="time" value={draft[to]} onChange={(e) => setDraft((d) => ({ ...d, [to]: e.target.value }))} />
      </div>
    </div>
  );

  return (
    <Dialog open={!!regular} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="transport-regular-window-dialog">
        <DialogHeader>
          <DialogTitle>Flexible window{regular ? ` · ${WEEKDAY_LABELS[regular.weekday]}` : ""}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Only when the owner is happy with more than the hour they booked (booked 06-07AM, fine until 9). Leave blank to
          keep the booked hour.
        </p>
        <div className="space-y-3">
          {regular?.direction !== "dropoff" && row("Pickup", "puFrom", "puTo", regular?.pickup_time ?? null)}
          {regular?.direction !== "pickup" && row("Dropoff", "doFrom", "doTo", regular?.dropoff_time ?? null)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending} data-testid="transport-regular-window-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PauseDialog({ rows, onClose }: { rows: TransportRegular[] | null; onClose: () => void }) {
  const update = useUpdateTransportRegular();
  const [from, setFrom] = useState(dubaiToday());
  const [until, setUntil] = useState("");

  useEffect(() => {
    if (rows) {
      setFrom(dubaiToday());
      setUntil("");
    }
  }, [rows]);

  const save = async () => {
    if (!rows) return;
    if (until && until < from) return toast.error("The pause ends before it starts");
    try {
      await Promise.all(rows.map((r) => update.mutateAsync({ id: r.id, paused_from: from, paused_until: until || null })));
      toast.success("Paused");
      onClose();
    } catch (err) {
      toast.error((err as Error).message || "Couldn't pause");
    }
  };

  return (
    <Dialog open={!!rows} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pause regular runs</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="pause-from">From</Label>
            <Input id="pause-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pause-until">Until (blank = until resumed)</Label>
            <Input id="pause-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            Pause
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Several dogs × several days in one go (from Edit pattern and the client profile). The
 * times are the published hour slots, as on AE. "To the other branch" makes a
 * cross-branch regular: taken there on the pickup, brought back on the drop-off.
 */
export function NewRegularDialog({
  open,
  onOpenChange,
  fixedOwner = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fixedOwner?: { id: string; label: string } | null;
}) {
  const { branchId, branchShortName, branches } = useBranch();
  const create = useCreateTransportRegulars();
  const { data: slots = [] } = useTransportSlots();
  const [ownerId, setOwnerId] = useState<string | null>(fixedOwner?.id ?? null);
  const [ownerLabel, setOwnerLabel] = useState<string | null>(fixedOwner?.label ?? null);
  const [petIds, setPetIds] = useState<string[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [direction, setDirection] = useState<"pickup" | "dropoff" | "both">("both");
  const [pickupSlot, setPickupSlot] = useState("");
  const [dropoffSlot, setDropoffSlot] = useState("");
  const [route, setRoute] = useState<string>("home");
  const [startsOn, setStartsOn] = useState(dubaiToday());
  const [notes, setNotes] = useState("");
  const [staff, setStaff] = useState("");
  const { data: signedInName } = useCurrentStaffName();
  const { data: pets = [] } = usePets(ownerId ?? "");
  const livePets = pets.filter((p) => !isPetDeceased(p));
  const otherBranches = dipFirst(branches).filter((b) => b.id !== branchId);

  useEffect(() => {
    if (!open) return;
    setOwnerId(fixedOwner?.id ?? null);
    setOwnerLabel(fixedOwner?.label ?? null);
    setPetIds([]);
    setWeekdays([]);
    setDirection("both");
    setPickupSlot("");
    setDropoffSlot("");
    setRoute("home");
    setStartsOn(dubaiToday());
    setNotes("");
    setStaff(signedInName ?? "");
  }, [open, fixedOwner?.id, fixedOwner?.label, signedInName]);

  useEffect(() => {
    if (livePets.length === 1) setPetIds([livePets[0].id]);
  }, [ownerId, livePets.length]);

  const submit = () => {
    if (!branchId) return toast.error("Pick a branch first");
    if (!ownerId) return toast.error("Pick the client");
    if (petIds.length === 0) return toast.error("Tick at least one pet");
    if (weekdays.length === 0) return toast.error("Tick at least one day");
    if (!staff.trim()) return toast.error("Who is entering this?");
    const rows = petIds.flatMap((pet_id) =>
      weekdays.map((weekday) => ({
        branch_id: branchId,
        owner_id: ownerId,
        pet_id,
        weekday,
        direction,
        pickup_time: direction !== "dropoff" && pickupSlot ? slotTime(Number(pickupSlot)) : null,
        dropoff_time: direction !== "pickup" && dropoffSlot ? slotTime(Number(dropoffSlot)) : null,
        transfer_to_branch_id: route === "home" ? null : route,
        starts_on: startsOn,
        notes: notes.trim() || null,
        created_by: staff.trim(),
      })),
    );
    create.mutate(rows, {
      onSuccess: () => {
        toast.success("Regular runs added");
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message || "Couldn't save"),
    });
  };

  const slotSelect = (dir: Direction, value: string, set: (v: string) => void) => (
    <Select value={value} onValueChange={set}>
      <SelectTrigger data-testid={`transport-regular-${dir}-slot`}>
        <SelectValue placeholder="Hour" />
      </SelectTrigger>
      <SelectContent>
        {slots
          .filter((s) => s.direction === dir)
          .map((s) => (
            <SelectItem key={s.id} value={String(s.start_min)}>
              {s.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="transport-regular-dialog">
        <DialogHeader>
          <DialogTitle>New regular run{branchShortName ? ` · ${branchShortName}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!fixedOwner && (
            <div className="space-y-2">
              <Label>Client</Label>
              <OwnerCombobox
                selectedId={ownerId}
                selectedLabel={ownerLabel}
                onSelect={(id, label) => {
                  setOwnerId(id);
                  setOwnerLabel(label);
                  setPetIds([]);
                }}
                onClear={() => {
                  setOwnerId(null);
                  setOwnerLabel(null);
                  setPetIds([]);
                }}
              />
            </div>
          )}
          {ownerId && (
            <div className="space-y-2">
              <Label>Pets</Label>
              <div className="flex flex-wrap gap-3">
                {livePets.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={petIds.includes(p.id)}
                      onCheckedChange={(v) => setPetIds((prev) => (v ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
                    />
                    {p.name}
                    <VaccineStatusBadge petId={p.id} />
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label>Days</Label>
            <div className="flex flex-wrap gap-2">
              {WEEK_ORDER.map((d) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant={weekdays.includes(d) ? "default" : "outline"}
                  className="h-8 w-12 text-xs"
                  data-testid={`transport-regular-day-${d}`}
                  onClick={() => setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}
                >
                  {WEEKDAY_LABELS[d].slice(0, 3)}
                </Button>
              ))}
            </div>
          </div>
          {otherBranches.length > 0 && (
            <div className="space-y-2">
              <Label>Run</Label>
              <Select value={route} onValueChange={setRoute}>
                <SelectTrigger data-testid="transport-regular-route">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home">Home ↔ {branchShortName ?? "branch"}</SelectItem>
                  {otherBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      Cross-branch · {branchShortName} → {b.short_name} (pickup), back on the drop-off
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Direction</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Pickup + dropoff</SelectItem>
                  <SelectItem value="pickup">Pickup</SelectItem>
                  <SelectItem value="dropoff">Dropoff</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {direction !== "dropoff" && (
              <div className="space-y-2">
                <Label>Pickup</Label>
                {slotSelect("pickup", pickupSlot, setPickupSlot)}
              </div>
            )}
            {direction !== "pickup" && (
              <div className="space-y-2">
                <Label>Dropoff</Label>
                {slotSelect("dropoff", dropoffSlot, setDropoffSlot)}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="regular-starts">Starts on</Label>
            <Input id="regular-starts" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="regular-notes">Notes</Label>
            <Textarea id="regular-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="regular-entered-by">Entered by</Label>
            <Input id="regular-entered-by" value={staff} onChange={(e) => setStaff(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending} data-testid="transport-regular-save">
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
