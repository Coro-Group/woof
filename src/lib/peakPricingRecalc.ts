import { buildBoardingNightLineItems } from "@/lib/boardingInvoiceLines";
import { isBoardingNightLineItem } from "@/lib/boardingInvoiceLineUtils";
import type { BoardingType } from "@/lib/boardingPricing";
import {
  boardingNightLinesMatch,
  bookingOverlapsPeakRecalcWindow,
  lineSubtotal,
  PEAK_PRICING_AMENDMENT_FIELD,
  PEAK_PRICING_REFERENCE_TYPE,
  PEAK_RECALC_NIGHT_FROM,
  PEAK_RECALC_NIGHT_TO,
  peakRecalcAmendmentReason,
  peakRecalcMoney,
  walletCreditForPeakRecalc,
  walletCreditInAmendmentReason,
  type PeakNightLineIdentity,
} from "@/lib/peakPricingRecalcDecision";
import type { ReapplyDiscountAdjustment } from "@/lib/reapplyInvoiceDiscount";
import { getSupabase } from "@/lib/supabaseRuntime";
import { roundMoney2 } from "@/lib/vatConfig";

export type PeakRecalcPreviewRow = {
  invoiceId: string;
  invoiceNumber: string;
  ownerName: string;
  status: string;
  oldTotal: number;
  newTotal: number;
  difference: number;
  walletCredit: number;
};

export type PeakRecalcPreview = {
  rows: PeakRecalcPreviewRow[];
  unchanged: number;
  errors: { invoiceNumber: string; message: string }[];
};

export type PeakRecalcApplyResult = {
  updated: string[];
  skipped: number;
  failed: { invoiceNumber: string; message: string }[];
};

type StaffActor = {
  staffName: string;
  staffId: string | null;
};

type PaymentRow = {
  id: string;
  amount: number;
  created_at: string;
  notes: string | null;
};

type LineRow = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  pricing_key: string | null;
  service_type: string | null;
};

type Candidate = {
  invoiceId: string;
  invoiceNumber: string;
  ownerId: string;
  ownerName: string;
  status: string;
  oldTotal: number;
  previousSubtotal: number;
  discountPct: number;
  discountAmount: number;
  amountPaid: number;
  paidAt: string | null;
  bookingId: string;
  roomId: string | null;
  roomName?: string;
  checkIn: string;
  checkOut: string;
  boardingType: BoardingType;
  pets: { id: string; name: string }[];
  lines: LineRow[];
  payments: PaymentRow[];
  adjustments: ReapplyDiscountAdjustment[];
  amendmentReason: string | null;
  walletAlreadyCredited: boolean;
};

const INACTIVE_STATUS_FILTER = "(voided,cancelled,consolidated)";

export async function previewPeakPricingRecalc(
  onProgress?: (done: number, total: number) => void,
): Promise<PeakRecalcPreview> {
  const candidates = await loadCandidates();
  const rows: PeakRecalcPreviewRow[] = [];
  const errors: PeakRecalcPreview["errors"] = [];
  let unchanged = 0;
  let done = 0;

  await mapPool(candidates, 4, async (candidate) => {
    try {
      const priced = await priceCandidate(candidate);
      if (!priced || !needsChange(priced)) unchanged += 1;
      else rows.push(toPreviewRow(priced));
    } catch (error) {
      errors.push({ invoiceNumber: candidate.invoiceNumber, message: errorMessage(error) });
    } finally {
      done += 1;
      onProgress?.(done, candidates.length);
    }
  });

  rows.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber));
  errors.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber));
  return { rows, unchanged, errors };
}

