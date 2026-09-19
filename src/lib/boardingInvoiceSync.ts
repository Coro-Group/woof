import { differenceInCalendarDays, parseISO } from "date-fns";

import { getSupabase } from "@/lib/supabaseRuntime";
import type { Database } from "@/integrations/supabase/types";
import { buildBoardingNightLineItems, type BoardingInvoiceLineItem } from "@/lib/boardingInvoiceLines";
import {
  deriveInvoiceStatusAfterRecalc,
  isBoardingNightLineItem,
} from "@/lib/boardingInvoiceLineUtils";
import { createBookingInvoice } from "@/lib/bookingUtils";
import { formatAed, roundAed } from "@/lib/money";
import { invoiceDueDateAtCheckIn } from "@/lib/invoiceDueDate";
import { invoiceAdjustmentDiscountTotal, resolveInvoiceAmountPaid } from "@/lib/invoiceRecalc";
import { invoiceDisplayTotals, vatAmountFromGrossInclusive } from "@/lib/vatConfig";
import { withoutSupersededInvoices } from "@/lib/invoiceStatus";

type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
type LineRow = Database["public"]["Tables"]["invoice_line_items"]["Row"];

export type SyncBoardingInvoiceResult =
  | { kind: "no_invoice" }
  | { kind: "skipped"; reason: string }
  | { kind: "created"; invoiceId: string }
  | {
      kind: "updated";
      invoiceId: string;
      grandTotal: number;
      amountPaid: number;
      outstanding: number;
      status: string;
    };

export { isBoardingNightLineItem, deriveInvoiceStatusAfterRecalc } from "@/lib/boardingInvoiceLineUtils";

function lineRowToServiceItem(row: LineRow): BoardingInvoiceLineItem {
  return {
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    pricingKey: row.pricing_key ?? undefined,
    serviceType: row.service_type ?? undefined,
    preserveUnitPrice: true,
  };
}

function totalsFromLineItems(
  lineItems: BoardingInvoiceLineItem[],
  discountAmount: number,
): { subtotal: number; grossTotal: number; vatAed: number } {
  const subtotal = lineItems.reduce((s, li) => s + li.unitPrice * Math.max(1, li.quantity), 0);
  const grossTotal = Math.max(0, roundAed(subtotal - discountAmount));
  const vatAed = vatAmountFromGrossInclusive(grossTotal);
  return { subtotal: roundAed(subtotal), grossTotal, vatAed };
}

async function loadBookingForInvoice(bookingId: string) {
  const { data, error } = await getSupabase()
    .from("bookings")
    .select(
      "id, owner_id, room_id, check_in_date, check_out_date, status, boarding_type, rooms(room_number, display_name, room_type), booking_pets(pet_id, pets(name))",
    )
    .eq("id", bookingId)
    .single();
  if (error) throw error;
  return data;
}

function bookingPetsForInvoice(
  bookingPets: Array<{ pet_id: string; pets: { name: string } | null }> | null | undefined,
): { id: string; name: string }[] {
  return (bookingPets ?? []).map((bp) => ({
    id: bp.pet_id,
    name: bp.pets?.name ?? "Pet",
  }));
}

/**
 * Re-price boarding night lines on the booking's invoice after check-in/out date edits.
 * Preserves non-night lines (transport, grooming add-ons, etc.) and paid amounts.
 */
