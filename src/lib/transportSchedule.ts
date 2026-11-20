/**
 * Who needs a van on a day, from the raw rows `transport_day_demand` returns.
 *
 * The RPC returns one row per source (regular, one-off request, skip, daycare day
 * logged with PU/DO, boarding check-in/out). A dog on a weekday regular who is also
 * logged at daycare must show once, so rows are merged per pet + direction, keeping
 * the most deliberate source: a request beats a regular beats boarding beats daycare.
 *
 * Runs that are not happening stay, crossed out, as AE's schedule keeps them: the SQL
 * marks paused / boarding / at-the-vet regulars and cancelled vet legs as `struck`, and
 * here an approved cancel-day ("skip") or a move ("moved") strikes the regular or
 * one-off it covers. A run with any live source shows live; a run with only struck
 * sources shows struck. The Desk board drops struck stops; the Schedule and its
 * print show them with a badge.
 */

export type TransportDirection = "pickup" | "dropoff";
export type DemandSource = "request" | "regular" | "boarding" | "daycare" | "skip" | "moved";
type RunSource = Exclude<DemandSource, "skip" | "moved">;

export type DemandRow = {
  source: string;
  source_id: string;
  branch_id: string;
  owner_id: string;
  pet_id: string;
  direction: string;
  run_time: string | null;
  status: string;
  location_text: string | null;
  location_lat: number | null;
  location_lng: number | null;
  note: string | null;
  purpose?: string | null;
  kind?: string | null;
  deadline_min?: number | null;
  window_start_min?: number | null;
  window_end_min?: number | null;
  moved_date?: string | null;
  struck?: string | null;
  transfer_from_branch_id?: string | null;
  transfer_to_branch_id?: string | null;
};

/** What the Schedule shows next to a stop (AE's schedule badges). */
export type StopBadge = "one_off" | "moved_in" | "vet" | "transfer" | "cancelled" | "moved" | "paused" | "boarding" | "at_vet";

export type ScheduleStop = {
  key: string;
  petId: string;
  ownerId: string;
  branchId: string;
  direction: TransportDirection;
  /** "HH:MM", or null when nobody has set a time yet. */
  time: string | null;
  source: RunSource;
  /** Every live source that asked for this run, most deliberate first. */
  sources: RunSource[];
  sourceId: string;
  status: string;
  locationText: string | null;
  locationLat: number | null;
  locationLng: number | null;
  note: string | null;
  purpose: string;
  kind: string | null;
  deadlineMin: number | null;
  windowStartMin: number | null;
  windowEndMin: number | null;
  /** A move: the other date (moved in from / moved to). */
  movedDate: string | null;
  /** Why the run is not happening, or null when it is. */
  struck: string | null;
  badge: StopBadge | null;
  /** A branch move (purpose transfer): the branch the pet leaves and the one it goes to. */
  transferFromBranchId: string | null;
  transferToBranchId: string | null;
};

const PRIORITY: Record<RunSource, number> = {
  request: 0,
  regular: 1,
  boarding: 2,
  daycare: 3,
};

function badgeFor(row: DemandRow, struck: string | null): StopBadge | null {
  if (struck) {
    if (struck.startsWith("Moved")) return "moved";
    if (struck === "Paused") return "paused";
    if (struck === "Boarding") return "boarding";
    if (struck === "At the vet") return "at_vet";
    return "cancelled";
  }
  if (row.purpose === "vet") return "vet";
  if (row.purpose === "transfer") return "transfer";
  if (row.kind === "change") return "moved_in";
  if (row.source === "request") return "one_off";
  return null;
}