export async function applyPeakPricingRecalc(
  confirmed: PeakRecalcPreviewRow[],
  actor: StaffActor,
  onProgress?: (done: number, total: number) => void,
): Promise<PeakRecalcApplyResult> {
  const confirmedById = new Map(confirmed.map((row) => [row.invoiceId, row]));
  const candidates = (await loadCandidates()).filter((candidate) => confirmedById.has(candidate.invoiceId));
  const updated: string[] = [];
  const failed: PeakRecalcApplyResult["failed"] = [];
  let skipped = 0;
  let done = 0;

  for (const candidate of candidates) {
    const confirmedRow = confirmedById.get(candidate.invoiceId);
    try {
      const priced = await priceCandidate(candidate);
      if (!priced || !confirmedRow) {
        skipped += 1;
        continue;
      }
      if (
        Math.abs(priced.newTotal - confirmedRow.newTotal) > 0.02
        || Math.abs(priced.walletCredit - confirmedRow.walletCredit) > 0.02
      ) {
        throw new Error("Totals changed since the preview. Preview again before confirming.");
      }
      const didWrite = await applyCandidate(priced, actor);
      if (didWrite) updated.push(priced.invoiceNumber);
      else skipped += 1;
    } catch (error) {
      failed.push({ invoiceNumber: candidate.invoiceNumber, message: errorMessage(error) });
    } finally {
      done += 1;
      onProgress?.(done, candidates.length);
    }
  }

  const found = new Set(candidates.map((candidate) => candidate.invoiceId));
  for (const row of confirmed) {
    if (!found.has(row.invoiceId)) {
      failed.push({
        invoiceNumber: row.invoiceNumber,
        message: "Invoice is no longer in the peak-date set.",
      });
    }
  }

  return { updated, skipped, failed };
}

type Priced = Candidate & {
  nextLines: PeakNightLineIdentity[];
  newTotal: number;
  difference: number;
  walletCredit: number;
  linesChanged: boolean;
  collected: number;
};

async function priceCandidate(candidate: Candidate): Promise<Priced | null> {
  const nightLines = await buildBoardingNightLineItems({
    roomId: candidate.roomId,
    roomName: candidate.roomName,
    petCount: Math.max(1, candidate.pets.length),
    pets: candidate.pets,
    checkInDate: candidate.checkIn,
    checkOutDate: candidate.checkOut,
    boardingType: candidate.boardingType,
  });
  if (nightLines.length === 0) return null;
  if (nightLines.some((line) => line.unitPrice <= 0)) {
    throw new Error("No current boarding rate for one of the nights.");
  }

  const nextLines: PeakNightLineIdentity[] = nightLines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    pricingKey: line.pricingKey ?? null,
  }));
  const existingNights = candidate.lines.filter((line) => isBoardingNightLineItem(line));
  const preserved = candidate.lines.filter((line) => !isBoardingNightLineItem(line));
  const nextSubtotal = lineSubtotal([
    ...nextLines,
    ...preserved.map((line) => ({ quantity: line.quantity, unitPrice: line.unit_price })),
  ]);
  const collected = collectedAmount(candidate);
  const money = peakRecalcMoney({
    status: candidate.status,
    amountPaid: collected,
    oldTotal: candidate.oldTotal,
    previousSubtotal: candidate.previousSubtotal,
    nextSubtotal,
    discountPct: candidate.discountPct,
    discountAmount: candidate.discountAmount,
    adjustments: candidate.adjustments,
  });
  return {
    ...candidate,
    nextLines,
    newTotal: money.newTotal,
    difference: money.difference,
    walletCredit: money.walletCredit,
    linesChanged: !boardingNightLinesMatch(
      existingNights.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unit_price,
        pricingKey: line.pricing_key,
      })),
      nextLines,
    ),
    collected,
  };
}

function needsChange(priced: Priced): boolean {
  return priced.linesChanged || Math.abs(priced.difference) > 0.009 || priced.walletCredit > 0.009;
}

function toPreviewRow(priced: Priced): PeakRecalcPreviewRow {
  return {
    invoiceId: priced.invoiceId,
    invoiceNumber: priced.invoiceNumber,
    ownerName: priced.ownerName,
    status: priced.status,
    oldTotal: priced.oldTotal,
    newTotal: priced.newTotal,
    difference: priced.difference,
    walletCredit: priced.walletCredit,
  };
}