export async function syncBoardingBookingInvoice(
  bookingId: string,
): Promise<SyncBoardingInvoiceResult> {
  const booking = await loadBookingForInvoice(bookingId);
  if (!booking?.owner_id) {
    return { kind: "skipped", reason: "Booking has no owner" };
  }
  if (booking.status === "cancelled") {
    return { kind: "skipped", reason: "Cancelled booking" };
  }

  const { data: invoices, error: invListErr } = await withoutSupersededInvoices(
    getSupabase()
      .from("invoices")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1),
  );

  if (invListErr) throw invListErr;

  const invoice = (invoices ?? [])[0] as InvoiceRow | undefined;
  const room = booking.rooms as { room_number?: string; display_name?: string; room_type?: string } | null;
  const pets = bookingPetsForInvoice(
    booking.booking_pets as Array<{ pet_id: string; pets: { name: string } | null }> | null,
  );
  const petCount = Math.max(1, pets.length);
  const boardingType = (booking.boarding_type as "boarding_only" | "board_and_train" | null) ?? "boarding_only";

  if (!invoice) {
    await createBookingInvoice({
      bookingId,
      ownerId: booking.owner_id,
      serviceType: "boarding",
      roomId: booking.room_id,
      roomType: room?.room_type ?? "boarding",
      roomName: room?.room_number ?? room?.display_name ?? undefined,
      petCount,
      pets,
      checkInDate: booking.check_in_date,
      checkOutDate: booking.check_out_date,
      boardingType,
    });
    const { data: created } = await getSupabase()
      .from("invoices")
      .select("id")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return created?.id
      ? { kind: "created", invoiceId: created.id }
      : { kind: "no_invoice" };
  }

  const { data: existingLines, error: linesErr } = await getSupabase()
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoice.id)
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });

  if (linesErr) throw linesErr;

  const preserved = (existingLines ?? []).filter((row) => !isBoardingNightLineItem(row));
  const nightLines = await buildBoardingNightLineItems({
    roomId: booking.room_id,
    roomName: room?.room_number ?? room?.display_name ?? undefined,
    petCount,
    pets,
    checkInDate: booking.check_in_date,
    checkOutDate: booking.check_out_date,
    boardingType,
  });

  const merged: BoardingInvoiceLineItem[] = [...nightLines, ...preserved.map(lineRowToServiceItem)];

  const { data: adjustmentsBeforeSync, error: adjFetchErr } = await getSupabase()
    .from("billing_adjustments")
    .select("adjustment_type, adjusted_amount")
    .eq("invoice_id", invoice.id);
  if (adjFetchErr) throw adjFetchErr;

  // Do not carry stale invoice.discount_amount; double occupancy is recomputed by RPC below.
  const discountAmount = invoiceAdjustmentDiscountTotal(adjustmentsBeforeSync ?? [], {
    excludeTypes: ["double_occupancy_discount"],
  });
  const { subtotal, grossTotal, vatAed } = totalsFromLineItems(merged, discountAmount);
  const amountPaid = await resolveInvoiceAmountPaid(invoice, getSupabase());
  const { grandTotal } = invoiceDisplayTotals({
    total: grossTotal,
    vat_aed: vatAed,
  });
  const outstanding = roundAed(Math.max(0, grandTotal - amountPaid));
  const status = deriveInvoiceStatusAfterRecalc(invoice.status, amountPaid, grandTotal);

  const { error: delErr } = await getSupabase()
    .from("invoice_line_items")
    .delete()
    .eq("invoice_id", invoice.id);
  if (delErr) throw delErr;

  const lineRows = merged.map((li, i) => ({
    invoice_id: invoice.id,
    description: li.description,
    quantity: Math.max(1, li.quantity),
    unit_price: li.unitPrice,
    total_price: li.unitPrice * Math.max(1, li.quantity),
    pricing_key: li.pricingKey ?? null,
    service_type: li.serviceType ?? "boarding",
    sort_order: i,
  }));

  if (lineRows.length > 0) {
    const { error: insErr } = await getSupabase().from("invoice_line_items").insert(lineRows);
    if (insErr) throw insErr;
  }

  const updatePayload: Database["public"]["Tables"]["invoices"]["Update"] = {
    subtotal,
    total: grossTotal,
    vat_aed: vatAed,
    due_date: invoiceDueDateAtCheckIn(booking.check_in_date),
    status: status as Database["public"]["Enums"]["invoice_status"],
    amount_paid: amountPaid,
    updated_at: new Date().toISOString(),
  };

  if (status === "paid" && !invoice.paid_at) {
    updatePayload.paid_at = new Date().toISOString();
  }
  if (status !== "paid") {
    updatePayload.paid_at = null;
  }

  const { error: updErr } = await getSupabase()
    .from("invoices")
    .update(updatePayload)
    .eq("id", invoice.id);
  if (updErr) throw updErr;

  const { error: occupancyErr } = await getSupabase().rpc("apply_double_occupancy_discount", {
    p_booking_id: bookingId,
  });
  if (occupancyErr) throw occupancyErr;

  const { data: refreshedInvoice, error: refreshErr } = await getSupabase()
    .from("invoices")
    .select("*")
    .eq("id", invoice.id)
    .single();
  if (refreshErr) throw refreshErr;

  const refreshedGrandTotal = invoiceDisplayTotals({
    total: roundAed(refreshedInvoice.total ?? grossTotal),
    vat_aed: refreshedInvoice.vat_aed,
    service_type: refreshedInvoice.service_type,
    notes: refreshedInvoice.notes,
  }).grandTotal;
  const refreshedOutstanding = roundAed(Math.max(0, refreshedGrandTotal - amountPaid));
  const refreshedStatus = deriveInvoiceStatusAfterRecalc(
    refreshedInvoice.status,
    amountPaid,
    refreshedGrandTotal,
  );

  return {
    kind: "updated",
    invoiceId: invoice.id,
    grandTotal: refreshedGrandTotal,
    amountPaid,
    outstanding: refreshedOutstanding,
    status: refreshedStatus,
  };
}

export function formatSyncBoardingInvoiceToast(result: SyncBoardingInvoiceResult): string {
  if (result.kind === "updated") {
    if (result.outstanding <= 0) {
      return `Invoice updated (${formatAed(result.grandTotal)} total, paid in full).`;
    }
    return `Invoice updated — ${formatAed(result.outstanding)} outstanding (${formatAed(result.amountPaid)} paid).`;
  }
  if (result.kind === "created") return "Draft invoice created for this stay.";
  if (result.kind === "skipped") return result.reason;
  return "Stay dates saved (no invoice on this booking).";
}

export type BoardingBookingMissingInvoice = {
  id: string;
  booking_ref: string | null;
};

export type BackfillBoardingInvoicesResult = {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  errors: { id: string; bookingRef: string | null; message: string }[];
};

