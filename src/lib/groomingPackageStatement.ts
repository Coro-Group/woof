import { format, isValid, parse, parseISO } from "date-fns";

/** Grooming checkout writes this phrase onto the invoice line when a credit is used. */
const COVERED_BY = "base covered by";

export type CreditSlot = {
  id: string;
  unitsConsumed: number;
  /** ISO timestamp or yyyy-MM-dd. */
  purchaseDate: string;
};

export type PackageLineMatch = {
  petName: string;
  service: string;
  dateLabel: string | null;
};

export type GroomingPackageUsageRow = {
  date: string;
  petName: string;
  service: string;
  groomer: string;
  station: string;
  appointmentStatus: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  usedBy: string;
};

const CLOSED_APPOINTMENT = new Set([
  "cancelled",
  "canceled",
  "completed",
  "complete",
  "paid",
  "no_show",
  "noshow",
]);

export function formatStatementDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const day = iso.slice(0, 10);
  const parsed = parseISO(day);
  if (!isValid(parsed)) return iso;
  return format(parsed, "d MMM yyyy");
}

export function formatAed(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return `AED ${amount.toFixed(2)}`;
}

export function sessionsLeft(total: number, used: number): number {
  return Math.max(0, total - used);
}

export function groomingSoldPackageStatus(args: {
  sessionsUsed: number;
  sessionsTotal: number;
  expiryDate: string | null;
  today: string;
}): "Active" | "Exhausted" | "Expired" {
  if (args.sessionsTotal - args.sessionsUsed <= 0) return "Exhausted";
  const expiry = args.expiryDate?.slice(0, 10);
  if (expiry && expiry < args.today) return "Expired";
  return "Active";
}

export function unlinkedSessionCount(unitsConsumed: number, linkedVisits: number): number {
  return Math.max(0, unitsConsumed - linkedVisits);
}

function coveredByTail(description: string): string | null {
  const lower = description.toLowerCase();
  const idx = lower.lastIndexOf(COVERED_BY);
  if (idx < 0) return null;
  return description.slice(idx + COVERED_BY.length).trim();
}

function packageTail(tail: string): string {
  let value = tail.trim().toLowerCase();
  let open = 0;
  let close = 0;
  for (const char of value) {
    if (char === "(") open += 1;
    if (char === ")") close += 1;
  }
  while (close > open && value.endsWith(")")) {
    value = value.slice(0, -1).trimEnd();
    close -= 1;
  }
  return value;
}

function tailHasPackageName(tail: string, name: string): boolean {
  const packageName = name.trim().toLowerCase();
  if (!packageName) return false;
  const normalized = packageTail(tail);
  if (normalized === packageName) return true;
  if (!normalized.endsWith(packageName)) return false;
  const boundary = normalized.charAt(normalized.length - packageName.length - 1);
  return boundary === "" || !/[a-z0-9]/i.test(boundary);
}

export function parsePackageUseDateLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const cleaned = label.replace(/\(.*/, "").trim();
  if (!cleaned) return null;
  const parsed = parse(cleaned, "d MMM yyyy", new Date(2026, 0, 1));
  if (!isValid(parsed)) return null;
  return format(parsed, "yyyy-MM-dd");
}

/**
 * A grooming invoice line counts for this package when it says the base service
 * was covered by one of this package's names. Another pet counts only when the
 * credit is a shared pool.
 */
export function lineMatchesPackageUse(
  description: string,
  packageNames: string[],
  petName: string,
  allowsOtherPets: boolean,
): PackageLineMatch | null {
  const tail = coveredByTail(description);
  if (!tail) return null;
  const names = packageNames.map((name) => name.trim()).filter(Boolean);
  if (!names.some((name) => tailHasPackageName(tail, name))) return null;

  const parts = description.split("—").map((part) => part.trim());
  const service = parts[0]?.replace(/\(.*/, "").trim() || "Grooming";
  const namedPet = (parts[1] ?? "").replace(/\(.*/, "").trim();
  const dateLabel = parts.length >= 3 ? parts.slice(2).join("—").trim() : null;
  const expected = petName.trim();

  if (allowsOtherPets) {
    return {
      petName: namedPet || expected || "Pet",
      service,
      dateLabel,
    };
  }

  if (!expected || namedPet.toLowerCase() !== expected.toLowerCase()) return null;
  return { petName: expected, service, dateLabel };
}

function purchaseDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * When the same pet has more than one credit of this package, visits are
 * filled oldest-first into each credit up to the sessions that credit has
 * already consumed. A single credit keeps every matching visit.
 */
export function assignCoveredVisits<T extends { date: string }>(
  creditId: string,
  credits: CreditSlot[],
  visits: T[],
): T[] {
  const ordered = [...credits].sort(
    (a, b) => purchaseDay(a.purchaseDate).localeCompare(purchaseDay(b.purchaseDate)) || a.id.localeCompare(b.id),
  );
  const sortedVisits = [...visits].sort((a, b) => a.date.localeCompare(b.date));
  if (ordered.length <= 1) {
    const only = ordered[0];
    if (!only || only.id !== creditId) return [];
    return sortedVisits;
  }

  const remaining = new Map(ordered.map((credit) => [credit.id, credit.unitsConsumed]));
  const mine: T[] = [];
  for (const visit of sortedVisits) {
    const slot = ordered.find(
      (credit) => (remaining.get(credit.id) ?? 0) > 0 && visit.date >= purchaseDay(credit.purchaseDate),
    );
    if (!slot) continue;
    remaining.set(slot.id, (remaining.get(slot.id) ?? 0) - 1);
    if (slot.id === creditId) mine.push(visit);
  }
  return mine;
}

export function isUpcomingPackageAppointment(date: string, status: string, today: string): boolean {
  if (!date || date.slice(0, 10) < today) return false;
  const normalized = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized || normalized === "—") return true;
  return !CLOSED_APPOINTMENT.has(normalized);
}

export function mergePackageHistory(
  usage: GroomingPackageUsageRow[],
  adjustments: GroomingPackageUsageRow[],
): GroomingPackageUsageRow[] {
  return [...usage, ...adjustments].sort(
    (a, b) => a.date.localeCompare(b.date) || a.service.localeCompare(b.service),
  );
}
