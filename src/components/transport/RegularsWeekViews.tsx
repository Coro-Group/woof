import { useMemo, useState } from "react";
import { useBranch } from "@/contexts/BranchContext";
import { type TransportRegularWithDetails } from "@/hooks/useTransport";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { SHORT_DAYS, shortDate } from "@/lib/transportRequests";
import { NO_SLOT_LABEL, dubaiToday, pausedLabel, regularPausedOn, runSlotLabel, slotLabelFor } from "@/lib/transportSchedule";
import { cn } from "@/lib/utils";
import { type BranchFilter } from "@/components/transport/transportShared";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VaccineStatusBadge } from "@/components/VaccineStatusBadge";

// Monday-first, the way the team reads a week.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function hourOf(time: string | null): number | null {
  const m = /^(\d{1,2}):/.exec(time ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * One household's week at a glance (AE's RegularHouseholdSheet): each dog × weekday,
 * with the pickup and drop-off times, paused and ending runs marked.
 */
export function HouseholdWeekSheet({
  open,
  onOpenChange,
  ownerName,
  rows,
  onEditPet,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerName: string;
  rows: TransportRegularWithDetails[];
  /** Opens Edit pattern on this dog. */
  onEditPet?: (petId: string) => void;
}) {
  const { branches } = useBranch();
  const branchName = (id: string | null | undefined) => branches.find((b) => b.id === id)?.short_name ?? "?";
  const today = dubaiToday();
  const pets = [...new Map(rows.map((r) => [r.pet_id, r.pets?.name ?? "Pet"])).entries()];
  const cell = (petId: string, weekday: number) => rows.filter((r) => r.pet_id === petId && r.weekday === weekday);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto" data-testid="transport-household-week">
        <SheetHeader>
          <SheetTitle>{ownerName} · week</SheetTitle>
        </SheetHeader>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="p-1.5 text-left">Dog</th>
                {WEEK_ORDER.map((d) => (
                  <th key={d} className="p-1.5 text-left">{SHORT_DAYS[d]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pets.map(([petId, name]) => (
                <tr key={petId} className="border-t align-top">
                  <td className="p-1.5 font-medium">
                    <span className="inline-flex items-center gap-1">
                      {name}
                      <VaccineStatusBadge petId={petId} variant="dot" />
                    </span>
                    {onEditPet && (
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs block" onClick={() => onEditPet(petId)}>
                        Edit pattern
                      </Button>
                    )}
                  </td>
                  {WEEK_ORDER.map((d) => {
                    const runs = cell(petId, d);
                    return (
                      <td key={d} className={cn("p-1.5", runs.length ? "bg-muted/40" : "")}>
                        {runs.map((r) => {
                          const paused = regularPausedOn(r, today);
                          return (
                            <div key={r.id} className={cn("space-y-0.5", paused && "text-amber-700 dark:text-amber-400")}>
                              {r.direction !== "dropoff" && (
                                <div>PU {runSlotLabel(r.pickup_time, r.pickup_window_start_min, r.pickup_window_end_min) ?? NO_SLOT_LABEL}</div>
                              )}
                              {r.direction !== "pickup" && (
                                <div>DO {runSlotLabel(r.dropoff_time, r.dropoff_window_start_min, r.dropoff_window_end_min) ?? NO_SLOT_LABEL}</div>
                              )}
                              {r.transfer_to_branch_id && (
                                <div className="text-[10px] text-teal-700 dark:text-teal-400">
                                  {branchName(r.branch_id)} ⇄ {branchName(r.transfer_to_branch_id)}
                                </div>
                              )}
                              {pausedLabel(r, today) && <div className="text-[10px]">{pausedLabel(r, today)}</div>}
                              {r.ends_on && <div className="text-[10px] text-red-700 dark:text-red-400">Ends {shortDate(r.ends_on)}</div>}
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Capacity heat map (AE): how many regular runs fall in each hour of each weekday, so
 * reception can see which slots are already busy before promising another.
 */
export function CapacityHeatMap({ regulars, branch }: { regulars: TransportRegularWithDetails[]; branch: BranchFilter }) {
  const today = dubaiToday();
  const [dir, setDir] = useState<"pickup" | "dropoff">("pickup");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of regulars) {
      if (branch !== "all" && r.branch_id !== branch) continue;
      if (r.starts_on > today || (r.ends_on && r.ends_on < today) || regularPausedOn(r, today)) continue;
      if (r.direction !== dir && r.direction !== "both") continue;
      const h = hourOf(dir === "pickup" ? r.pickup_time : r.dropoff_time);
      const key = `${r.weekday}|${h ?? "none"}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [regulars, branch, dir, today]);
  const hours = Array.from({ length: 15 }, (_, i) => 6 + i);
  const max = Math.max(1, ...counts.values());
  const label = (h: number) => slotLabelFor(h * 60);

  return (
    <div className="space-y-3" data-testid="transport-capacity">
      <div className="flex gap-1">
        <Button size="sm" variant={dir === "pickup" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setDir("pickup")}>Pickups</Button>
        <Button size="sm" variant={dir === "dropoff" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setDir("dropoff")}>Drop-offs</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-1" />
              {hours.map((h) => (
                <th key={h} className="p-1 font-normal text-muted-foreground">{label(h)}</th>
              ))}
              <th className="p-1 font-normal text-muted-foreground">No time</th>
            </tr>
          </thead>
          <tbody>
            {WEEK_ORDER.map((d) => (
              <tr key={d}>
                <td className="p-1 pr-2 font-medium">{SHORT_DAYS[d]}</td>
                {[...hours.map(String), "none"].map((h) => {
                  const n = counts.get(`${d}|${h}`) ?? 0;
                  return (
                    <td
                      key={h}
                      className="h-8 w-10 border text-center"
                      style={n ? { backgroundColor: `rgba(234, 88, 12, ${0.12 + 0.75 * (n / max)})` } : undefined}
                      title={`${SHORT_DAYS[d]} ${h === "none" ? "no time" : label(Number(h))}: ${n} dog${n === 1 ? "" : "s"}`}
                    >
                      {n || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Regular runs that are running this week (paused and ended ones left out), by the hour they start.</p>
    </div>
  );
}

export function ownerNameOf(r: TransportRegularWithDetails): string {
  return r.owners ? ownerDisplayName(r.owners.first_name, r.owners.last_name) : "";
}

export function useBranchLabel() {
  const { branches } = useBranch();
  return (id: string) => branches.find((b) => b.id === id)?.short_name ?? null;
}
