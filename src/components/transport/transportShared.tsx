import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Info, MapPin, MessageSquarePlus, MessageSquareText, Phone, StickyNote } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { mapsUrl, pinAreaLabel } from "@/lib/transportPin";
import { BADGE_LABEL, SOURCE_LABEL, directionLabel, flexibleWindowLabel, type StopBadge } from "@/lib/transportSchedule";
import { clock12 } from "@/lib/transportVetVisit";
import { dayDate } from "@/lib/transportRequests";
import { useCurrentStaffName, useSaveDayNote, useUpdateTransportRequestRows, type BoardStop } from "@/hooks/useTransport";
import { VaccineStatusBadge } from "@/components/VaccineStatusBadge";

/**
 * A note for one household on one date and direction (AE's day note): "gate code
 * changed today", "use the side entrance". Shown on cards, the schedule and its print.
 */
export function DayNoteButton({
  date,
  direction,
  ownerId,
  note,
}: {
  date: string;
  direction: string;
  ownerId: string;
  note: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note ?? "");
  const save = useSaveDayNote();
  const { data: staffName } = useCurrentStaffName();
  useEffect(() => {
    if (open) setText(note ?? "");
  }, [open, note]);
  const Icon = note?.trim() ? MessageSquareText : MessageSquarePlus;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-auto text-muted-foreground hover:text-foreground print:hidden"
          title={note?.trim() ? "Edit the day note" : `Add a note for this ${direction === "pickup" ? "pickup" : "drop-off"}`}
          data-testid="transport-day-note-btn"
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2">
        <p className="text-xs font-medium">
          Note for this household · {direction === "pickup" ? "pickup" : "drop-off"} · {date}
        </p>
        <Textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Only for this day — e.g. use the side gate" />
        <div className="flex justify-end gap-2">
          {note?.trim() && (
            <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => setText("")}>
              Clear
            </Button>
          )}
          <Button
            size="sm"
            disabled={save.isPending}
            data-testid="transport-day-note-save"
            onClick={() =>
              save.mutate(
                { date, direction, ownerId, note: text, actor: staffName ?? "Staff" },
                {
                  onSuccess: () => {
                    toast.success(text.trim() ? "Day note saved" : "Day note cleared");
                    setOpen(false);
                  },
                  onError: (e) => toast.error((e as Error).message),
                },
              )
            }
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Edit a request's own note (AE's TripNoteEditor) from a list, at any status. */
export function TripNoteButton({ requestIds, note }: { requestIds: string[]; note: string | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note ?? "");
  const update = useUpdateTransportRequestRows();
  const { data: staffName } = useCurrentStaffName();
  useEffect(() => {
    if (open) setText(note ?? "");
  }, [open, note]);
  const Icon = note?.trim() ? MessageSquareText : MessageSquarePlus;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground"
          title={note?.trim() ? "Edit the trip note" : "Add a trip note"}
          data-testid="transport-trip-note-btn"
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-medium">Note for this trip</p>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Anything the driver or reception needs to know" />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setText(note ?? "")}>
            Undo
          </Button>
          <Button
            size="sm"
            disabled={update.isPending}
            data-testid="transport-trip-note-save"
            onClick={() =>
              update.mutate(
                { ids: requestIds, patch: { notes: text.trim() || null, updated_by: staffName ?? "Staff" } },
                {
                  onSuccess: () => {
                    toast.success("Trip note saved");
                    setOpen(false);
                  },
                  onError: (e) => toast.error((e as Error).message),
                },
              )
            }
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const DIRECTION_BADGE: Record<string, string> = {
  pickup: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
  dropoff: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  both: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800",
};

/** Shown on Desk: what it covers, and where the transport team plans. */
export function SharedBoardNotice() {
  return (
    <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      Every dog that needs a van today. The transport team plans the vans on the Master board in admin-essentials;
      these requests and regulars stay here until that link is connected.
    </p>
  );
}

/** All, or one branch id. Like AE's All / MSH / LG toggle, with Petzania's branches. */
export type BranchFilter = "all" | string;

// DIP neutral and BB violet, the way AE colours MSH and LG.
const BRANCH_BADGE_CLASS: Record<string, string> = {
  woof: "bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  main: "bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  bb: "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800",
};

export function BranchBadge({ branchId }: { branchId: string | null | undefined }) {
  const { branches } = useBranch();
  const branch = branches.find((b) => b.id === branchId);
  if (!branch) return null;
  return (
    <Badge variant="outline" className={cn("shrink-0 text-xs", BRANCH_BADGE_CLASS[branch.code])}>
      {branch.short_name}
    </Badge>
  );
}

