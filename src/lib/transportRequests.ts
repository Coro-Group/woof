/**
 * Transport requests as admin-essentials (AE) shows them.
 *
 * A request is stored as rows of one direction for one date (a one-off, or a cancelled
 * day) or one weekday (a new regular, a regular's ending, a pause). Rows recorded
 * together share a group_id and show as one card, like AE's collapsed inbox cards.
 */

export type RequestKind = "one_off" | "new_recurring" | "cancel" | "pause" | "change";
export type RequestStatus = "received" | "offered" | "approved" | "rejected" | "cancelled";

/** Still to act on: recorded, or offered and waiting on the customer (AE's inbox). */
export function isOpenStatus(status: string | null | undefined): boolean {
  return status === "received" || status === "offered";
}
export type Tone = "good" | "warn" | "critical" | "info" | "neutral";

export type RequestRowLike = {
  id: string;
  group_id: string;
  branch_id: string;
  owner_id: string;
  kind: string;
  cadence: string | null;
  direction: string;
  service_date: string | null;
  weekday: number | null;
  starts_on: string | null;
  ends_on: string | null;
  paused_from: string | null;
  paused_until: string | null;
  status: string;
  notes: string | null;
  rejection_reason: string | null;
  location_text: string | null;
  created_at: string;
  decided_at: string | null;
  purpose?: string | null;
  from_date?: string | null;
  needs_review?: boolean | null;
  review_reason?: string | null;
  window_start_min?: number | null;
  owners?: { first_name: string; last_name: string | null; phone?: string | null } | null;
  transport_request_pet?: { pet_id: string; pets: { name: string } | null }[];
  transport_slots?: { label: string; start_min: number; end_min: number } | null;
};

export type RequestCard<R extends RequestRowLike = RequestRowLike> = {
  groupId: string;
  lead: R;
  rows: R[];
  kind: RequestKind;
  cadence: "one_off" | "regular" | null;
  status: RequestStatus;
  branchId: string;
  petNames: string[];
  ownerName: string;
  directions: ("pickup" | "dropoff")[];
  dates: string[];
  weekdays: number[];
  createdAt: string;
};

export const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const TONE_BADGE: Record<Tone, string> = {
  good: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  warn: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  critical: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800",
  info: "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800",
  neutral: "bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700",
};

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  critical: "text-red-700 dark:text-red-400",
  info: "text-sky-700 dark:text-sky-400",
  neutral: "text-muted-foreground",
};

