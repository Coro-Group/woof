import { isInactiveInvoiceStatus } from "@/lib/invoiceStatus";
import {
  reapplyInvoiceDiscount,
  type ReapplyDiscountAdjustment,
} from "@/lib/reapplyInvoiceDiscount";
import { roundMoney2 } from "@/lib/vatConfig";

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

export function peakRecalcMoney(input: {
  status: string;
  amountPaid: number;
  oldTotal: number;
  previousSubtotal: number;
  nextSubtotal: number;
  discountPct: number;
  discountAmount: number;
  adjustments: ReapplyDiscountAdjustment[];
}): { newTotal: number; difference: number; walletCredit: number } {
  const repriced = reapplyInvoiceDiscount({
    previousSubtotal: input.previousSubtotal,
    subtotal: input.nextSubtotal,
    discountPct: input.discountPct,
    discountAmount: input.discountAmount,
    adjustments: input.adjustments,
    amountPaid: input.amountPaid,
    currentStatus: input.status,
  });
  const oldTotal = roundMoney2(input.oldTotal);
  const newTotal = roundMoney2(repriced.total);
  return {
    newTotal,
    difference: roundMoney2(newTotal - oldTotal),
    walletCredit: walletCreditForPeakRecalc(input.status, input.amountPaid, newTotal),
  };
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
