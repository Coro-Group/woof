/** Header label when one open invoice holds more than one same-day service. */
export const MULTIPLE_SERVICES_LABEL = "Multiple services";

/** Unpaid invoices a new same-day line may join. Paid and partially paid stay closed. */
export const OPEN_SAME_DAY_INVOICE_STATUSES = ["draft", "outstanding"] as const;

const DAYCARE_SERVICE_TYPES = new Set(["daycare", "daycare_hourly_placeholder"]);

export type SameDayInvoiceCandidate = {
  id: string;
  status: string;
  amount_paid: number | null;
  service_type: string | null;
  due_date: string | null;
  booking_id?: string | null;
  receipt_only?: boolean | null;
};

/** Boarding stays on its own invoice. Package purchases and memberships stay separate. */
export function isSeparateInvoiceService(serviceType: string | null | undefined): boolean {
  if (!serviceType) return true;
  const value = serviceType.toLowerCase();
  if (value === "boarding" || value === "membership") return true;
  if (value.includes("package")) return true;
  return false;
}

export function isSameDayMergeableService(serviceType: string | null | undefined): boolean {
  return !isSeparateInvoiceService(serviceType);
}

function canonicalService(serviceType: string | null | undefined): string | null {
  if (!serviceType) return null;
  if (serviceType === MULTIPLE_SERVICES_LABEL) return MULTIPLE_SERVICES_LABEL;
  if (DAYCARE_SERVICE_TYPES.has(serviceType)) return "daycare";
  return serviceType;
}

export function serviceDateKey(value: string | null | undefined): string {
  return (value ?? "").slice(0, 10);
}

/**
 * An existing invoice can receive today's new lines only while it is still
 * open, unpaid, and not a boarding or package invoice for that service date.
 */
export function isOpenSameDayMergeTarget(
  invoice: SameDayInvoiceCandidate,
  serviceDate: string,
): boolean {
  if (!(OPEN_SAME_DAY_INVOICE_STATUSES as readonly string[]).includes(invoice.status)) return false;
  if ((invoice.amount_paid ?? 0) > 0) return false;
  if (invoice.receipt_only) return false;
  if (invoice.booking_id) return false;
  if (isSeparateInvoiceService(invoice.service_type)) return false;
  if (serviceDateKey(invoice.due_date) !== serviceDate) return false;
  return true;
}

export function pickOpenSameDayInvoice<T extends SameDayInvoiceCandidate>(
  candidates: T[],
  serviceDate: string,
): T | null {
  return candidates.find((invoice) => isOpenSameDayMergeTarget(invoice, serviceDate)) ?? null;
}

/** Keep a single-service header. Rename only when a different service is added. */
export function headerServiceTypeForMerge(
  current: string | null | undefined,
  incomingServiceType: string,
): string {
  if (current === MULTIPLE_SERVICES_LABEL) return MULTIPLE_SERVICES_LABEL;
  const currentCanon = canonicalService(current);
  const incomingCanon = canonicalService(incomingServiceType);
  if (!currentCanon) return incomingCanon ?? incomingServiceType;
  if (!incomingCanon) return current ?? incomingServiceType;
  if (currentCanon !== incomingCanon) return MULTIPLE_SERVICES_LABEL;
  return currentCanon;
}

export type ServiceLineMatch = {
  service_type: string | null;
  description: string | null;
};

/**
 * Price sync must update the grooming line. On a combined invoice the first
 * line is often daycare, and that line must stay untouched.
 */
export function pickInvoiceLineForService<T extends ServiceLineMatch>(
  lines: T[],
  serviceType: string,
  expectedDescription: string,
): T | null {
  const exact = lines.find((line) => line.description === expectedDescription);
  if (exact) return exact;
  const typed = lines.filter((line) => line.service_type === serviceType);
  if (typed.length === 1) return typed[0];
  if (lines.length === 1 && (lines[0].service_type == null || lines[0].service_type === serviceType)) {
    return lines[0];
  }
  return null;
}