export function hhmm(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

export function mergeDemand(rows: DemandRow[]): ScheduleStop[] {
  // A trip to or from a vet clinic is its own stop: it never stands in for the dog's
  // home pickup or drop-off that day. (The drop-off home after the vet does.) A branch
  // move (DIP ↔ BB) is its own stop too: a cancel-day, move or boarding never strikes it.
  const keyOf = (r: DemandRow) =>
    r.purpose === "transfer"
      ? `${r.pet_id}|${r.direction}|transfer|${r.source_id}`
      : r.purpose === "vet" && (r.deadline_min != null || r.direction === "pickup")
        ? `${r.pet_id}|${r.direction}|vet|${r.source_id}`
        : `${r.pet_id}|${r.direction}`;
  // A cancel-day names the dog and the direction; it covers a cross-branch regular's leg
  // that day as well as a home run.
  const homeKey = (r: DemandRow) => `${r.pet_id}|${r.direction}`;
  const skipped = new Set(rows.filter((r) => r.source === "skip").map(keyOf));
  const skippedHome = new Set(rows.filter((r) => r.source === "skip").map(homeKey));
  const moved = new Map(rows.filter((r) => r.source === "moved").map((r) => [keyOf(r), r]));

  type Tagged = { row: DemandRow; struck: string | null };
  const byKey = new Map<string, Tagged[]>();
  for (const row of rows) {
    if (!(row.source in PRIORITY)) continue;
    const key = keyOf(row);
    let struck = row.struck ?? null;
    // A cancelled day or a move strikes the regular or one-off it covers — never the
    // move's own new run, and never boarding or daycare (changed on their bookings).
    if (!struck && (row.source === "regular" || (row.source === "request" && row.kind !== "change"))) {
      if (skipped.has(key) || (row.source === "regular" && row.purpose === "transfer" && skippedHome.has(homeKey(row)))) struck = "Cancelled";
      else if (moved.has(key)) struck = `Moved to ${moved.get(key)!.moved_date ?? "another day"}`;
    }
    byKey.set(key, [...(byKey.get(key) ?? []), { row, struck }]);
  }
  // A move whose original run isn't on the board this day still shows where it went.
  for (const [key, m] of moved) {
    if (!byKey.has(key)) byKey.set(key, [{ row: { ...m, source: "request" }, struck: `Moved to ${m.moved_date ?? "another day"}` }]);
  }

  const byPriority = (a: Tagged, b: Tagged) =>
    PRIORITY[a.row.source as RunSource] - PRIORITY[b.row.source as RunSource];

  const stops: ScheduleStop[] = [];
  for (const [key, tagged] of byKey) {
    const live = tagged.filter((t) => !t.struck).sort(byPriority);
    const list = live.length ? live : [...tagged].sort(byPriority);
    const { row: lead, struck } = list[0];
    stops.push({
      key,
      petId: lead.pet_id,
      ownerId: lead.owner_id,
      branchId: lead.branch_id,
      direction: lead.direction as TransportDirection,
      time: hhmm(list.find((t) => t.row.run_time)?.row.run_time),
      source: lead.source as RunSource,
      sources: [...new Set(list.map((t) => t.row.source))] as RunSource[],
      sourceId: lead.source_id,
      status: lead.status,
      locationText: lead.location_text,
      locationLat: lead.location_lat,
      locationLng: lead.location_lng,
      note: list.map((t) => t.row.note).find((n) => n?.trim()) ?? null,
      purpose: lead.purpose ?? "regular",
      kind: lead.kind ?? null,
      deadlineMin: lead.deadline_min ?? null,
      windowStartMin: lead.window_start_min ?? null,
      windowEndMin: lead.window_end_min ?? null,
      movedDate: lead.moved_date ?? null,
      struck: live.length ? null : struck,
      badge: badgeFor(lead, live.length ? null : struck),
      transferFromBranchId: lead.transfer_from_branch_id ?? null,
      transferToBranchId: lead.transfer_to_branch_id ?? null,
    });
  }
  return sortStops(stops);
}

/** Stops that are actually happening (what the boards count and show). */
export function liveStops<T extends { struck: string | null }>(stops: T[]): T[] {
  return stops.filter((s) => !s.struck);
}

export const BADGE_LABEL: Record<StopBadge, string> = {
  one_off: "One-off",
  moved_in: "Moved in",
  vet: "VET",
  transfer: "Branch move",
  cancelled: "Cancelled",
  moved: "Moved",
  paused: "Paused",
  boarding: "Boarding",
  at_vet: "At the vet",
};

/** Pickups before dropoffs, then by time (untimed last), then by key for a stable order. */
export function sortStops<T extends Pick<ScheduleStop, "direction" | "time" | "key">>(stops: T[]): T[] {
  return [...stops].sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === "pickup" ? -1 : 1;
    if (a.time !== b.time) {
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time < b.time ? -1 : 1;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** Stops grouped into time slots ("08:00", …, "No time set"), keeping stop order. */
export function groupByTime<T extends Pick<ScheduleStop, "time">>(stops: T[]): { label: string; stops: T[] }[] {
  const groups: { label: string; stops: T[] }[] = [];
  for (const stop of stops) {
    const label = stop.time ?? "No time set";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.stops.push(stop);
    else groups.push({ label, stops: [stop] });
  }
  return groups;
}

export const SOURCE_LABEL: Record<ScheduleStop["source"], string> = {
  request: "Request",
  regular: "Regular",
  boarding: "Boarding",
  daycare: "Daycare",
};

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Today's date in Dubai as YYYY-MM-DD, whatever the browser's timezone. */
export function dubaiToday(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(
    new Date(Date.now() + offsetDays * 86400000),
  );
}

export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, matching Postgres extract(dow). */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whether a regular is paused on a date. */
export function regularPausedOn(
  regular: { paused_from: string | null; paused_until: string | null },
  iso: string,
): boolean {
  if (!regular.paused_from || iso < regular.paused_from) return false;
  return !regular.paused_until || iso <= regular.paused_until;
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * How a regular's pause reads (AE's MasterStopCard): "Paused until 12 Nov" while it is
 * paused, "Paused 14 Nov – 20 Nov" / "Paused from 14 Nov" when it starts later, null
 * when the pause is over or there is none.
 */
export function pausedLabel(
  regular: { paused_from: string | null; paused_until: string | null },
  today: string,
): string | null {
  const { paused_from: from, paused_until: until } = regular;
  if (!from || (until && until < today)) return null;
  if (from <= today) return until ? `Paused until ${shortDate(until)}` : "Paused";
  return until ? `Paused ${shortDate(from)} – ${shortDate(until)}` : `Paused from ${shortDate(from)}`;
}

/** "6:00 AM" from minutes past midnight. */
export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function clockShort(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const hour12 = ((h + 11) % 12) + 1;
  return m ? `${hour12}:${String(m).padStart(2, "0")}` : String(hour12);
}

const meridiem = (min: number) => (Math.floor(min / 60) % 24 < 12 ? "AM" : "PM");

/** AE's windowLabel: "6–9 AM", "11 AM–1 PM", "6:30–8 AM". */
export function windowLabel(startMin: number, endMin: number): string {
  const end = endMin >= 1440 ? 1439 : endMin;
  if (meridiem(startMin) === meridiem(end)) return `${clockShort(startMin)}–${clockShort(endMin)} ${meridiem(end)}`;
  return `${clockShort(startMin)} ${meridiem(startMin)}–${clockShort(endMin)} ${meridiem(end)}`;
}

/**
 * A regular's own window, set on purpose (AE's customWindowLabel): "6–9 AM · flexible".
 * Null when it has none — then the booked hour slot is the window.
 */
export function flexibleWindowLabel(start: number | null | undefined, end: number | null | undefined): string | null {
  if (start == null || end == null) return null;
  return `${windowLabel(start, end)} · flexible`;
}

// ── Hour slots (AE transport_slots: "06-07AM" … "11-12PM", "12-1PM" … "8-9PM") ──

/** The start of the hour slot a "HH:MM" time falls in, in minutes; null when untimed. */
export function slotStartOf(time: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 : null;
}

/** AE's slot label for the hour starting at startMin: "07-08AM", "11-12PM", "1-2PM". */
export function slotLabelFor(startMin: number): string {
  const h = Math.floor(startMin / 60) % 24;
  const e = h + 1;
  if (h < 12) return `${String(h).padStart(2, "0")}-${String(e).padStart(2, "0")}${e === 12 ? "PM" : "AM"}`;
  const h12 = h === 12 ? 12 : h - 12;
  return `${h12}-${e - 12}PM`;
}

/** "HH:MM" as the "HH:00" a slot is stored as. */
export function slotTime(startMin: number): string {
  return `${String(Math.floor(startMin / 60)).padStart(2, "0")}:00`;
}

/**
 * The label a run shows, as AE's boards: its own flexible window when one is set,
 * otherwise the hour slot it is booked in. Null when nobody has set a time.
 */
export function runSlotLabel(
  time: string | null | undefined,
  windowStart?: number | null,
  windowEnd?: number | null,
): string | null {
  const flexible = flexibleWindowLabel(windowStart, windowEnd);
  if (flexible) return flexible;
  const start = slotStartOf(time);
  return start == null ? null : slotLabelFor(start);
}

export type SlotGroup<T> = { key: string; label: string; startMin: number | null; stops: T[] };

export const NO_SLOT_LABEL = "No slot time set";

/**
 * Stops grouped by hour slot (AE's ScheduleDayView groupBySlot), earliest first, with
 * the untimed ones last under "No slot time set".
 */
export function groupBySlot<T extends Pick<ScheduleStop, "time">>(stops: T[]): SlotGroup<T>[] {
  const map = new Map<string, SlotGroup<T>>();
  for (const stop of stops) {
    const start = slotStartOf(stop.time);
    const key = start == null ? "none" : String(start);
    const group = map.get(key) ?? { key, label: start == null ? NO_SLOT_LABEL : slotLabelFor(start), startMin: start, stops: [] };
    group.stops.push(stop);
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => (a.startMin ?? 9999) - (b.startMin ?? 9999));
}

export function directionLabel(direction: string): string {
  if (direction === "pickup") return "Pickup";
  if (direction === "dropoff") return "Drop-off";
  return "Pickup + drop-off";
}

// ── Boarding pauses (AE transportRegularStatus) ──

export type BoardingPauseReason = "boarding_check_in" | "boarding_check_out" | "boarding_mid_stay";
export type BoardingStay = { check_in_date: string; check_out_date: string; petIds: string[] };

/**
 * Which trip home a boarding stay pauses, the same rule `transport_day_demand` strikes
 * by. Check-in day: the drop-off (the dog stays). Check-out day: the pickup (it is
 * already here). Days between: both. A same-day stay pauses nothing.
 */
export function boardingPauseReason(
  date: string,
  checkIn: string,
  checkOut: string,
  direction: TransportDirection,
): BoardingPauseReason | null {
  if (!date || !checkIn || !checkOut || checkOut <= checkIn) return null;
  if (date < checkIn || date > checkOut) return null;
  if (date === checkIn) return direction === "dropoff" ? "boarding_check_in" : null;
  if (date === checkOut) return direction === "pickup" ? "boarding_check_out" : null;
  return "boarding_mid_stay";
}

export type BoardingClash = { petId: string; date: string; direction: TransportDirection; reason: BoardingPauseReason };

/** Each trip about to be booked that a boarding stay would pause (AE boardingClashes). */
export function boardingClashes(
  petIds: string[],
  dates: string[],
  directions: TransportDirection[],
  stays: BoardingStay[],
): BoardingClash[] {
  const clashes: BoardingClash[] = [];
  for (const petId of petIds) {
    for (const date of dates) {
      for (const direction of directions) {
        for (const stay of stays) {
          if (!stay.petIds.includes(petId)) continue;
          const reason = boardingPauseReason(date, stay.check_in_date, stay.check_out_date, direction);
          if (reason) {
            clashes.push({ petId, date, direction, reason });
            break;
          }
        }
      }
    }
  }
  return clashes;
}

// ── Branch moves (AE transportTransfer) ──

/**
 * The half of the day a branch move defaults to: going to BB is a drop-off, coming
 * back to DIP a pickup (AE defaultDirection). The van decides; this only sorts it.
 */
export function transferDefaultDirection(toBranchCode: string | null | undefined): TransportDirection {
  return toBranchCode === "main" ? "pickup" : "dropoff";
}
