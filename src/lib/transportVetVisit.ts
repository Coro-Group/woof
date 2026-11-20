/**
 * A vet visit: a pet taken from the branch to a vet clinic and (usually) back.
 * Ported from AE (api/_lib/transportVetVisit.js + src/lib/transportVetVisit.ts) so the
 * rules read the same in both apps.
 *
 * The legs are ordinary dated one-off transport_request rows (purpose 'vet'), so the
 * boards carry them like any one-off. What only a vet leg has:
 *   - The leg to the clinic is a DROP-OFF with an exact appointment, so it carries
 *     `deadline_min` — the appointment less the buffer, the latest the van may arrive.
 *   - The leg back is a PICKUP from the moment the vet says the pet is ready. It exists
 *     only once that moment is known; until then the visit says a return is owed.
 *   - Straight home is the pickup back plus a drop-off home. Owner collects is no leg back.
 */

export const VISIT_MODES = ["wait", "return_later", "admitted"] as const;
export const RETURN_TO = ["facility", "home", "owner_collects"] as const;
export type VisitMode = (typeof VISIT_MODES)[number];
export type ReturnTo = (typeof RETURN_TO)[number];

export const DEFAULT_BUFFER_MIN = 15;
/** A quick visit the driver waits through, when nobody said how long. */
export const DEFAULT_WAIT_MIN = 30;
/** How wide the board's window is for a vet leg. The deadline, not the window, is the rule. */
export const VET_WINDOW_MIN = 60;

export type VetVisit = {
  appointmentDate: string;
  appointmentTimeMin: number;
  arriveBufferMin: number;
  visitMode: VisitMode;
  expectedDurationMin: number | null;
  returnTo: ReturnTo;
  returnDate: string | null;
  readyTimeMin: number | null;
  homeWindowStartMin: number | null;
  homeWindowEndMin: number | null;
};

export type VetVisitInput = {
  appointmentDate?: string | null;
  appointmentTimeMin?: number | null;
  arriveBufferMin?: number | string | null;
  visitMode?: string | null;
  expectedDurationMin?: number | string | null;
  returnTo?: string | null;
  returnDate?: string | null;
  readyTimeMin?: number | string | null;
  homeWindowStartMin?: number | string | null;
  homeWindowEndMin?: number | string | null;
};

export type LegRole = "outbound" | "return" | "home";
export type Pending = "ready_time" | "return_date" | "home_window" | null;

export type VetLeg = {
  role: LegRole;
  direction: "pickup" | "dropoff";
  service_date: string;
  atClinic: boolean;
  deadline_min: number | null;
  window_start_min: number;
  window_end_min: number;
};

export class VetVisitError extends Error {}

const clamp = (m: number) => Math.max(0, Math.min(1439, Math.round(m)));
const isMinute = (m: unknown): m is number => Number.isInteger(m) && (m as number) >= 0 && (m as number) <= 1439;
const isDate = (d: unknown): d is string =>
  typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

