import { deriveInvoiceStatusAfterRecalc } from "@/lib/boardingInvoiceLineUtils";
import { percentInDiscountText } from "@/lib/invoiceAdjustmentDiscount";
import { roundMoney2, vatAmountFromGrossInclusive } from "@/lib/vatConfig";

const DISCOUNT_ADJUSTMENT_TYPES = new Set([
  "discount_override",
  "double_occupancy_discount",
  "fee_waived",
  "goodwill_credit",
  "adjustment",
]);

export type ReapplyDiscountAdjustment = {
  id?: string;
  adjustment_type: string;
  adjusted_amount: number | null;
  reason?: string | null;
  approved_by?: string | null;
};

export type ReapplyInvoiceDiscountInput = {
  /** Line subtotal before this recalculation (invoices.subtotal). */
  previousSubtotal: number;
  /** Line subtotal after lines were regenerated. */
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  adjustments: ReapplyDiscountAdjustment[];
  amountPaid: number;
  currentStatus: string;
};

export type ReapplyInvoiceDiscountResult = {
  subtotal: number;
  discountAmount: number;
  discountPct: number;
  total: number;
  vatAed: number;
  status: string;
  /** discount_override rows whose stored AED amount changed. */
  adjustmentAmounts: { id?: string; adjustedAmount: number }[];
};

function isDiscountAdjustment(type: string): boolean {
  return DISCOUNT_ADJUSTMENT_TYPES.has(type);
}

/**
 * Rebuild the invoice discount after lines change.
 * Percentage overrides (and a header percent that is not already an override)
 * are applied to the new subtotal. Fixed AED discounts stay, capped at the
 * new subtotal. Nothing that is already approved is dropped.
 */
export function reapplyInvoiceDiscount(input: ReapplyInvoiceDiscountInput): ReapplyInvoiceDiscountResult {
  const subtotal = roundMoney2(Math.max(0, input.subtotal || 0));
  const previousSubtotal = roundMoney2(Math.max(0, input.previousSubtotal || 0));
  const headerPct = Math.min(100, Math.max(0, Number(input.discountPct) || 0));
  const headerAmount = roundMoney2(Math.max(0, Number(input.discountAmount) || 0));
  const adjustments = input.adjustments.filter((row) => isDiscountAdjustment(row.adjustment_type));

  const oldAdjustmentSum = roundMoney2(
    adjustments.reduce((sum, row) => sum + Math.abs(Number(row.adjusted_amount) || 0), 0),
  );
  const memberBesideAdjustments =
    headerAmount + 0.02 >= oldAdjustmentSum ? roundMoney2(Math.max(0, headerAmount - oldAdjustmentSum)) : 0;

  type Part = { id?: string; type: string; amount: number; percent: number | null };
  const parts: Part[] = [];

  const ordered = [...adjustments].sort((a, b) => {
    const aPct = a.adjustment_type === "discount_override"
      ? percentInDiscountText(a.reason) ?? percentInDiscountText(a.approved_by)
      : null;
    const bPct = b.adjustment_type === "discount_override"
      ? percentInDiscountText(b.reason) ?? percentInDiscountText(b.approved_by)
      : null;
    if (aPct != null && bPct == null) return -1;
    if (aPct == null && bPct != null) return 1;
    return 0;
  });

  let used = 0;
  for (const row of ordered) {
    const remaining = roundMoney2(Math.max(0, subtotal - used));
    const parsedPct = row.adjustment_type === "discount_override"
      ? percentInDiscountText(row.reason) ?? percentInDiscountText(row.approved_by)
      : null;
    let amount = 0;
    if (parsedPct != null) {
      amount = roundMoney2(Math.min(remaining, (subtotal * parsedPct) / 100));
    } else {
      amount = roundMoney2(Math.min(remaining, Math.abs(Number(row.adjusted_amount) || 0)));
    }
    used = roundMoney2(used + amount);
    parts.push({
      id: row.id,
      type: row.adjustment_type,
      amount,
      percent: parsedPct,
    });
  }

  let memberAmount = 0;
  let storedPct = 0;
  const percentOverrides = parts.filter((part) => part.percent != null);
  const remainingAfterAdjustments = roundMoney2(Math.max(0, subtotal - used));
  if (adjustments.length === 0 && headerPct > 0) {
    memberAmount = roundMoney2(Math.min(subtotal, (subtotal * headerPct) / 100));
    storedPct = headerPct;
  } else if (adjustments.length === 0 && headerAmount > 0) {
    memberAmount = roundMoney2(Math.min(subtotal, headerAmount));
  } else if (memberBesideAdjustments > 0.009 && headerPct > 0 && previousSubtotal > 0) {
    const memberPct = roundMoney2((memberBesideAdjustments / previousSubtotal) * 100);
    memberAmount = roundMoney2(
      Math.min(remainingAfterAdjustments, (subtotal * memberPct) / 100),
    );
  } else if (memberBesideAdjustments > 0.009) {
    memberAmount = roundMoney2(Math.min(remainingAfterAdjustments, memberBesideAdjustments));
  }

  if (percentOverrides.length === 1 && memberAmount <= 0.009) {
    storedPct = percentOverrides[0].percent ?? 0;
  }

  const discountAmount = roundMoney2(Math.min(subtotal, used + memberAmount));
  const total = roundMoney2(Math.max(0, subtotal - discountAmount));
  const vatAed = vatAmountFromGrossInclusive(total);
  const status = deriveInvoiceStatusAfterRecalc(input.currentStatus, input.amountPaid, total);

  const adjustmentAmounts = parts
    .filter((part) => part.type === "discount_override")
    .filter((part) => {
      const original = adjustments.find((row) => row.id === part.id) ?? null;
      const previous = roundMoney2(Math.abs(Number(original?.adjusted_amount) || 0));
      return Math.abs(previous - part.amount) > 0.009;
    })
    .map((part) => ({ id: part.id, adjustedAmount: part.amount }));

  return {
    subtotal,
    discountAmount,
    discountPct: storedPct,
    total,
    vatAed,
    status,
    adjustmentAmounts,
  };
}
