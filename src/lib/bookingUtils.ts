import type { SupabaseClient } from "@supabase/supabase-js";
import { differenceInCalendarDays, addDays, format, parseISO } from "date-fns";
import { getSupabase } from "@/lib/supabaseRuntime";
import type { Database } from "@/integrations/supabase/types";
import type { BillingBreakdown, LineItem, ServiceType } from "@/hooks/useBilling";
import { buildBoardingNightLineItems } from "@/lib/boardingInvoiceLines";
import type { BoardingType } from "@/lib/boardingPricing";
import { MAX_BOARDING_STAY_NIGHTS } from "@/lib/boardingLimits";
import { resolveAddonPricesForKeys } from "@/lib/addonPricing";
import { serviceTypeForBoardingAddonKey } from "@/lib/groomingCatalog";
import { invoiceDueDateAtCheckIn, invoiceDueDateToday } from "@/lib/invoiceDueDate";
import { recalculateInvoiceTotals } from "@/lib/invoiceRecalc";
import {
  findOpenSameDayServiceInvoice,
  syncMergedInvoiceServiceType,
} from "@/lib/sameDayServiceInvoiceLookup";
import { isSameDayMergeableService } from "@/lib/sameDayServiceInvoice";
import { netFromGrossInclusive, vatAmountFromGrossInclusive } from "@/lib/vatConfig";
import { roundAed } from "@/lib/money";

export { MAX_BOARDING_STAY_NIGHTS } from "@/lib/boardingLimits";

/**
 * Returns the number of nights between two ISO date strings.
 */
export function calculateNights(checkIn: string, checkOut: string): number {
  return differenceInCalendarDays(parseISO(checkOut), parseISO(checkIn));
}

/** Planned stay range: `check_out_date` is exclusive (departure day, not a charged night). */
export function validateBoardingDateRange(
  checkIn: string,
  checkOutExclusive: string,
): string | null {
  if (!checkIn || !checkOutExclusive) return "Check-in and check-out are required";
  if (checkOutExclusive <= checkIn) return "Check-out must be after check-in";
  const nights = differenceInCalendarDays(parseISO(checkOutExclusive), parseISO(checkIn));
  if (nights > MAX_BOARDING_STAY_NIGHTS) {
    return `Stay cannot exceed ${MAX_BOARDING_STAY_NIGHTS} nights — check the check-out date`;
  }
  return null;
}

/** From `booking_items(count)` on list/detail booking queries */
export function bookingBelongingsCount(b: {
  booking_items?: { count: number }[];
}): number {
  return Number(b.booking_items?.[0]?.count ?? 0);
}

/**
 * Returns "PET1, PET2 – SURNAME" in uppercase, truncated to 30 chars.
 */
export function formatBookingCell(petNames: string[], ownerLastName: string): string {
  const pets = petNames.join(", ");
  const full = [pets, ownerLastName]
    .filter(Boolean)
    .join(" – ")
    .toUpperCase();
  return full.length > 30 ? `${full.slice(0, 30)}…` : full;
}

/**
 * Safely joins first + last name, omitting null/undefined parts.
 */
export function ownerDisplayName(first: string | null | undefined, last: string | null | undefined): string {
  return [first, last].filter(Boolean).join(" ") || "—";
}

/**
 * Returns Tailwind CSS classes for a booking status badge.
 */
export function getStatusColour(status: string): string {
  const map: Record<string, string> = {
    confirmed: "bg-blue-100 text-blue-800 border-blue-200",
    checked_in: "bg-green-100 text-green-800 border-green-200",
    checked_out: "bg-gray-100 text-gray-600 border-gray-200",
    enquiry: "bg-yellow-100 text-yellow-800 border-yellow-200",
    cancelled: "bg-red-100 text-red-600 border-red-200",
  };
  return map[status] ?? "bg-gray-100 text-gray-600 border-gray-200";
}

/**
 * Returns true if the given date falls within the booking's
 * check_in_date (inclusive) to check_out_date (exclusive — checkout day
 * is the departure day, not an occupied night).
 */
export function isBookingOnDate(
  booking: { check_in_date: string; check_out_date: string },
  date: string
): boolean {
  return date >= booking.check_in_date && date < booking.check_out_date;
}

/**
 * Returns all bookings for a specific room that occupy the given date.
 */
export function getBookingsForRoomAndDate(
  bookings: { room_id: string; check_in_date: string; check_out_date: string }[],
  roomId: string,
  date: string
): typeof bookings {
  return bookings.filter(
    (b) => b.room_id === roomId && isBookingOnDate(b, date)
  );
}

/**
 * Returns an array of N date strings (YYYY-MM-DD) starting from startDate.
 */
export function generateDateRange(startDate: string, days: number): string[] {
  const base = parseISO(startDate);
  return Array.from({ length: days }, (_, i) =>
    format(addDays(base, i), "yyyy-MM-dd")
  );
}

// ── Shared auto-invoice creation ─────────────────────────────────────────────

