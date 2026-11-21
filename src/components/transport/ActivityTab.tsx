import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { useTransportActivity, type ActivityEvent } from "@/hooks/useTransport";
import { SHORT_DAYS, TONE_BADGE, dayDate, kindLabel, kindTone } from "@/lib/transportRequests";
import { BranchBadge, BranchFilterToggle, matchesBranch, type BranchFilter } from "@/components/transport/transportShared";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const ACTION: Record<string, string> = {
  recorded: "recorded",
  offered: "offered times on",
  approved: "approved",
  rejected: "rejected",
  cancelled: "withdrew / cancelled",
  received: "re-opened",
  note: "changed the note on",
  edited: "edited",
};

function what(e: ActivityEvent): string {
  const r = e.transport_request;
  if (!r) return "a request";
  const pets = r.transport_request_pet.map((p) => p.pets?.name).filter(Boolean).join(", ");
  const owner = r.owners ? `${r.owners.first_name} ${r.owners.last_name ?? ""}`.trim() : "";
  const when = r.service_date ? dayDate(r.service_date) : r.weekday != null ? `every ${SHORT_DAYS[r.weekday]}` : "";
  return `${pets || "a pet"}${owner ? ` (${owner})` : ""} · ${r.direction === "pickup" ? "pickup" : "drop-off"} ${when}`;
}

/**
 * Who did what (AE's Activity tab): every recorded, approved, rejected, edited and
 * cancelled request, newest first. A card's rows change together, so each change is
 * shown once per card.
 */
export function ActivityTab() {
  const { data = [], isLoading, error } = useTransportActivity();
  const [branch, setBranch] = useState<BranchFilter>("all");
  const [search, setSearch] = useState("");

  const days = useMemo(() => {
    const q = search.trim().toLowerCase();
    const seen = new Set<string>();
    const byDay = new Map<string, ActivityEvent[]>();
    for (const e of data) {
      if (!matchesBranch(e.transport_request?.branch_id, branch)) continue;
      const key = `${e.group_id}|${e.action}|${e.actor}|${e.at.slice(0, 19)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = `${e.actor ?? ""} ${what(e)} ${e.detail ?? ""}`.toLowerCase();
      if (q && !text.includes(q)) continue;
      const day = format(new Date(e.at), "yyyy-MM-dd");
      byDay.set(day, [...(byDay.get(day) ?? []), e]);
    }
    return [...byDay.entries()];
  }, [data, branch, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input className="w-64" placeholder="Filter by person, pet or owner…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="transport-activity-search" />
        <BranchFilterToggle value={branch} onChange={setBranch} />
      </div>
      {error ? (
        <p className="text-sm text-red-700">Couldn't load activity: {(error as Error).message}</p>
      ) : isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : days.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <div className="space-y-5" data-testid="transport-activity">
          {days.map(([day, events]) => (
            <div key={day} className="space-y-1">
              <p className="text-sm font-medium">{dayDate(day)}</p>
              <ol className="rounded-md border divide-y">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                    <span className="w-12 shrink-0 text-xs text-muted-foreground">{format(new Date(e.at), "HH:mm")}</span>
                    <span className="font-medium">{e.actor ?? "Someone"}</span>
                    <span className="text-muted-foreground">{ACTION[e.action] ?? e.action}</span>
                    {e.transport_request && (
                      <Badge variant="outline" className={`text-[10px] ${TONE_BADGE[kindTone(e.transport_request.kind, e.transport_request.purpose)]}`}>
                        {kindLabel(e.transport_request.kind, e.transport_request.purpose)}
                      </Badge>
                    )}
                    <Link to={`/transport?tab=requests&request=${e.group_id}`} className="hover:underline">
                      {what(e)}
                    </Link>
                    <BranchBadge branchId={e.transport_request?.branch_id} />
                    {e.detail && <span className="text-xs text-muted-foreground">· {e.detail}</span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