/**
 * Both branches share these lists; either team can narrow them to its own. Hidden for
 * someone locked to a home branch — they only ever get their own rows anyway.
 */
export function BranchFilterToggle({ value, onChange }: { value: BranchFilter; onChange: (v: BranchFilter) => void }) {
  const { branches, branchLocked } = useBranch();
  if (branchLocked || branches.length < 2) return null;
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(v) => v && onChange(v)}
      data-testid="transport-branch-filter"
    >
      <ToggleGroupItem value="all" aria-label="Show all branches">All</ToggleGroupItem>
      {dipFirst(branches).map((b) => (
        <ToggleGroupItem key={b.id} value={b.id} aria-label={`Show ${b.short_name}`}>
          {b.short_name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** DIP (main) first, the way the team reads the branches. */
export function dipFirst<T extends { code: string }>(branches: T[]): T[] {
  return [...branches].sort((a, b) => (a.code === b.code ? 0 : a.code === "main" ? -1 : b.code === "main" ? 1 : a.code.localeCompare(b.code)));
}

export function matchesBranch(branchId: string | null | undefined, filter: BranchFilter): boolean {
  return filter === "all" || branchId === filter;
}

export function DirectionBadge({ direction }: { direction: string }) {
  return (
    <Badge variant="outline" className={cn("text-xs", DIRECTION_BADGE[direction])}>
      {directionLabel(direction)}
    </Badge>
  );
}

/** The household pin as a map link, or a warning that the van has nowhere to go. */
export function PinBadge({ lat, lng }: { lat: number | null | undefined; lng: number | null | undefined }) {
  if (lat == null || lng == null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" /> No home pin
      </span>
    );
  }
  const area = pinAreaLabel(lat, lng);
  return (
    <a
      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"
      href={mapsUrl(lat, lng)}
      target="_blank"
      rel="noreferrer"
    >
      <MapPin className="h-3 w-3" /> {area ?? "Pin"}
    </a>
  );
}

/** Whether a stop has a usable location (its own, or the household pin). */
export function stopHasPin(stop: BoardStop): boolean {
  return (stop.locationLat != null && stop.locationLng != null) || (stop.owner?.pin_lat != null && stop.owner?.pin_lng != null);
}

/** One dog on one run: the card every board shows. */
const STOP_BADGE_CLASS: Record<StopBadge, string> = {
  one_off: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
  moved_in: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800",
  vet: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 font-semibold",
  transfer: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800 font-semibold",
  cancelled: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
  moved: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800",
  paused: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  boarding: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-700",
  at_vet: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
};

export function StopBadgeView({ badge }: { badge: StopBadge | null }) {
  if (!badge) return null;
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", STOP_BADGE_CLASS[badge])} data-testid={`transport-stop-badge-${badge}`}>
      {BADGE_LABEL[badge]}
    </Badge>
  );
}

/** The vet leg's own line: "Arrive by 10:15 AM" / "Collect 2:00–3:00 PM" (AE vetCardLine). */
export function vetLine(stop: Pick<BoardStop, "purpose" | "deadlineMin" | "windowStartMin" | "windowEndMin" | "direction">): string | null {
  if (stop.purpose !== "vet") return null;
  if (stop.deadlineMin != null) return `Arrive at the vet by ${clock12(stop.deadlineMin)}`;
  if (stop.windowStartMin != null && stop.windowEndMin != null) {
    return `${stop.direction === "pickup" ? "Collect" : "Drop off"} ${clock12(stop.windowStartMin)}–${clock12(stop.windowEndMin)}`;
  }
  return null;
}

/** "Moved to 2026-11-08" → "Moved to Sun 8 Nov". */
export function readableDates(text: string): string {
  return text.replace(/\d{4}-\d{2}-\d{2}/g, (iso) => dayDate(iso));
}

/** "DIP → BB" for a branch move (AE's transfer card line). */
export function useTransferLabel(fromId: string | null | undefined, toId: string | null | undefined): string | null {
  const { branches } = useBranch();
  if (!fromId || !toId) return null;
  const name = (id: string) => branches.find((b) => b.id === id)?.short_name ?? "?";
  return `${name(fromId)} → ${name(toId)}`;
}

/** One dog on one run: the card every board shows. */
export function StopCard({
  stop,
  branchLabel,
  compact = false,
  date,
  dayNote,
}: {
  stop: BoardStop;
  branchLabel?: string | null;
  compact?: boolean;
  /** With a date, the household's day note can be edited from the card. */
  date?: string;
  dayNote?: string | null;
}) {
  const owner = stop.owner;
  const lat = stop.locationLat ?? owner?.pin_lat;
  const lng = stop.locationLng ?? owner?.pin_lng;
  const vet = vetLine(stop);
  const transfer = useTransferLabel(stop.transferFromBranchId, stop.transferToBranchId);
  // A regular's wider window (AE custom window): "flexible 6:00 AM – 9:00 AM".
  const flexible = stop.source === "regular" ? flexibleWindowLabel(stop.windowStartMin, stop.windowEndMin) : null;
  return (
    <div
      className={cn("rounded-md border bg-card p-2.5 text-sm space-y-1", stop.struck && "opacity-60")}
      data-testid="transport-stop-card"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("font-medium", stop.struck && "line-through")}>{stop.pet?.name ?? "Pet"}</span>
        <VaccineStatusBadge petId={stop.petId} variant={compact ? "dot" : "pill"} />
        {owner && (
          <Link to={`/customers/${owner.id}`} className={cn("text-muted-foreground hover:underline", stop.struck && "line-through")}>
            {ownerDisplayName(owner.first_name, owner.last_name)}
          </Link>
        )}
        {branchLabel && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {branchLabel}
          </Badge>
        )}
        <StopBadgeView badge={stop.badge} />
        {!stop.badge && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {SOURCE_LABEL[stop.source]}
          </Badge>
        )}
        {date && owner && !stop.struck && (
          <DayNoteButton date={date} direction={stop.direction} ownerId={owner.id} note={dayNote ?? null} />
        )}
      </div>
      {stop.struck && (
        <p className="text-xs text-red-700 dark:text-red-400" data-testid="transport-stop-struck">
          {readableDates(stop.struck)}
        </p>
      )}
      {vet && <p className="text-xs font-medium text-rose-700 dark:text-rose-400">{vet}</p>}
      {transfer && (
        <p className="text-xs font-medium text-teal-700 dark:text-teal-400" data-testid="transport-stop-transfer">
          Branch move · {transfer}
        </p>
      )}
      {flexible && <p className="text-xs text-muted-foreground">{flexible}</p>}
      {stop.badge === "moved_in" && stop.movedDate && (
        <p className="text-xs text-violet-700 dark:text-violet-400">Moved in from {readableDates(stop.movedDate)}</p>
      )}
      {dayNote?.trim() && (
        <p className="text-xs" data-testid="transport-stop-day-note">
          <span className="font-medium">Today: </span>
          {dayNote.trim()}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <PinBadge lat={lat} lng={lng} />
        {!compact && owner?.phone && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Phone className="h-3 w-3" /> {owner.phone}
          </span>
        )}
      </div>
      {stop.locationText && <p className="text-xs text-muted-foreground">This run: {stop.locationText}</p>}
      {!compact && owner?.transport_notes?.trim() && (
        <p className="text-xs">
          <span className="font-medium">Household: </span>
          {owner.transport_notes.trim()}
        </p>
      )}
      {!compact && stop.pet?.driver_note?.trim() && (
        <p className="text-xs">
          <span className="font-medium">Driver note: </span>
          {stop.pet.driver_note.trim()}
        </p>
      )}
      {!compact && stop.note?.trim() && (
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <StickyNote className="h-3 w-3 mt-0.5 shrink-0" /> {stop.note.trim()}
        </p>
      )}
    </div>
  );
}

/** "08:30" → "8:30 AM". */
export function formatRunTime(time: string | null | undefined): string {
  if (!time) return "—";
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** A request card's dogs, each with its vaccination status. */
export function RequestPetNames({
  rows,
  variant = "dot",
  className,
}: {
  rows: { transport_request_pet?: { pet_id: string; pets: { name: string } | null }[] | null }[];
  variant?: "dot" | "pill";
  className?: string;
}) {
  const pets = [
    ...new Map(
      rows.flatMap((r) => r.transport_request_pet ?? []).map((p) => [p.pet_id, p.pets?.name ?? ""] as const),
    ).entries(),
  ].filter(([, name]) => name);
  if (pets.length === 0) return <span className={className}>—</span>;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5", className)}>
      {pets.map(([petId, name], i) => (
        <span key={petId} className="inline-flex items-center gap-1">
          {name}
          <VaccineStatusBadge petId={petId} variant={variant} />
          {i < pets.length - 1 && <span className="text-muted-foreground">,</span>}
        </span>
      ))}
    </span>
  );
}
