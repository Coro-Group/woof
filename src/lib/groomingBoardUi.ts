import { format, parseISO } from "date-fns";
import type { Database } from "@/integrations/supabase/types";
import {
  activeLinkedStayLabel,
  type GroomingStayLinkInfo,
} from "@/lib/groomingBookingLinkSearch";
import { normalizeGroomingWorkflowStatus } from "@/lib/groomingWorkflow";

export type GroomingLinkedBookingInfo = GroomingStayLinkInfo;

export { activeLinkedStayLabel };

/** Left border accent per station column (no colour on grooming_stations table). */
export const STATION_ACCENT_CLASSES = [
  "border-l-blue-500",
  "border-l-violet-500",
  "border-l-teal-500",
  "border-l-orange-500",
  "border-l-rose-500",
  "border-l-cyan-500",
  "border-l-amber-500",
  "border-l-indigo-500",
] as const;

export function stationAccentClass(stationIndex: number): string {
  return STATION_ACCENT_CLASSES[stationIndex % STATION_ACCENT_CLASSES.length];
}

export function groomingStatusBadgeClass(status: string): string {
  const n = normalizeGroomingWorkflowStatus(status);
  switch (n) {
    case "new":
      return "bg-blue-100 text-blue-900 border-blue-300";
    case "checked_in":
      return "bg-indigo-100 text-indigo-900 border-indigo-300";
    case "in_progress":
      return "bg-amber-100 text-amber-950 border-amber-300";
    case "completed":
      return "bg-green-100 text-green-900 border-green-300";
    case "paid":
      return "bg-emerald-100 text-emerald-950 border-emerald-400";
    case "cancelled":
      return "bg-gray-100 text-gray-600 border-gray-300";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function formatMustFinishBy(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), "EEE d MMM, h:mm a");
  } catch {
    return null;
  }
}

/** Floating job is due soon when within 48h of must_finish_by. */
export function isGroomingDueSoon(mustFinishBy: string | null | undefined): boolean {
  if (!mustFinishBy) return false;
  try {
    const deadline = parseISO(mustFinishBy).getTime();
    const now = Date.now();
    const fortyEightHoursMs = 48 * 60 * 60 * 1000;
    return now >= deadline - fortyEightHoursMs;
  } catch {
    return false;
  }
}

export function clockMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = time.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Display-only. Stored times stay 24-hour. */
export function formatClock12(time: string | null | undefined): string {
  const minutes = clockMinutes(time);
  if (minutes == null) return "—";
  return formatMinutes12(minutes);
}

export function formatMinutes12(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours24 = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** Hour labels on the day axis, e.g. "8 AM". */
export function formatHourTick(totalMinutes: number): string {
  const hours24 = Math.floor((((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)) / 60);
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12} ${suffix}`;
}

export function formatTimeRange(
  startTime: string | null,
  durationMinutes: number | null | undefined,
): string {
  const startMin = clockMinutes(startTime);
  if (startMin == null) return "—";
  const dur = durationMinutes ?? 60;
  return `${formatMinutes12(startMin)} – ${formatMinutes12(startMin + dur)}`;
}

export function shortOwnerName(first: string | null | undefined, last: string | null | undefined): string {
  const firstName = first?.trim() ?? "";
  const lastName = last?.trim() ?? "";
  if (firstName && lastName) return `${firstName.charAt(0).toUpperCase()}. ${lastName}`;
  return firstName || lastName || "—";
}

export function nextFreeSlotMinutes(
  blocks: { startMin: number; durationMin: number }[],
  dayStartMin: number,
  dayEndMin: number,
  minGap = 15,
): number | null {
  const sorted = [...blocks]
    .filter((block) => block.durationMin > 0)
    .sort((a, b) => a.startMin - b.startMin);
  let cursor = dayStartMin;
  for (const block of sorted) {
    if (block.startMin - cursor >= minGap) return cursor;
    cursor = Math.max(cursor, block.startMin + block.durationMin);
  }
  if (dayEndMin - cursor >= minGap) return cursor;
  return null;
}

export function petSizeLabel(size: string | null | undefined): string {
  if (!size) return "";
  return size.charAt(0).toUpperCase() + size.slice(1);
}

export function invoiceCoveredByPackage(
  lines: { description?: string | null }[] | null | undefined,
): boolean {
  return (lines ?? []).some((line) => /covered by/i.test(line.description ?? ""));
}

export function groomingBoardPaymentLabel(args: {
  status: string;
  payment_method: string | null | undefined;
  invoice_status?: string | null;
  coveredByPackage?: boolean;
}): string {
  if (args.coveredByPackage) return "Package";
  const workflow = normalizeGroomingWorkflowStatus(args.status);
  if (workflow === "paid" || args.invoice_status === "paid") return "Paid";
  if (args.payment_method === "complimentary") return "Complimentary";
  return "Unpaid";
}

export function groomingBoardPaymentBadgeClass(args: {
  status: string;
  payment_method: string | null | undefined;
  invoice_status?: string | null;
  coveredByPackage?: boolean;
}): string {
  const label = groomingBoardPaymentLabel(args);
  if (label === "Paid" || label === "Complimentary") {
    return "border-emerald-300 bg-emerald-50 text-emerald-900";
  }
  if (label === "Partially paid") {
    return "border-amber-300 bg-amber-50 text-amber-950";
  }
  if (label === "Package") {
    return "border-violet-300 bg-violet-50 text-violet-950";
  }
  if (label === "Unpaid") {
    return "border-rose-300 bg-rose-50 text-rose-900";
  }
  return "border-border bg-muted/40 text-muted-foreground";
}

export function groomingCardGroomerLabel(args: {
  groomerId: string | null | undefined;
  groomingNotes: string | null | undefined;
  staffNameById?: ReadonlyMap<string, string>;
}): string {
  if (args.groomerId) {
    const assigned = args.staffNameById?.get(args.groomerId);
    if (assigned) return assigned;
  }
  const notes = args.groomingNotes?.trim();
  if (notes) return notes;
  return "—";
}