async function applyCandidate(priced: Priced, actor: StaffActor): Promise<boolean> {
  const totalsMatch = Math.abs(priced.oldTotal - priced.newTotal) <= 0.009;
  const creditSettled = priced.walletAlreadyCredited || priced.walletCredit <= 0.009;
  if (!priced.linesChanged && totalsMatch && creditSettled && priced.amendmentReason) return false;

  const excess = walletCreditForPeakRecalc(priced.status, priced.collected, priced.newTotal);
  const pendingCredit = walletCreditInAmendmentReason(priced.amendmentReason);
  const creditAmount = priced.walletAlreadyCredited
    ? 0
    : excess > 0.009
      ? excess
      : pendingCredit;
  if (!priced.amendmentReason) await logAmendment(priced, Math.max(priced.walletCredit, creditAmount), actor);
  if (creditAmount > 0.009) await creditWallet(priced, creditAmount, actor);
  if (excess > 0.009) {
    if (priced.payments.length > 0) await shrinkPayments(priced.payments, excess);
    else await lowerAmountPaid(priced.invoiceId, priced.newTotal);
  }

  if (priced.linesChanged) await replaceNightLines(priced);

  if (priced.linesChanged || !totalsMatch || creditAmount > 0.009 || excess > 0.009) {
    const { error } = await getSupabase().rpc("reapply_invoice_discount", {
      p_invoice_id: priced.invoiceId,
      p_amended_by: actor.staffName,
    });
    if (error) throw error;
  }

  if (priced.paidAt) await restorePaidAt(priced.invoiceId, priced.paidAt);
  return true;
}

async function replaceNightLines(priced: Priced): Promise<void> {
  const nightIds = priced.lines.filter((line) => isBoardingNightLineItem(line)).map((line) => line.id);
  if (nightIds.length > 0) {
    const { error } = await getSupabase().from("invoice_line_items").delete().in("id", nightIds);
    if (error) throw error;
  }
  const rows = priced.nextLines.map((line, index) => {
    const quantity = Math.max(1, line.quantity);
    return {
      invoice_id: priced.invoiceId,
      description: line.description,
      quantity,
      unit_price: line.unitPrice,
      total_price: line.unitPrice * quantity,
      pricing_key: line.pricingKey ?? null,
      service_type: "boarding",
      sort_order: index,
    };
  });
  if (rows.length > 0) {
    const { error } = await getSupabase().from("invoice_line_items").insert(rows);
    if (error) throw error;
  }
}

async function shrinkPayments(payments: PaymentRow[], credit: number): Promise<void> {
  let left = roundMoney2(credit);
  const ordered = [...payments].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  for (const payment of ordered) {
    if (left <= 0.009) break;
    const amount = roundMoney2(Number(payment.amount) || 0);
    if (amount <= 0) continue;
    if (amount <= left + 0.009) {
      const { error } = await getSupabase().from("invoice_payments").delete().eq("id", payment.id);
      if (error) throw error;
      left = roundMoney2(left - amount);
      continue;
    }
    const note = appendNote(
      payment.notes,
      `Peak pricing recalculation reduced this payment by AED ${left.toFixed(2)}. The difference was credited to the wallet.`,
    );
    const { error } = await getSupabase()
      .from("invoice_payments")
      .update({ amount: roundMoney2(amount - left), notes: note })
      .eq("id", payment.id);
    if (error) throw error;
    left = 0;
  }
  if (left > 0.009) {
    throw new Error(`Could not reduce recorded payments by AED ${credit.toFixed(2)}.`);
  }
}

async function lowerAmountPaid(invoiceId: string, newTotal: number): Promise<void> {
  const { error } = await getSupabase()
    .from("invoices")
    .update({ amount_paid: roundMoney2(newTotal) })
    .eq("id", invoiceId);
  if (error) throw error;
}

async function creditWallet(priced: Priced, amount: number, actor: StaffActor): Promise<void> {
  const credit = roundMoney2(amount);
  if (credit <= 0.009) return;
  const { data: owner, error: ownerError } = await getSupabase()
    .from("owners")
    .select("wallet_balance")
    .eq("id", priced.ownerId)
    .single();
  if (ownerError) throw ownerError;
  const balanceAfter = roundMoney2(Number(owner.wallet_balance ?? 0) + credit);
  const { error: txError } = await getSupabase().from("wallet_transactions").insert({
    owner_id: priced.ownerId,
    transaction_type: "refund",
    amount: credit,
    balance_after: balanceAfter,
    invoice_id: null,
    reference_id: priced.invoiceId,
    reference_type: PEAK_PRICING_REFERENCE_TYPE,
    notes: `Peak dates recalculated for ${priced.invoiceNumber}. Credited AED ${credit.toFixed(2)} to the wallet because the boarding total was lower.`,
    performed_by: actor.staffName,
    staff_id: actor.staffId,
  });
  if (txError) throw txError;
  const { error: updateError } = await getSupabase()
    .from("owners")
    .update({ wallet_balance: balanceAfter })
    .eq("id", priced.ownerId);
  if (updateError) throw updateError;
}