export interface ServiceInvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  pricingKey?: string;
  serviceType?: string;
  /**
   * Use caller-provided unitPrice as authoritative even when pricingKey exists.
   * This is required for composite/bundle math where pricingKey is retained for
   * traceability but per-unit values are intentionally pre-derived.
   */
  preserveUnitPrice?: boolean;
}

export interface CreateServiceInvoiceParams {
  ownerId: string;
  serviceType: ServiceType;
  /** The booking/appointment/package/park-booking id */
  referenceId: string;
  lineItems: ServiceInvoiceLineItem[];
  notes?: string | null;
  invoiceStatus?: "draft" | "finalised" | "outstanding";
  /** When true, member/profile discount is not applied (full subtotal). */
  skipMemberDiscount?: boolean;
  /** Service check-in date (YYYY-MM-DD). Due date defaults to this. */
  checkInDate?: string;
  /** Explicit due date override (YYYY-MM-DD). */
  dueDate?: string;
}

async function appendLinesToOpenInvoice(
  db: SupabaseClient<Database>,
  invoice: { id: string; service_type: string | null },
  serviceType: string,
  lines: ServiceInvoiceLineItem[],
): Promise<string> {
  const { data: existingLines, error: sortErr } = await db
    .from("invoice_line_items")
    .select("sort_order")
    .eq("invoice_id", invoice.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (sortErr) throw sortErr;

  const maxSort = existingLines?.[0]?.sort_order ?? -1;
  const lineRows = lines.map((li, i) => {
    const quantity = li.quantity;
    const lineTotal = li.unitPrice * quantity;
    return {
      invoice_id: invoice.id,
      description: li.description,
      quantity,
      unit_price: li.unitPrice,
      total_price: lineTotal,
      line_total: lineTotal,
      pricing_key: li.pricingKey ?? null,
      service_type: li.serviceType ?? serviceType,
      sort_order: (maxSort ?? -1) + 1 + i,
    };
  });

  if (lineRows.length > 0) {
    const { error: liErr } = await db.from("invoice_line_items").insert(lineRows);
    if (liErr) throw liErr;
  }

  await syncMergedInvoiceServiceType(db, invoice.id, invoice.service_type, serviceType);
  await recalculateInvoiceTotals(invoice.id, db);
  return invoice.id;
}

/**
 * Shared invoice creator used by all service flows (boarding, grooming, park,
 * daycare). Writes both `_aed` and non-suffixed columns for backwards
 * compatibility, and creates line items.
 */
export async function createServiceInvoice(
  params: CreateServiceInvoiceParams,
  client?: SupabaseClient<Database>,
): Promise<string> {
  const db = client ?? getSupabase();
  const {
    ownerId,
    serviceType,
    referenceId,
    lineItems,
    notes,
    invoiceStatus = "draft",
    skipMemberDiscount = false,
    checkInDate,
    dueDate: dueDateOverride,
  } = params;

  const normalizedLines: ServiceInvoiceLineItem[] = [];
  for (const li of lineItems) {
    const qty = Number.isFinite(li.quantity) && li.quantity > 0 ? li.quantity : 1;
    const unitPrice = li.unitPrice;

    normalizedLines.push({
      ...li,
      quantity: qty,
      unitPrice,
      // keep total derivation deterministic for inserts below
    });
  }

  const subtotal = normalizedLines.reduce((s, li) => s + li.unitPrice * li.quantity, 0);

  const dueDate =
    dueDateOverride ??
    (checkInDate ? invoiceDueDateAtCheckIn(checkInDate) : invoiceDueDateToday());

  if (isSameDayMergeableService(serviceType)) {
    const existing = await findOpenSameDayServiceInvoice(db, ownerId, dueDate);
    if (existing) {
      return appendLinesToOpenInvoice(db, existing, serviceType, normalizedLines);
    }
  }

  let discountPct = 0;
  let discountAed = 0;
  if (!skipMemberDiscount && subtotal > 0) {
    const { data: ownerRow } = await db
      .from("owners")
      .select("extra_discount_pct")
      .eq("id", ownerId)
      .single();
    const pct = ownerRow?.extra_discount_pct ?? 0;
    if (pct > 0) {
      discountPct = pct;
      discountAed = roundAed(subtotal * pct / 100);
    }
  }

  const total = subtotal - discountAed;

  const isBoardingReference = serviceType === "boarding";

  const grossTotal = Math.max(0, total);
  const vatAed = vatAmountFromGrossInclusive(grossTotal);
  const netAfterDiscount = netFromGrossInclusive(grossTotal);

  const { data: inv, error: invErr } = await db
    .from("invoices")
    .insert({
      owner_id: ownerId,
      // booking_id is FK-bound to bookings. Non-boarding services should link
      // via service_id to avoid FK failures on appointment/session/package ids.
      booking_id: isBoardingReference ? referenceId : null,
      service_id: referenceId,
      service_type: serviceType,
      status: invoiceStatus,
      subtotal,
      discount_pct: discountPct,
      discount_amount: discountAed,
      total: grossTotal,
      vat_aed: vatAed,
      due_date: dueDate,
      notes: notes ?? null,
    })
    .select("id")
    .single();

  if (invErr) {
    throw invErr;
  }

  const lineRows = normalizedLines.map((li, i) => {
    const quantity = li.quantity;
    const lineTotal = li.unitPrice * quantity;
    return {
      invoice_id: inv.id,
      description: li.description,
      quantity,
      unit_price: li.unitPrice,
      total_price: lineTotal,
      line_total: lineTotal,
      pricing_key: li.pricingKey ?? null,
      service_type: li.serviceType ?? serviceType,
      sort_order: i,
    };
  });

  if (lineRows.length > 0) {
    const { error: liErr } = await db.from("invoice_line_items").insert(lineRows);
    if (liErr) {
      await db.from("invoices").delete().eq("id", inv.id);
      throw liErr;
    }
  }

  return inv.id;
}

/** Deletes an unpaid service invoice and its line items (rollback when session metadata update fails). */
export async function removeUnpaidServiceInvoice(invoiceId: string): Promise<void> {
  const { data: inv, error: fetchErr } = await getSupabase()
    .from("invoices")
    .select("id, amount_paid, status")
    .eq("id", invoiceId)
    .single();
  if (fetchErr) throw fetchErr;
  if (!inv) return;
  if (Number(inv.amount_paid ?? 0) > 0) {
    throw new Error("Invoice already has payments and cannot be rolled back automatically.");
  }
  if (inv.status === "voided" || inv.status === "consolidated") return;

  const { error: lineErr } = await getSupabase()
    .from("invoice_line_items")
    .delete()
    .eq("invoice_id", invoiceId);
  if (lineErr) throw lineErr;

  const { error: invErr } = await getSupabase().from("invoices").delete().eq("id", invoiceId);
  if (invErr) throw invErr;
}

// ── Boarding-specific invoice helper ─────────────────────────────────────────

interface AutoInvoiceParams {
  bookingId: string;
  ownerId: string;
  serviceType: ServiceType;
  roomId: string | null;
  roomType: string;
  roomName?: string;
  petCount: number;
  pets?: { id: string; name: string }[];
  checkInDate: string;
  checkOutDate: string;
  roomRateType?: "peak" | "off_peak";
  boardingType?: BoardingType;
  /** When `unitPriceAed` is set, that amount is used (staff override per booking) instead of resolving `key` from the pricing tables. */
  addons?: { key: string; label: string; quantity?: number; unitPriceAed?: number }[];
}

export async function createBookingInvoice(params: AutoInvoiceParams): Promise<void> {
  const {
    bookingId,
    ownerId,
    roomId,
    roomType,
    roomName,
    petCount,
    pets,
    checkInDate,
    checkOutDate,
    roomRateType = "off_peak",
    boardingType = "boarding_only",
    addons = [],
  } = params;

  const nights = differenceInCalendarDays(parseISO(checkOutDate), parseISO(checkInDate));
  if (nights <= 0) return;

  void roomRateType;
  void roomType;

  const [addonPriceMap, nightLineItems] = await Promise.all([
    resolveAddonPricesForKeys(addons.map((a) => a.key)),
    buildBoardingNightLineItems({
      roomId,
      roomName,
      petCount,
      pets,
      checkInDate,
      checkOutDate,
      boardingType,
    }),
  ]);

  const lineItems: ServiceInvoiceLineItem[] = [...nightLineItems];

  if (lineItems.length === 0) {
    const fallbackPrefix = roomName ? `${roomName} — ` : "";
    const fallbackLabel = fallbackPrefix ? `${fallbackPrefix}Boarding` : "Boarding";
    const billedPets =
      pets && pets.length > 0
        ? pets
        : Array.from({ length: Math.max(1, petCount) }, (_, i) => ({
            id: `_pet_${i}`,
            name: petCount === 1 ? "Pet" : `Pet ${i + 1}`,
          }));
    for (const pet of billedPets) {
      lineItems.push({
        description: `${pet.name} — ${fallbackLabel} — ${nights} night${nights !== 1 ? "s" : ""}`,
        quantity: nights,
        unitPrice: 0,
        pricingKey: "boarding_night",
        serviceType: "boarding",
      });
    }
  }

  for (const addon of addons) {
    const qty = Math.max(1, addon.quantity ?? 1);
    const manual =
      addon.unitPriceAed != null &&
      Number.isFinite(addon.unitPriceAed) &&
      addon.unitPriceAed >= 0;
    const rate = manual ? addon.unitPriceAed! : (addonPriceMap.get(addon.key) ?? 0);
    lineItems.push({
      description: addon.label,
      quantity: qty,
      unitPrice: rate,
      pricingKey: addon.key,
      serviceType: serviceTypeForBoardingAddonKey(addon.key),
      preserveUnitPrice: manual,
    });
  }

  await createServiceInvoice({
    ownerId,
    serviceType: "boarding",
    referenceId: bookingId,
    lineItems,
    checkInDate,
  });

  const { error: occupancyErr } = await getSupabase().rpc("apply_double_occupancy_discount", {
    p_booking_id: bookingId,
  });
  if (occupancyErr) {
    throw occupancyErr;
  }
}
