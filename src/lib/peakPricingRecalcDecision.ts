import { deriveInvoiceStatusAfterRecalc } from "@/lib/boardingInvoiceLineUtils";
import { percentInDiscountText } from "@/lib/invoiceAdjustmentDiscount";
import { isInactiveInvoiceStatus } from "@/lib/invoiceStatus";
import type { ReapplyDiscountAdjustment } from "@/lib/reapplyInvoiceDiscount";
import { roundMoney2, vatAmountFromGrossInclusive } from "@/lib/vatConfig";

const DISCOUNT_ADJUSTMENT_TYPES = new Set([
  "discount_override",
  "double_occupancy_discount",
  "fee_waived",
  "goodwill_credit",
  "adjustment",
]);

/** A stored percent is real only when it matches its original base this closely. */
const PERCENT_BASE_TOLERANCE = 0.05;

/** Nights that were priced on the old National Day window or the current one. */
export const PEAK_RECALC_NIGHT_FROM = "2026-11-30";
export const PEAK_RECALC_NIGHT_TO = "2026-12-04";

export const PEAK_PRICING_AMENDMENT_FIELD = "peak_pricing";
export const PEAK_PRICING_REFERENCE_TYPE = "peak_pricing_recalc";

/**
 * A stay overlaps the window when any billed night falls in it.
 * Check-in is inclusive and check-out is exclusive, same as boarding nights.
 */
export function bookingOverlapsPeakRecalcWindow(checkIn: string, checkOut: string): boolean {
  return checkIn <= PEAK_RECALC_NIGHT_TO && checkOut > PEAK_RECALC_NIGHT_FROM;
}

/**
 * Money already collected above the new total. Drafts and outstanding invoices
 * with nothing collected stay at zero, so they are only updated in place.
 */
export function walletCreditForPeakRecalc(
  status: string,
  amountPaid: number,
  newTotal: number,
): number {
  if (isInactiveInvoiceStatus(status)) return 0;
  return roundMoney2(Math.max(0, roundMoney2(amountPaid) - roundMoney2(newTotal)));
}

export type PeakNightLineIdentity = {
  description: string;
  quantity: number;
  unitPrice: number;
  pricingKey?: string | null;
};

export function lineSubtotal(lines: { quantity: number; unitPrice: number }[]): number {
  const sum = lines.reduce((total, line) => {
    const quantity = Math.max(1, Number(line.quantity) || 1);
    return total + (Number(line.unitPrice) || 0) * quantity;
  }, 0);
  return roundMoney2(sum);
}

export function boardingNightLinesMatch(
  existing: PeakNightLineIdentity[],
  next: PeakNightLineIdentity[],
): boolean {
  return lineSignature(existing) === lineSignature(next);
}

function lineSignature(lines: PeakNightLineIdentity[]): string {
  return [...lines]
    .map((line) => {
      const quantity = Math.max(1, Number(line.quantity) || 1);
      const price = roundMoney2(Number(line.unitPrice) || 0).toFixed(2);
      const key = line.pricingKey ?? "";
      return `${line.description.trim()}|${quantity}|${price}|${key}`;
    })
    .sort()
    .join("\n");
}

export type PeakRecalcAdjustmentUpdate = {
  id?: string;
  adjustedAmount: number;
};

export type PeakRecalcMoney = {
  newTotal: number;
  difference: number;
  walletCredit: number;
  oldDiscount: number;
  newDiscount: number;
  discountPct: number;
  subtotal: number;
  vatAed: number;
  nextStatus: string;
  adjustmentAmounts: PeakRecalcAdjustmentUpdate[];
};

/**
 * A percent is reapplied only on the base it already matches: boarding-night
 * lines, or the whole invoice. Anything else stays at the stored AED amount.
 */