export function statusLabel(status: string): string {
  return { received: "Received", offered: "Offered", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" }[status] ?? status;
}

export function statusTone(status: string): Tone {
  return ({ received: "warn", offered: "info", approved: "good", rejected: "warn", cancelled: "neutral" } as Record<string, Tone>)[status] ?? "neutral";
}

/** AE's ask badge: addition vs cancellation vs pause. */
export function kindLabel(kind: string, purpose?: string | null): string {
  if (purpose === "vet") return "Vet visit";
  if (purpose === "transfer") return "Branch move";
  if (kind === "change") return "Move";
  if (kind === "cancel") return "Cancellation";
  if (kind === "pause") return "Pause";
  return "Addition";
}

export function kindTone(kind: string, purpose?: string | null): Tone {
  if (purpose === "vet" || purpose === "transfer") return "info";
  if (kind === "change") return "warn";
  if (kind === "cancel") return "critical";
  if (kind === "pause") return "warn";
  return "good";
}

/** Weekly asks are named by weekdays; the rest by dates. */
export function isWeeklyKind(kind: string, cadence: string | null): boolean {
  return kind === "new_recurring" || kind === "pause" || (kind === "cancel" && cadence === "regular");
}

/** "20 Oct" */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Tue 3 Nov" */
export function dayDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${SHORT_DAYS[d.getUTCDay()]} ${shortDate(iso)}`;
}

/** The day after an ISO date, so "Add another day" lands on the next one. */
export function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function minutesToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function groupRequests<R extends RequestRowLike>(rows: R[]): RequestCard<R>[] {
  const groups = new Map<string, R[]>();
  for (const row of rows) groups.set(row.group_id, [...(groups.get(row.group_id) ?? []), row]);
  return [...groups.values()].map((list) => {
    const lead = list[0];
    const petNames = [...new Set(list.flatMap((r) => (r.transport_request_pet ?? []).map((p) => p.pets?.name ?? "")).filter(Boolean))];
    const owner = lead.owners;
    return {
      groupId: lead.group_id,
      lead,
      rows: list,
      kind: lead.kind as RequestKind,
      cadence: (lead.cadence as RequestCard["cadence"]) ?? null,
      // A card answered together has one status; a part-answered card shows the open part.
      status: (list.some((r) => r.status === "received")
        ? "received"
        : list.some((r) => r.status === "offered")
          ? "offered"
          : lead.status) as RequestStatus,
      branchId: lead.branch_id,
      petNames,
      ownerName: owner ? `${owner.first_name} ${owner.last_name ?? ""}`.trim() : "",
      directions: (["pickup", "dropoff"] as const).filter((d) => list.some((r) => r.direction === d)),
      dates: [...new Set(list.map((r) => r.service_date).filter((d): d is string => !!d))].sort(),
      weekdays: [...new Set(list.map((r) => r.weekday).filter((w): w is number => w != null))].sort((a, b) => a - b),
      createdAt: list.reduce((min, r) => (r.created_at < min ? r.created_at : min), lead.created_at),
    };
  });
}

function slotText<R extends RequestRowLike>(card: RequestCard<R>, direction: "pickup" | "dropoff"): string | null {
  return card.rows.find((r) => r.direction === direction && r.transport_slots)?.transport_slots?.label ?? null;
}

/** The second line of a card: what, when, and at what hour. */
export function cardSummary<R extends RequestRowLike>(card: RequestCard<R>): string {
  const legs = card.directions
    .map((d) => {
      const name = d === "pickup" ? "Pickup" : "Drop-off";
      const slot = card.kind === "one_off" || card.kind === "new_recurring" || card.kind === "change" ? slotText(card, d) : null;
      return slot ? `${name} ${slot}` : name;
    })
    .join(" + ");
  const days = card.weekdays.map((w) => SHORT_DAYS[w]).join(", ");
  const dates = card.dates.map(dayDate).join(", ");
  const lead = card.lead;
  switch (card.kind) {
    case "new_recurring":
      return `${legs} · every ${days}${lead.starts_on ? ` from ${shortDate(lead.starts_on)}` : ""}`;
    case "pause":
      return `Pause ${legs.toLowerCase()} · ${days} · ${shortDate(lead.paused_from)} – ${shortDate(lead.paused_until)}, then runs again`;
    case "cancel":
      return card.cadence === "regular"
        ? `End regular ${legs.toLowerCase()} · ${days} · last day ${shortDate(lead.ends_on)}`
        : `Cancel ${legs.toLowerCase()} · ${dates}`;
    case "change":
      return `Move ${legs.toLowerCase()} · ${dayDate(lead.from_date)} → ${dates}`;
    default:
      if (lead.purpose === "transfer") return `Branch move · ${dates}`;
      if (lead.purpose === "vet") return `${card.directions.map((d) => (d === "pickup" ? "Pickup" : "Drop-off")).join(" + ")} · ${dates}`;
      return `${legs} · ${dates}`;
  }
}

/** Untimed additions still owe an hour (AE: "Time not set"). */
export function cardNeedsTime<R extends RequestRowLike>(card: RequestCard<R>): boolean {
  return (
    (card.kind === "one_off" || card.kind === "new_recurring" || card.kind === "change") &&
    card.rows.some((r) => !r.transport_slots && r.window_start_min == null)
  );
}

export function cardMatches<R extends RequestRowLike>(card: RequestCard<R>, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const hay = [card.ownerName, ...card.petNames, card.lead.owners?.phone ?? "", ...card.rows.map((r) => r.notes ?? "")]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export type InboxSort = "arrival" | "transport";

export const INBOX_SORTS: { value: InboxSort; label: string }[] = [
  { value: "arrival", label: "Newest request first" },
  { value: "transport", label: "Earliest transport first" },
];

/** First day the card touches; weekly asks use their start/pause/end date. Null sorts last. */
export function cardFirstDate<R extends RequestRowLike>(card: RequestCard<R>): string | null {
  if (card.dates.length) return card.dates[0];
  return card.lead.starts_on ?? card.lead.paused_from ?? card.lead.ends_on ?? null;
}

export function sortInbox<R extends RequestRowLike>(cards: RequestCard<R>[], sort: InboxSort): RequestCard<R>[] {
  return [...cards].sort((a, b) => {
    if (sort === "arrival") return b.createdAt.localeCompare(a.createdAt);
    const da = cardFirstDate(a), db = cardFirstDate(b);
    if (da === db) return b.createdAt.localeCompare(a.createdAt);
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  });
}

/** The Dubai calendar day an ISO timestamp falls on. */
export function dubaiDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(iso));
}

/**
 * Missed: the transport date came and went before we answered. A dated addition is
 * missed if it is still unanswered after its day, or was approved/rejected only after
 * its day. Answered in time is never missed; withdrawn (entered by mistake) is not.
 */
export function rowMissed(row: RequestRowLike, today: string): boolean {
  if (row.kind !== "one_off" || !row.service_date) return false;
  if (isOpenStatus(row.status)) return row.service_date < today;
  if (row.status === "approved" || row.status === "rejected") {
    return !!row.decided_at && dubaiDay(row.decided_at) > row.service_date;
  }
  return false;
}

/** How late an answer came, in days after the requested date (0 if not answered). */
export function daysLate(row: RequestRowLike): number {
  if (!row.decided_at || !row.service_date) return 0;
  const a = new Date(`${row.service_date}T12:00:00Z`).getTime();
  const b = new Date(`${dubaiDay(row.decided_at)}T12:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Kept for the Inbox: an unanswered addition whose every day has already gone. */
export function cardMissed<R extends RequestRowLike>(card: RequestCard<R>, today: string): boolean {
  return isOpenStatus(card.status) && card.rows.every((r) => rowMissed(r, today));
}

export const REJECT_REASONS = [
  "Doesn't want this time",
  "No capacity",
  "Cancellation",
  "Not a transport request",
  "Wrong customer",
  "Already arranged themselves",
] as const;

/** The first date on or after `fromIso` that falls on `weekday` (0 = Sunday): where a new regular is quoted. */
export function nextDateForWeekday(weekday: number, fromIso: string): string {
  const start = new Date(`${fromIso}T12:00:00Z`);
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start.getTime() + i * 86400000);
    if (day.getUTCDay() === weekday) return day.toISOString().slice(0, 10);
  }
  return fromIso;
}