/** "10:30" for a minute of the day. */
export function clockOf(min: number | null | undefined): string {
  if (min == null) return "";
  const m = clamp(min);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "10:30 AM" */
export function clock12(min: number | null | undefined): string {
  if (min == null) return "?";
  const h = Math.floor(min / 60);
  return `${((h + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "10:30" from an <input type="time"> → minutes, or null. */
export function timeToMinutes(value: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The latest the van may reach the clinic. */
export function deadlineOf(v: Pick<VetVisit, "appointmentTimeMin" | "arriveBufferMin">): number {
  return clamp(v.appointmentTimeMin - (v.arriveBufferMin ?? DEFAULT_BUFFER_MIN));
}

/** When the pet is ready to come back, or null while nobody knows. */
export function readyTimeOf(v: VetVisit): number | null {
  if (v.visitMode === "wait") return clamp(v.appointmentTimeMin + (v.expectedDurationMin ?? DEFAULT_WAIT_MIN));
  return v.readyTimeMin ?? null;
}

/** The day the pet comes back, or null on an admission with no discharge date yet. */
export function returnDateOf(v: VetVisit): string | null {
  if (v.visitMode === "admitted") return v.returnDate ?? null;
  return v.returnDate ?? v.appointmentDate;
}

/** Check what staff entered, and say plainly what is wrong. Returns the visit with defaults filled in. */
export function normaliseVisit(input: VetVisitInput): VetVisit {
  const v: VetVisit = {
    appointmentDate: String(input.appointmentDate ?? "").trim(),
    appointmentTimeMin: input.appointmentTimeMin == null ? (NaN as number) : Number(input.appointmentTimeMin),
    arriveBufferMin: input.arriveBufferMin == null || input.arriveBufferMin === "" ? DEFAULT_BUFFER_MIN : Number(input.arriveBufferMin),
    visitMode: input.visitMode as VisitMode,
    expectedDurationMin: numOrNull(input.expectedDurationMin),
    returnTo: (input.returnTo ?? "facility") as ReturnTo,
    returnDate: input.returnDate ? String(input.returnDate).trim() : null,
    readyTimeMin: numOrNull(input.readyTimeMin),
    homeWindowStartMin: numOrNull(input.homeWindowStartMin),
    homeWindowEndMin: numOrNull(input.homeWindowEndMin),
  };
  if (!isDate(v.appointmentDate)) throw new VetVisitError("Give the appointment date");
  if (!isMinute(v.appointmentTimeMin)) throw new VetVisitError("Give the appointment time");
  if (!Number.isInteger(v.arriveBufferMin) || v.arriveBufferMin < 0 || v.arriveBufferMin > 180) {
    throw new VetVisitError("Arrive-early must be between 0 and 180 minutes");
  }
  if (!(VISIT_MODES as readonly string[]).includes(v.visitMode)) throw new VetVisitError("Choose wait, return later or admitted");
  if (!(RETURN_TO as readonly string[]).includes(v.returnTo)) throw new VetVisitError("Choose where the pet goes after the vet");
  if (v.expectedDurationMin != null && (!Number.isInteger(v.expectedDurationMin) || v.expectedDurationMin < 0 || v.expectedDurationMin > 1439)) {
    throw new VetVisitError("The visit length is not a number of minutes");
  }
  if (v.readyTimeMin != null && !isMinute(v.readyTimeMin)) throw new VetVisitError("The ready time is not a time");
  if (v.returnDate != null && !isDate(v.returnDate)) throw new VetVisitError("The return date is not a date");
  if (v.returnDate && v.returnDate < v.appointmentDate) throw new VetVisitError("The pet cannot come back before it goes");
  if (v.visitMode === "wait") {
    // The driver waits: it comes back the same day, straight after.
    v.returnDate = null;
    v.readyTimeMin = null;
    if (v.returnTo === "owner_collects") {
      throw new VetVisitError("If the owner is collecting, the driver is not waiting — choose return later");
    }
  }
  if (v.visitMode === "return_later" && v.returnDate && v.returnDate !== v.appointmentDate) {
    throw new VetVisitError("A pet staying overnight is admitted, not a return later");
  }
  if (v.visitMode === "admitted" && v.returnDate === v.appointmentDate) {
    throw new VetVisitError("An admitted pet comes back on a later day");
  }
  if (v.returnTo !== "home") {
    v.homeWindowStartMin = null;
    v.homeWindowEndMin = null;
  } else if ((v.homeWindowStartMin == null) !== (v.homeWindowEndMin == null)) {
    throw new VetVisitError("Give both ends of the drop-off home window, or neither yet");
  } else if (v.homeWindowStartMin != null && v.homeWindowEndMin != null) {
    if (!isMinute(v.homeWindowStartMin) || !isMinute(v.homeWindowEndMin) || v.homeWindowEndMin <= v.homeWindowStartMin) {
      throw new VetVisitError("The drop-off home window is not a window");
    }
    if (v.homeWindowEndMin - v.homeWindowStartMin > VET_WINDOW_MIN) {
      throw new VetVisitError("The drop-off home window is wider than an hour");
    }
  }
  if (deadlineOf(v) < 6 * 60) throw new VetVisitError("That appointment is before the vans start");
  return v;
}

/**
 * The legs a visit needs right now. A return not yet known is not a leg; the result
 * says it is `pending` instead.
 */
export function legsForVisit(v: VetVisit): { legs: VetLeg[]; pending: Pending } {
  const legs: VetLeg[] = [];
  const deadline = deadlineOf(v);
  legs.push({
    role: "outbound",
    direction: "dropoff",
    service_date: v.appointmentDate,
    atClinic: true,
    deadline_min: deadline,
    window_start_min: clamp(deadline - VET_WINDOW_MIN),
    window_end_min: deadline,
  });

  let pending: Pending = null;
  if (v.returnTo !== "owner_collects") {
    const ready = readyTimeOf(v);
    const date = returnDateOf(v);
    if (ready == null || !date) {
      pending = !date ? "return_date" : "ready_time";
    } else {
      legs.push({
        role: "return",
        direction: "pickup",
        service_date: date,
        atClinic: true,
        deadline_min: null,
        window_start_min: ready,
        window_end_min: clamp(ready + VET_WINDOW_MIN),
      });
      if (v.returnTo === "home") {
        if (v.homeWindowStartMin == null || v.homeWindowEndMin == null) {
          pending = "home_window";
        } else {
          legs.push({
            role: "home",
            direction: "dropoff",
            service_date: date,
            atClinic: false,
            deadline_min: null,
            window_start_min: v.homeWindowStartMin,
            window_end_min: v.homeWindowEndMin,
          });
        }
      }
    }
  }
  return { legs, pending };
}

/** What is still owed on a visit, in words for the Desk. */
export function pendingLabel(pending: Pending): string | null {
  if (pending === "ready_time") return "Waiting for the vet to say when it is ready";
  if (pending === "return_date") return "Admitted — no discharge date yet";
  if (pending === "home_window") return "Back at the branch — drop-off home not timed yet";
  return null;
}

export const VISIT_MODE_LABEL: Record<VisitMode, string> = {
  wait: "Driver waits",
  return_later: "Drop and return later",
  admitted: "Admitted",
};

export const RETURN_TO_LABEL: Record<ReturnTo, string> = {
  facility: "Back to the branch",
  home: "Straight home",
  owner_collects: "Owner collects from the vet",
};

/** What the card and the driver read about a leg (AE's legNote). */
export function legNote(
  visit: Pick<VetVisit, "appointmentTimeMin" | "visitMode"> & { vetLabel: string; notes?: string | null },
  leg: Pick<VetLeg, "role" | "deadline_min" | "window_start_min">,
): string {
  if (leg.role === "outbound") {
    return (
      `VET · ${visit.vetLabel} · appointment ${clockOf(visit.appointmentTimeMin)} — arrive by ${clockOf(leg.deadline_min)}` +
      (visit.visitMode === "wait" ? " · driver waits" : "") +
      (visit.notes ? ` · ${visit.notes}` : "")
    );
  }
  if (leg.role === "return") {
    return `VET RETURN · collect from ${visit.vetLabel} from ${clockOf(leg.window_start_min)}` +
      (visit.visitMode === "wait" ? " · same driver, waiting" : "");
  }
  return `Home after the vet (${visit.vetLabel})`;
}

/** A stored visit row in the shape the rules read. */
export function visitFromRow(row: {
  appointment_date: string;
  appointment_time_min: number;
  arrive_buffer_min: number;
  visit_mode: string;
  expected_duration_min: number | null;
  return_to: string;
  return_date: string | null;
  ready_time_min: number | null;
  home_window_start_min: number | null;
  home_window_end_min: number | null;
}): VetVisit {
  return {
    appointmentDate: row.appointment_date,
    appointmentTimeMin: row.appointment_time_min,
    arriveBufferMin: row.arrive_buffer_min,
    visitMode: row.visit_mode as VisitMode,
    expectedDurationMin: row.expected_duration_min,
    returnTo: row.return_to as ReturnTo,
    returnDate: row.return_date,
    readyTimeMin: row.ready_time_min,
    homeWindowStartMin: row.home_window_start_min,
    homeWindowEndMin: row.home_window_end_min,
  };
}

/** The visit's columns for an insert or update. */
export function visitColumns(v: VetVisit) {
  return {
    appointment_date: v.appointmentDate,
    appointment_time_min: v.appointmentTimeMin,
    arrive_buffer_min: v.arriveBufferMin,
    visit_mode: v.visitMode,
    expected_duration_min: v.expectedDurationMin,
    return_to: v.returnTo,
    return_date: v.returnDate,
    ready_time_min: v.readyTimeMin,
    home_window_start_min: v.homeWindowStartMin,
    home_window_end_min: v.homeWindowEndMin,
  };
}