async function restorePaidAt(invoiceId: string, paidAt: string): Promise<void> {
  const { data, error } = await getSupabase().from("invoices").select("status").eq("id", invoiceId).single();
  if (error) throw error;
  if (data.status !== "paid") return;
  const { error: updateError } = await getSupabase()
    .from("invoices")
    .update({ paid_at: paidAt })
    .eq("id", invoiceId);
  if (updateError) throw updateError;
}

async function logAmendment(priced: Priced, walletCredit: number, actor: StaffActor): Promise<void> {
  const { error } = await getSupabase().from("invoice_amendments").insert({
    invoice_id: priced.invoiceId,
    amended_by: actor.staffName,
    field_changed: PEAK_PRICING_AMENDMENT_FIELD,
    old_value: priced.oldTotal.toFixed(2),
    new_value: priced.newTotal.toFixed(2),
    reason: peakRecalcAmendmentReason(priced.oldTotal, priced.newTotal, walletCredit),
  });
  if (error) throw error;
}

async function loadCandidates(): Promise<Candidate[]> {
  const { data, error } = await getSupabase()
    .from("invoices")
    .select(`
      id, invoice_number, status, total, subtotal, discount_amount, discount_pct, amount_paid, owner_id, paid_at, receipt_only,
      owners!invoices_owner_id_fkey(first_name, last_name),
      bookings!invoices_booking_id_fkey!inner(
        id, check_in_date, check_out_date, boarding_type, room_id,
        rooms(room_number, display_name),
        booking_pets(pet_id, pets(name))
      )
    `)
    .eq("service_type", "boarding")
    .not("status", "in", INACTIVE_STATUS_FILTER)
    .lte("bookings.check_in_date", PEAK_RECALC_NIGHT_TO)
    .gt("bookings.check_out_date", PEAK_RECALC_NIGHT_FROM)
    .limit(1000);
  if (error) throw error;

  const invoices = ((data ?? []) as unknown as InvoiceJoin[]).filter((invoice) => {
    const booking = firstOf(invoice.bookings);
    if (!booking) return false;
    if (invoice.receipt_only) return false;
    if (booking.boarding_type === "board_and_train") return false;
    return bookingOverlapsPeakRecalcWindow(booking.check_in_date, booking.check_out_date);
  });
  if (invoices.length === 0) return [];

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const [lines, payments, adjustments, amendments, credits] = await Promise.all([
    selectInChunks("invoice_line_items", invoiceIds, "id, invoice_id, description, quantity, unit_price, pricing_key, service_type"),
    selectInChunks("invoice_payments", invoiceIds, "id, invoice_id, amount, created_at, notes"),
    selectInChunks("billing_adjustments", invoiceIds, "id, invoice_id, adjustment_type, adjusted_amount, reason, approved_by"),
    selectInChunks("invoice_amendments", invoiceIds, "invoice_id, field_changed, reason"),
    selectWalletCredits(invoiceIds),
  ]);

  return invoices.map((invoice) => {
    const booking = firstOf(invoice.bookings)!;
    const room = firstOf(booking.rooms);
    const owner = firstOf(invoice.owners);
    const joinedPets = (booking.booking_pets ?? []).map((row) => ({
      id: row.pet_id,
      name: firstOf(row.pets)?.name?.trim() || "Pet",
    }));
    const invoiceLines = lines.filter((row) => row.invoice_id === invoice.id) as LineRow[];
    const pets = joinedPets.length > 0 ? joinedPets : petsFromNightLines(invoiceLines);
    const amendment = amendments.find(
      (row) => row.invoice_id === invoice.id && row.field_changed === PEAK_PRICING_AMENDMENT_FIELD,
    );
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number ?? invoice.id.slice(0, 8),
      ownerId: invoice.owner_id,
      ownerName: [owner?.first_name, owner?.last_name].filter(Boolean).join(" ").trim() || "Owner",
      status: invoice.status,
      oldTotal: roundMoney2(Number(invoice.total) || 0),
      previousSubtotal: roundMoney2(Number(invoice.subtotal) || 0),
      discountPct: Number(invoice.discount_pct) || 0,
      discountAmount: roundMoney2(Number(invoice.discount_amount) || 0),
      amountPaid: roundMoney2(Number(invoice.amount_paid) || 0),
      paidAt: invoice.paid_at,
      bookingId: booking.id,
      roomId: booking.room_id,
      roomName: room?.room_number || room?.display_name || undefined,
      checkIn: booking.check_in_date,
      checkOut: booking.check_out_date,
      boardingType: booking.boarding_type === "board_and_train" ? "board_and_train" : "boarding_only",
      pets,
      lines: invoiceLines,
      payments: payments.filter((row) => row.invoice_id === invoice.id) as PaymentRow[],
      adjustments: adjustments
        .filter((row) => row.invoice_id === invoice.id)
        .map((row) => ({
          id: row.id,
          adjustment_type: row.adjustment_type,
          adjusted_amount: row.adjusted_amount,
          reason: row.reason,
          approved_by: row.approved_by,
        })),
      amendmentReason: amendment?.reason ?? null,
      walletAlreadyCredited: credits.has(invoice.id),
    };
  });
}