/** Active boarding stays with no non-voided invoice (eligible for draft invoice creation). */
export async function listBoardingBookingsMissingInvoice(): Promise<BoardingBookingMissingInvoice[]> {
  const { data: invoicedRows, error: invErr } = await withoutSupersededInvoices(
    getSupabase()
      .from("invoices")
      .select("booking_id")
      .not("booking_id", "is", null),
  );
  if (invErr) throw invErr;

  const invoicedBookingIds = new Set(
    (invoicedRows ?? []).map((row) => row.booking_id).filter(Boolean) as string[],
  );

  const { data: bookings, error: bookErr } = await getSupabase()
    .from("bookings")
    .select("id, booking_ref, owner_id, check_in_date, check_out_date, status")
    .eq("booking_type", "boarding")
    .neq("status", "cancelled")
    .not("owner_id", "is", null)
    .order("check_in_date", { ascending: true });
  if (bookErr) throw bookErr;

  return (bookings ?? [])
    .filter((b) => {
      if (invoicedBookingIds.has(b.id)) return false;
      const nights = differenceInCalendarDays(
        parseISO(b.check_out_date),
        parseISO(b.check_in_date),
      );
      return nights > 0;
    })
    .map((b) => ({ id: b.id, booking_ref: b.booking_ref }));
}

export type BackfillBoardingInvoicesOptions = {
  onProgress?: (done: number, total: number) => void;
};

/** Create draft invoices for boarding stays that do not have one yet. */
export async function backfillBoardingInvoicesMissing(
  options: BackfillBoardingInvoicesOptions = {},
): Promise<BackfillBoardingInvoicesResult> {
  const targets = await listBoardingBookingsMissingInvoice();
  const total = targets.length;
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const errors: BackfillBoardingInvoicesResult["errors"] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    options.onProgress?.(i + 1, total);
    try {
      const result = await syncBoardingBookingInvoice(target.id);
      if (result.kind === "created") {
        created += 1;
      } else if (result.kind === "skipped" || result.kind === "updated") {
        skipped += 1;
      } else if (result.kind === "no_invoice") {
        failed += 1;
        errors.push({
          id: target.id,
          bookingRef: target.booking_ref,
          message: "Invoice was not created",
        });
      }
    } catch (err) {
      failed += 1;
      errors.push({
        id: target.id,
        bookingRef: target.booking_ref,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  options.onProgress?.(total, total);

  return { total, created, skipped, failed, errors };
}

export type BoardingBookingWithInvoice = {
  id: string;
  booking_ref: string | null;
};

/** Active boarding stays that already have a non-voided invoice (eligible for night-line repricing). */
export async function listBoardingBookingsWithInvoice(): Promise<BoardingBookingWithInvoice[]> {
  const { data: invoicedRows, error: invErr } = await withoutSupersededInvoices(
    getSupabase()
      .from("invoices")
      .select("booking_id")
      .not("booking_id", "is", null),
  );
  if (invErr) throw invErr;

  const invoicedBookingIds = new Set(
    (invoicedRows ?? []).map((row) => row.booking_id).filter(Boolean) as string[],
  );
  if (invoicedBookingIds.size === 0) return [];

  const { data: bookings, error: bookErr } = await getSupabase()
    .from("bookings")
    .select("id, booking_ref, owner_id, check_in_date, check_out_date, status")
    .eq("booking_type", "boarding")
    .neq("status", "cancelled")
    .not("owner_id", "is", null)
    .in("id", [...invoicedBookingIds])
    .order("check_in_date", { ascending: true });
  if (bookErr) throw bookErr;

  return (bookings ?? [])
    .filter((b) => {
      const nights = differenceInCalendarDays(
        parseISO(b.check_out_date),
        parseISO(b.check_in_date),
      );
      return nights > 0;
    })
    .map((b) => ({ id: b.id, booking_ref: b.booking_ref }));
}

export type RepriceBoardingInvoicesResult = {
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { id: string; bookingRef: string | null; message: string }[];
};

export type RepriceBoardingInvoicesOptions = {
  onProgress?: (done: number, total: number) => void;
};

/** Re-price boarding night lines on every existing boarding invoice using current peak calendar and rates. */
export async function repriceAllBoardingInvoices(
  options: RepriceBoardingInvoicesOptions = {},
): Promise<RepriceBoardingInvoicesResult> {
  const targets = await listBoardingBookingsWithInvoice();
  const total = targets.length;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: RepriceBoardingInvoicesResult["errors"] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    options.onProgress?.(i + 1, total);
    try {
      const result = await syncBoardingBookingInvoice(target.id);
      if (result.kind === "updated") {
        updated += 1;
      } else if (result.kind === "skipped" || result.kind === "no_invoice") {
        skipped += 1;
      } else if (result.kind === "created") {
        updated += 1;
      }
    } catch (err) {
      failed += 1;
      errors.push({
        id: target.id,
        bookingRef: target.booking_ref,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  options.onProgress?.(total, total);

  return { total, updated, skipped, failed, errors };
}
