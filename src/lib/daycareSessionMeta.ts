export type DaycareBillingPath = "single" | "hourly" | "train";

export const BILLING_PATH_PREFIX = "BILLING_PATH:";
export const HOURLY_INVOICED_PREFIX = "HOURLY_INVOICED:";
/**
 * Written at check-in for sibling sessions (not the primary) when a draft
 * invoice is created. Replaced by HOURLY_INVOICED once the invoice is finalised.
 */
export const HOURLY_DRAFT_PREFIX = "HOURLY_DRAFT:";

const META_LINE_PREFIXES = [BILLING_PATH_PREFIX, HOURLY_INVOICED_PREFIX, HOURLY_DRAFT_PREFIX, "COLLECTION_BY:"];

/** Strip internal metadata lines from notes shown in the UI. */
export function visibleDaycareNotes(notes: string | null | undefined): string {
  const raw = (notes ?? "").trim();
  if (!raw) return "";
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !META_LINE_PREFIXES.some((prefix) => line.startsWith(prefix)))
    .join("\n")
    .trim();
}

export function parseDaycareBillingPath(
  notes: string | null | undefined,
  packageId: string | null | undefined,
): DaycareBillingPath | "package" {
  if (packageId) return "package";
  const raw = (notes ?? "").trim();
  if (!raw) return "single";
  const marker = raw
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(BILLING_PATH_PREFIX));
  if (!marker) return "single";
  const value = marker.replace(BILLING_PATH_PREFIX, "").trim();
  if (value === "hourly") return "hourly";
  if (value === "train") return "train";
  return "single";
}

export function isHourlyBillingInvoiced(notes: string | null | undefined): boolean {
  const raw = (notes ?? "").trim();
  if (!raw) return false;
  return raw
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line.startsWith(HOURLY_INVOICED_PREFIX));
}

export function composeNotesWithHourlyInvoiced(
  notes: string | null | undefined,
  invoiceId: string,
): string | null {
  const cleaned = visibleDaycareNotes(notes);
  const meta = `${HOURLY_INVOICED_PREFIX}${invoiceId}`;
  const billingLine = (notes ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(BILLING_PATH_PREFIX));
  const parts = [cleaned, billingLine, meta].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : meta;
}

export function parseHourlyInvoicedId(notes: string | null | undefined): string | null {
  const raw = (notes ?? "").trim();
  if (!raw) return null;
  const marker = raw
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(HOURLY_INVOICED_PREFIX));
  if (!marker) return null;
  const id = marker.replace(HOURLY_INVOICED_PREFIX, "").trim();
  return id || null;
}

/**
 * Resolve invoice id for a daycare session.
 * Checks (in priority order):
 *  1. Direct service_id link (primary session of any invoice)
 *  2. HOURLY_INVOICED marker (finalised family billing)
 *  3. HOURLY_DRAFT marker (draft invoice created at check-in)
 */
export function resolveDaycareSessionInvoiceId(
  sessionId: string,
  notes: string | null | undefined,
  invoiceIdByServiceId: Map<string, string>,
): string | null {
  const fromService = invoiceIdByServiceId.get(sessionId);
  if (fromService) return fromService;
  const fromInvoiced = parseHourlyInvoicedId(notes);
  if (fromInvoiced) return fromInvoiced;
  return parseHourlyDraftId(notes);
}

export type DaycareSessionInvoiceLinkInput = {
  id: string;
  owner_id: string;
  session_date: string;
  notes: string | null | undefined;
  package_id: string | null | undefined;
};

/**
 * Extends the service_id-only invoice map so same-day single-day siblings
 * (checked in on one batch invoice) resolve to the primary session's invoice.
 */
export function enrichDaycareSessionInvoiceMap(
  sessions: DaycareSessionInvoiceLinkInput[],
  primaryMap: Map<string, string>,
): Map<string, string> {
  const map = new Map(primaryMap);
  const singleDayInvoiceByOwnerDate = new Map<string, string>();

  for (const session of sessions) {
    const invoiceId = primaryMap.get(session.id);
    if (!invoiceId) continue;
    const path = parseDaycareBillingPath(session.notes, session.package_id ?? null);
    if (path !== "single" && path !== "train") continue;
    singleDayInvoiceByOwnerDate.set(`${session.owner_id}:${session.session_date}:${path}`, invoiceId);
  }

  for (const session of sessions) {
    if (map.has(session.id)) continue;
    const path = parseDaycareBillingPath(session.notes, session.package_id ?? null);
    if (path !== "single" && path !== "train") continue;
    const invoiceId = singleDayInvoiceByOwnerDate.get(`${session.owner_id}:${session.session_date}:${path}`);
    if (invoiceId) map.set(session.id, invoiceId);
  }

  return map;
}

export type DaycareSessionBillingFlags = {
  sessionId: string;
  notes: string | null | undefined;
  packageId: string | null | undefined;
  checkedIn: boolean;
};

/**
 * Returns true when an hourly session still needs billing to be completed (finalised).
 * True for both "no invoice yet" (legacy) and "has a draft invoice" (needs hours entered).
 * False once the invoice is finalised (HOURLY_INVOICED marker or service_id invoice present
 * and that invoice is assumed finalised by callers that have already filtered it).
 *
 * The `invoiceIdByServiceId` parameter is kept for backward compatibility but is no longer
 * the primary signal — HOURLY_INVOICED is the canonical "done" marker on all sessions.
 */