export function peakRecalcMoney(input: {
  status: string;
  amountPaid: number;
  oldTotal: number;
  previousSubtotal: number;
  nextSubtotal: number;
  /** Boarding night lines before this recalculation. Defaults to the full subtotal. */
  previousNightSubtotal?: number;
  /** Boarding night lines after this recalculation. Defaults to the full subtotal. */
  nextNightSubtotal?: number;
  discountPct: number;
  discountAmount: number;
  adjustments: ReapplyDiscountAdjustment[];
}): PeakRecalcMoney {
  const subtotal = roundMoney2(Math.max(0, input.nextSubtotal || 0));
  const previousSubtotal = roundMoney2(Math.max(0, input.previousSubtotal || 0));
  const oldNights = roundMoney2(Math.max(0, input.previousNightSubtotal ?? previousSubtotal));
  const newNights = roundMoney2(Math.max(0, input.nextNightSubtotal ?? subtotal));
  const bases = { oldNights, newNights, oldFull: previousSubtotal, newFull: subtotal };
  const headerPct = Math.min(100, Math.max(0, Number(input.discountPct) || 0));
  const headerAmount = roundMoney2(Math.max(0, Number(input.discountAmount) || 0));
  const adjustments = input.adjustments.filter((row) => DISCOUNT_ADJUSTMENT_TYPES.has(row.adjustment_type));
  const oldAdjustmentSum = roundMoney2(
    adjustments.reduce((sum, row) => sum + Math.abs(Number(row.adjusted_amount) || 0), 0),
  );
  const memberBesideAdjustments =
    headerAmount + 0.02 >= oldAdjustmentSum ? roundMoney2(Math.max(0, headerAmount - oldAdjustmentSum)) : 0;

  const ordered = [...adjustments].sort((a, b) => {
    const aPct = discountPercent(a);
    const bPct = discountPercent(b);
    if (aPct != null && bPct == null) return -1;
    if (aPct == null && bPct != null) return 1;
    return 0;
  });

  type Part = { id?: string; amount: number; percent: number | null; previous: number; recalculated: boolean };
  const parts: Part[] = [];
  let used = 0;
  for (const row of ordered) {
    const remaining = roundMoney2(Math.max(0, subtotal - used));
    const parsedPct = discountPercent(row);
    const previous = roundMoney2(Math.abs(Number(row.adjusted_amount) || 0));
    const repriced = parsedPct == null
      ? { amount: previous, recalculated: false }
      : percentOnOriginalBase(previous, parsedPct, bases);
    const amount = roundMoney2(Math.min(remaining, repriced.amount));
    used = roundMoney2(used + amount);
    parts.push({ id: row.id, amount, percent: parsedPct, previous, recalculated: repriced.recalculated });
  }

  let memberAmount = 0;
  let storedPct = headerPct;
  let memberRecalculated = false;
  const remainingAfterAdjustments = roundMoney2(Math.max(0, subtotal - used));
  if (adjustments.length === 0 && headerPct > 0) {
    const repriced = percentOnOriginalBase(headerAmount, headerPct, bases);
    memberAmount = roundMoney2(Math.min(subtotal, repriced.amount));
    memberRecalculated = repriced.recalculated;
  } else if (adjustments.length === 0 && headerAmount > 0) {
    memberAmount = roundMoney2(Math.min(subtotal, headerAmount));
  } else if (memberBesideAdjustments > 0.009 && headerPct > 0) {
    const repriced = percentOnOriginalBase(memberBesideAdjustments, headerPct, bases);
    memberAmount = roundMoney2(Math.min(remainingAfterAdjustments, repriced.amount));
    memberRecalculated = repriced.recalculated;
  } else if (memberBesideAdjustments > 0.009) {
    memberAmount = roundMoney2(Math.min(remainingAfterAdjustments, memberBesideAdjustments));
  }
  const recalculatedCount = parts.filter((part) => part.recalculated).length + (memberRecalculated ? 1 : 0);
  if (recalculatedCount === 1 && memberAmount <= 0.009) {
    const applied = parts.find((part) => part.recalculated);
    storedPct = applied?.percent ?? headerPct;
  }

  const newDiscount = roundMoney2(Math.min(subtotal, used + memberAmount));
  const oldTotal = roundMoney2(input.oldTotal);
  const newTotal = roundMoney2(Math.max(0, subtotal - newDiscount));
  return {
    newTotal,
    difference: roundMoney2(newTotal - oldTotal),
    walletCredit: walletCreditForPeakRecalc(input.status, input.amountPaid, newTotal),
    oldDiscount: headerAmount,
    newDiscount,
    discountPct: storedPct,
    subtotal,
    vatAed: vatAmountFromGrossInclusive(newTotal),
    nextStatus: deriveInvoiceStatusAfterRecalc(input.status, input.amountPaid, newTotal),
    adjustmentAmounts: parts
      .filter((part) => Math.abs(part.previous - part.amount) > 0.009)
      .map((part) => ({ id: part.id, adjustedAmount: part.amount })),
  };
}

function percentOnOriginalBase(
  stored: number,
  pct: number,
  bases: { oldNights: number; newNights: number; oldFull: number; newFull: number },
): { amount: number; recalculated: boolean } {
  const nightExpected = roundMoney2((bases.oldNights * pct) / 100);
  const fullExpected = roundMoney2((bases.oldFull * pct) / 100);
  const nightErr = Math.abs(roundMoney2(stored) - nightExpected);
  const fullErr = Math.abs(roundMoney2(stored) - fullExpected);
  if (nightErr <= PERCENT_BASE_TOLERANCE && nightErr <= fullErr) {
    return { amount: roundMoney2((bases.newNights * pct) / 100), recalculated: true };
  }
  if (fullErr <= PERCENT_BASE_TOLERANCE) {
    return { amount: roundMoney2((bases.newFull * pct) / 100), recalculated: true };
  }
  return { amount: roundMoney2(stored), recalculated: false };
}

function discountPercent(row: ReapplyDiscountAdjustment): number | null {
  return percentInDiscountText(row.reason) ?? percentInDiscountText(row.approved_by);
}

export function peakRecalcAmendmentReason(
  oldTotal: number,
  newTotal: number,
  walletCredit: number,
): string {
  const credit = walletCredit > 0.009 ? ` wallet_credit=${walletCredit.toFixed(2)}.` : "";
  return `Recalculated boarding nights from current peak periods. Total ${oldTotal.toFixed(2)} → ${newTotal.toFixed(2)}.${credit}`;
}

export function walletCreditInAmendmentReason(reason: string | null | undefined): number {
  const match = /wallet_credit=([0-9]+(?:\.[0-9]+)?)/.exec(reason ?? "");
  if (!match) return 0;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? roundMoney2(amount) : 0;
}
