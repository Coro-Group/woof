import { createPortal } from "react-dom";
import { format } from "date-fns";
import type { BoardStop, DayNote } from "@/hooks/useTransport";
import { BADGE_LABEL } from "@/lib/transportSchedule";
import { readableDates, vetLine } from "@/components/transport/transportShared";

type Group = { label: string; stops: BoardStop[] };

/** What reception needs beside the name — why a stop is extra, off, or a vet trip. */
function reason(s: BoardStop): string {
  if (s.struck) return readableDates(s.struck);
  const parts: string[] = [];
  if (s.badge) parts.push(BADGE_LABEL[s.badge]);
  if (s.badge === "moved_in" && s.movedDate) parts.push(`from ${readableDates(s.movedDate)}`);
  const vet = vetLine(s);
  if (vet) parts.push(vet);
  return parts.join(" · ");
}

function DirectionSection({
  title,
  groups,
  branchLabel,
  dayNotes,
}: {
  title: string;
  groups: Group[];
  branchLabel: (id: string) => string | null;
  dayNotes: Map<string, DayNote>;
}) {
  return (
    <section className="mt-5">
      <h2 className="text-base font-bold border-b-2 border-black pb-0.5">{title}</h2>
      {!groups.length && <p className="mt-2 text-sm">Nothing scheduled.</p>}
      {groups.map((g) => {
        const live = g.stops.filter((s) => !s.struck).length;
        return (
          <div key={g.label} className="mt-3 break-inside-avoid">
            <h3 className="text-sm font-semibold">
              {g.label} · {live} stop{live === 1 ? "" : "s"}
            </h3>
            <table className="mt-1 w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-black text-left">
                  <th className="w-6 py-1 pr-2" aria-label="Done" />
                  <th className="py-1 pr-2">Dog</th>
                  <th className="py-1 pr-2">Owner</th>
                  <th className="w-12 py-1 pr-2">House</th>
                  <th className="py-1 pr-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {g.stops.map((s) => {
                  const off = !!s.struck;
                  const dayNote = s.owner ? dayNotes.get(`${s.owner.id}|${s.direction}`)?.note : null;
                  const why = reason(s);
                  return (
                    <tr key={s.key} className="border-b border-gray-300 align-top">
                      <td className="py-1 pr-2">{off ? "" : "☐"}</td>
                      <td className={`py-1 pr-2 capitalize ${off ? "line-through" : "font-medium"}`}>{s.pet?.name ?? "—"}</td>
                      <td className={`py-1 pr-2 capitalize ${off ? "line-through" : ""}`}>
                        {s.owner ? `${s.owner.first_name} ${s.owner.last_name ?? ""}`.trim() : ""}
                        {!off && s.owner?.phone ? <span className="block text-[10px]">{s.owner.phone}</span> : null}
                      </td>
                      <td className="py-1 pr-2">{branchLabel(s.branchId) ?? ""}</td>
                      <td className="py-1 pr-2">
                        {why && <span className={`block ${off ? "font-semibold" : ""}`}>{why}</span>}
                        {/* A stop that is off needs no instructions. Household note first, in
                            bold as on the driver's sheet, then the day's, the dog's, the trip's. */}
                        {!off && s.owner?.transport_notes?.trim() && (
                          <strong className="block whitespace-pre-wrap">{s.owner.transport_notes.trim()}</strong>
                        )}
                        {!off && dayNote && <span className="block whitespace-pre-wrap">Today: {dayNote}</span>}
                        {!off && s.pet?.driver_note?.trim() && <span className="block whitespace-pre-wrap">{s.pet.driver_note.trim()}</span>}
                        {!off && s.locationText && <span className="block">At: {s.locationText}</span>}
                        {!off && s.note?.trim() && s.purpose !== "vet" && <span className="block whitespace-pre-wrap">{s.note.trim()}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}

/**
 * The day's schedule as reception prints it (AE's SchedulePrintSheet): pickups then
 * drop-offs, by time, with a tick box per dog. Portalled beside #root, which is hidden
 * while printing — so a long day flows over as many pages as it needs.
 */
export function SchedulePrintSheet({
  date,
  scopeLabel,
  pickups,
  dropoffs,
  branchLabel,
  dayNotes,
}: {
  date: string;
  scopeLabel: string;
  pickups: Group[];
  dropoffs: Group[];
  branchLabel: (id: string) => string | null;
  dayNotes: Map<string, DayNote>;
}) {
  const stops = [...pickups, ...dropoffs].reduce((n, g) => n + g.stops.filter((s) => !s.struck).length, 0);
  return createPortal(
    <div className="hidden print:block bg-white text-black" data-testid="transport-print-sheet">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          #root { display: none !important; }
          html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
        }
      `}</style>
      <div className="flex items-baseline justify-between border-b border-black pb-1">
        <h1 className="text-lg font-bold">Transport schedule · {format(new Date(`${date}T12:00:00`), "EEEE d MMMM yyyy")}</h1>
        <p className="text-xs">
          {scopeLabel} · {stops} stop{stops === 1 ? "" : "s"}
        </p>
      </div>
      <p className="mt-0.5 text-[10px] text-gray-600">Printed {format(new Date(), "d MMM yyyy, HH:mm")} — changes after this time are not shown.</p>
      <DirectionSection title="Pickups" groups={pickups} branchLabel={branchLabel} dayNotes={dayNotes} />
      <DirectionSection title="Drop-offs" groups={dropoffs} branchLabel={branchLabel} dayNotes={dayNotes} />
    </div>,
    document.body,
  );
}