export function isDaycareHourlyPending(
  session: DaycareSessionBillingFlags,
  _invoiceIdByServiceId: Map<string, string>,
): boolean {
  if (!session.checkedIn) return false;
  if (parseDaycareBillingPath(session.notes, session.packageId) !== "hourly") return false;
  // HOURLY_INVOICED means the invoice has been finalised — billing complete.
  if (isHourlyBillingInvoiced(session.notes)) return false;
  return true;
}

/** Single-day paid path expects an invoice at check-in. */
export function isSingleDayInvoiceMissing(
  session: DaycareSessionBillingFlags,
  invoiceIdByServiceId: Map<string, string>,
): boolean {
  if (!session.checkedIn) return false;
  const path = parseDaycareBillingPath(session.notes, session.packageId);
  if (path !== "single" && path !== "train") return false;
  return !resolveDaycareSessionInvoiceId(session.sessionId, session.notes, invoiceIdByServiceId);
}

export function composeNotesWithBillingPath(
  notes: string | null | undefined,
  billingPath: DaycareBillingPath,
): string | null {
  const cleaned = visibleDaycareNotes(notes);
  const meta = `${BILLING_PATH_PREFIX}${billingPath}`;
  return cleaned ? `${cleaned}\n${meta}` : meta;
}

/** Remove hourly-invoiced marker for a deleted invoice; keeps billing path and visible notes. */
export function clearHourlyInvoicedFromNotes(
  notes: string | null | undefined,
  invoiceId: string,
): string | null {
  const raw = (notes ?? "").trim();
  if (!raw) return null;
  const markerPrefix = `${HOURLY_INVOICED_PREFIX}${invoiceId}`;
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(markerPrefix));
  return lines.length > 0 ? lines.join("\n") : null;
}

// ── HOURLY_DRAFT helpers ──────────────────────────────────────────────────────

export function isHourlyBillingDraft(notes: string | null | undefined): boolean {
  const raw = (notes ?? "").trim();
  if (!raw) return false;
  return raw
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line.startsWith(HOURLY_DRAFT_PREFIX));
}

export function parseHourlyDraftId(notes: string | null | undefined): string | null {
  const raw = (notes ?? "").trim();
  if (!raw) return null;
  const marker = raw
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(HOURLY_DRAFT_PREFIX));
  if (!marker) return null;
  const id = marker.replace(HOURLY_DRAFT_PREFIX, "").trim();
  return id || null;
}

/** Append HOURLY_DRAFT:{invoiceId} to notes, preserving billing path and visible text. */
export function composeNotesWithHourlyDraft(
  notes: string | null | undefined,
  invoiceId: string,
): string | null {
  const cleaned = visibleDaycareNotes(notes);
  const meta = `${HOURLY_DRAFT_PREFIX}${invoiceId}`;
  const billingLine = (notes ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(BILLING_PATH_PREFIX));
  const parts = [cleaned, billingLine, meta].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : meta;
}

/** Remove HOURLY_DRAFT:{invoiceId} from notes. */
export function clearHourlyDraftFromNotes(
  notes: string | null | undefined,
  invoiceId: string,
): string | null {
  const raw = (notes ?? "").trim();
  if (!raw) return null;
  const markerPrefix = `${HOURLY_DRAFT_PREFIX}${invoiceId}`;
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(markerPrefix));
  return lines.length > 0 ? lines.join("\n") : null;
}

export type HourlyInvoiceLineIdentity = {
  description: string;
  quantity: number;
  pricingKey: string | null;
};

/** True when this session was already finalised onto this invoice. */
export function sessionNotesHaveHourlyInvoice(
  notes: string | null | undefined,
  invoiceId: string,
): boolean {
  return parseHourlyInvoicedId(notes) === invoiceId;
}

/**
 * Drop a candidate hourly line when the same invoice already has that
 * description, pricing key, and quantity. A second check-out must not add it again.
 */
export function isDuplicateHourlyInvoiceLine(
  existing: ReadonlyArray<{
    description?: string | null;
    quantity?: number | string | null;
    pricingKey?: string | null;
  }>,
  candidate: HourlyInvoiceLineIdentity,
): boolean {
  return existing.some(
    (line) =>
      (line.pricingKey ?? null) === (candidate.pricingKey ?? null) &&
      (line.description ?? "") === candidate.description &&
      Number(line.quantity) === Number(candidate.quantity),
  );
}

/**
 * Replace HOURLY_DRAFT:{invoiceId} with HOURLY_INVOICED:{invoiceId} in a session's notes.
 * Used when the draft invoice is finalised.
 */
export function upgradeHourlyDraftToInvoiced(
  notes: string | null | undefined,
  invoiceId: string,
): string | null {
  const raw = (notes ?? "").trim();
  if (!raw) return composeNotesWithHourlyInvoiced(notes, invoiceId);
  const draftMarker = `${HOURLY_DRAFT_PREFIX}${invoiceId}`;
  const invoicedMarker = `${HOURLY_INVOICED_PREFIX}${invoiceId}`;
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .map((line) => (line === draftMarker ? invoicedMarker : line))
    .filter(Boolean);
  // If draft marker wasn't present, just append HOURLY_INVOICED
  if (!lines.includes(invoicedMarker)) {
    lines.push(invoicedMarker);
  }
  return lines.join("\n");
}