function petsFromNightLines(lines: LineRow[]): { id: string; name: string }[] {
  const names: string[] = [];
  for (const line of lines) {
    if (!isBoardingNightLineItem(line)) continue;
    const name = line.description.split(" — ")[0]?.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names.map((name, index) => ({ id: `_pet_${index}`, name }));
}

function collectedAmount(candidate: Candidate): number {
  if (candidate.payments.length === 0) return candidate.amountPaid;
  return roundMoney2(candidate.payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
}

type InvoiceJoin = {
  id: string;
  invoice_number: string | null;
  status: string;
  total: number;
  subtotal: number;
  discount_amount: number;
  discount_pct: number;
  amount_paid: number;
  owner_id: string;
  paid_at: string | null;
  receipt_only: boolean | null;
  owners: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null;
  bookings: BookingJoin | BookingJoin[] | null;
};

type BookingJoin = {
  id: string;
  check_in_date: string;
  check_out_date: string;
  boarding_type: string | null;
  room_id: string | null;
  rooms: { room_number: string | null; display_name: string | null } | { room_number: string | null; display_name: string | null }[] | null;
  booking_pets: { pet_id: string; pets: { name: string | null } | { name: string | null }[] | null }[] | null;
};

type ChunkRow = {
  id?: string;
  invoice_id: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  pricing_key?: string | null;
  service_type?: string | null;
  amount?: number;
  created_at?: string;
  notes?: string | null;
  adjustment_type?: string;
  adjusted_amount?: number | null;
  reason?: string | null;
  approved_by?: string | null;
  field_changed?: string;
};

async function selectInChunks(
  table: "invoice_line_items" | "invoice_payments" | "billing_adjustments" | "invoice_amendments",
  invoiceIds: string[],
  columns: string,
): Promise<ChunkRow[]> {
  const rows: ChunkRow[] = [];
  for (const ids of chunks(invoiceIds, 100)) {
    const { data, error } = await getSupabase().from(table).select(columns).in("invoice_id", ids);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as ChunkRow[]));
  }
  return rows;
}

async function selectWalletCredits(invoiceIds: string[]): Promise<Set<string>> {
  const credited = new Set<string>();
  for (const ids of chunks(invoiceIds, 100)) {
    const { data, error } = await getSupabase()
      .from("wallet_transactions")
      .select("reference_id")
      .eq("reference_type", PEAK_PRICING_REFERENCE_TYPE)
      .in("reference_id", ids);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.reference_id) credited.add(row.reference_id);
    }
  }
  return credited;
}

function chunks<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function appendNote(existing: string | null, sentence: string): string {
  const base = existing?.trim() ?? "";
  if (base.includes("Peak pricing recalculation")) return base;
  return base ? `${base} ${sentence}` : sentence;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Recalculation failed.";
}
