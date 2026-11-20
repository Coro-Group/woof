import { useState } from "react";
import { Search } from "lucide-react";
import { useClientSchedule } from "@/hooks/useTransport";
import { dayDate } from "@/lib/transportRequests";
import { dubaiToday, runSlotLabel } from "@/lib/transportSchedule";
import { cn } from "@/lib/utils";
import { OwnerCombobox } from "@/components/daycare/DaycareOwnerCombobox";
import { BranchBadge, StopBadgeView, readableDates, vetLine } from "@/components/transport/transportShared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VaccineStatusBadge } from "@/components/VaccineStatusBadge";

/**
 * "When is Rex next on the van?" — one household's travel days (AE's
 * ClientScheduleSearch), every branch, with runs that are off kept and crossed out.
 */
export function ClientScheduleSearch() {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerLabel, setOwnerLabel] = useState<string | null>(null);
  const [days, setDays] = useState("14");
  const today = dubaiToday();
  const { data = [], isLoading } = useClientSchedule(ownerId, today, Number(days));

  return (
    <Card className="print:hidden" data-testid="transport-client-search">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <Search className="h-4 w-4" /> Client schedule
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-80">
            <OwnerCombobox
              selectedId={ownerId}
              selectedLabel={ownerLabel}
              onSelect={(id, label) => {
                setOwnerId(id);
                setOwnerLabel(label);
              }}
              onClear={() => {
                setOwnerId(null);
                setOwnerLabel(null);
              }}
              placeholder="Search a client or dog…"
            />
          </div>
          <ToggleGroup type="single" variant="outline" size="sm" value={days} onValueChange={(v) => v && setDays(v)}>
            <ToggleGroupItem value="7">7 days</ToggleGroupItem>
            <ToggleGroupItem value="14">14 days</ToggleGroupItem>
            <ToggleGroupItem value="28">28 days</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {!ownerId ? null : isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="transport-client-search-empty">
            No transport in the next {days} days.
          </p>
        ) : (
          <div className="divide-y rounded-md border" data-testid="transport-client-search-results">
            {data.map(({ date, stops }) => (
              <div key={date} className="flex flex-wrap gap-x-4 gap-y-1 p-2 text-sm">
                <span className="w-24 shrink-0 font-medium">{date === today ? "Today" : dayDate(date)}</span>
                <div className="flex-1 space-y-0.5">
                  {stops.map((s) => (
                    <div key={s.key} className={cn("flex flex-wrap items-center gap-1.5", s.struck && "text-muted-foreground")}>
                      <VaccineStatusBadge petId={s.petId} variant="dot" />
                      <span className={cn(s.struck && "line-through")}>
                        {s.pet?.name} · {s.direction === "pickup" ? "Pickup" : "Drop-off"} {runSlotLabel(s.time) ?? "— no slot time"}
                      </span>
                      <BranchBadge branchId={s.branchId} />
                      <StopBadgeView badge={s.badge} />
                      {s.struck && <span className="text-xs text-red-700 dark:text-red-400">{readableDates(s.struck)}</span>}
                      {vetLine(s) && <span className="text-xs text-rose-700 dark:text-rose-400">{vetLine(s)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
