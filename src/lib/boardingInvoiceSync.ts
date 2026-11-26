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
import { invoiceDisplayTotals } from "@/lib/vatConfig";
import { withoutSupersededInvoices } from "@/lib/invoiceStatus";
import { isDiscountAdjustmentType, resolveInvoiceAmountPaid } from "@/lib/invoiceRecalc";
import {
  reapplyInvoiceDiscount,
  stayDiscountHistoryNote,
  type ReapplyDiscountAdjustment,
} from "@/lib/reapplyInvoiceDiscount";

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

function mergedLineSubtotal(lines: BoardingInvoiceLineItem[]): number {
  return roundAed(lines.reduce((sum, line) => sum + line.unitPrice * Math.max(1, line.quantity), 0));
}

type StayDiscountSnapshot = {
  previousSubtotal: number;
  discountPct: number;
  discountAmount: number;
  status: string;
  amountPaid: number;
  vatAed: number | null;
  adjustments: ReapplyDiscountAdjustment[];
};

function snapshotKeepsDiscount(snapshot: StayDiscountSnapshot): boolean {
  if (snapshot.discountAmount > 0.009 || snapshot.discountPct > 0) return true;
  return snapshot.adjustments.some(
    (row) =>
      row.adjustment_type !== "double_occupancy_discount" &&
      isDiscountAdjustmentType(row.adjustment_type) &&
      Math.abs(Number(row.adjusted_amount) || 0) > 0.009,
  );
}

/** Read the approved discount before night lines are replaced. The occupancy RPC can zero it. */
async function loadStayDiscountSnapshot(
  invoice: InvoiceRow,
  bookingId: string,
): Promise<StayDiscountSnapshot> {
  const { error: linkErr } = await getSupabase()
    .from("billing_adjustments")
    .update({ invoice_id: invoice.id })
    .eq("booking_id", bookingId)
    .is("invoice_id", null)
    .in("adjustment_type", [
      "discount_override",
      "fee_waived",
      "goodwill_credit",
      "adjustment",
      "double_occupancy_discount",
    ]);
  if (linkErr) throw linkErr;

  const { data, error } = await getSupabase()
    .from("billing_adjustments")
    .select("id, adjustment_type, adjusted_amount, reason, approved_by")
    .eq("invoice_id", invoice.id);
  if (error) throw error;

  return {
    previousSubtotal: roundAed(invoice.subtotal ?? 0),
    discountPct: Number(invoice.discount_pct) || 0,
    discountAmount: roundAed(invoice.discount_amount ?? 0),
    status: invoice.status,
    amountPaid: await resolveInvoiceAmountPaid(invoice, getSupabase()),
    vatAed: invoice.vat_aed,
    adjustments: (data ?? []).map((row) => ({
      id: row.id,
      adjustment_type: row.adjustment_type,
      adjusted_amount: row.adjusted_amount,
      reason: row.reason,
      approved_by: row.approved_by,
    })),
  };
}

/**
 * Put the discount taken before the rebuild back onto the new night subtotal.
 * Percent overrides are recalculated. Fixed amounts stay. A history row records it.
 */
async function reapplyStayDiscount(
  invoiceId: string,
  snapshot: StayDiscountSnapshot,
  newSubtotal: number,
): Promise<void> {
  if (!snapshotKeepsDiscount(snapshot)) return;

  const { data: currentRows, error: loadErr } = await getSupabase()
    .from("billing_adjustments")
    .select("id, adjustment_type, adjusted_amount, reason, approved_by")
    .eq("invoice_id", invoiceId);
  if (loadErr) throw loadErr;

  const current = new Map((currentRows ?? []).map((row) => [row.id, row]));
  for (const row of snapshot.adjustments) {
    if (!row.id || current.has(row.id) || row.adjustment_type === "double_occupancy_discount") continue;
    current.set(row.id, {
      id: row.id,
      adjustment_type: row.adjustment_type,
      adjusted_amount: row.adjusted_amount ?? null,
      reason: row.reason ?? null,
      approved_by: row.approved_by ?? null,
    });
  }

  const priced = reapplyInvoiceDiscount({
    previousSubtotal: snapshot.previousSubtotal,
    subtotal: newSubtotal,
    discountPct: snapshot.discountPct,
    discountAmount: snapshot.discountAmount,
    adjustments: [...current.values()],
    amountPaid: snapshot.amountPaid,
    currentStatus: snapshot.status,
  });

  const { error: updateErr } = await getSupabase()
    .from("invoices")
    .update({
      subtotal: priced.subtotal,
      discount_amount: priced.discountAmount,
      discount_pct: priced.discountPct,
      total: priced.total,
      vat_aed: snapshot.vatAed == null ? null : priced.vatAed,
      status: priced.status as Database["public"]["Enums"]["invoice_status"],
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);
  if (updateErr) throw updateErr;

  for (const change of priced.adjustmentAmounts) {
    if (!change.id) continue;
    const { error } = await getSupabase()
      .from("billing_adjustments")
      .update({ adjusted_amount: change.adjustedAmount })
      .eq("id", change.id);
    if (error) throw error;
  }

  const note = stayDiscountHistoryNote({
    previousDiscountAmount: snapshot.discountAmount,
    previousDiscountPct: priced.discountPct,
    nextDiscountAmount: priced.discountAmount,
  });
  if (!note) return;

  const { error: noteErr } = await getSupabase().from("invoice_amendments").insert({
    invoice_id: invoiceId,
    field_changed: note.fieldChanged,
    old_value: note.oldValue,
    new_value: note.newValue,
    reason: note.reason,
    amended_by: "system",
  });
  if (noteErr) throw noteErr;
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

  const discountSnapshot = await loadStayDiscountSnapshot(invoice, bookingId);
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

  // Due date only. The occupancy RPC can zero an approved discount; the
  // snapshot taken before the rebuild is written back afterwards.
  const { error: dueErr } = await getSupabase()
    .from("invoices")
    .update({
      due_date: invoiceDueDateAtCheckIn(booking.check_in_date),
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoice.id);
  if (dueErr) throw dueErr;

  const { error: occupancyErr } = await getSupabase().rpc("apply_double_occupancy_discount", {
    p_booking_id: bookingId,
  });
  if (occupancyErr) throw occupancyErr;

  await reapplyStayDiscount(invoice.id, discountSnapshot, mergedLineSubtotal(merged));

  const { data: refreshedInvoice, error: refreshErr } = await getSupabase()
    .from("invoices")
    .select("*")
    .eq("id", invoice.id)
    .single();
  if (refreshErr) throw refreshErr;

  const refreshedGrandTotal = invoiceDisplayTotals({
    total: roundAed(refreshedInvoice.total ?? 0),
    vat_aed: refreshedInvoice.vat_aed,
    service_type: refreshedInvoice.service_type,
    notes: refreshedInvoice.notes,
  }).grandTotal;
  const amountPaid = roundAed(refreshedInvoice.amount_paid ?? 0);
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
