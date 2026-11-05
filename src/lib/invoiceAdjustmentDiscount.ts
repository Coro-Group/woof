import { roundAed } from "@/lib/money";

export type InvoiceDiscountMode = "percent" | "flat";

export function isPercentDiscountAdjustmentType(adjustmentType: string): boolean {
  return adjustmentType === "discount_override";
}

/** Flat AED discount from subtotal and percentage (capped at subtotal). */
export function discountFlatFromPercent(subtotal: number, percent: number): number {
  if (subtotal <= 0 || percent <= 0) return 0;
  const pct = Math.min(100, percent);
  return roundAed(Math.min(subtotal, (subtotal * pct) / 100));
}

/** Resolve staff-entered discount to a flat AED amount stored on the adjustment. */
export function resolveAdjustmentDiscountAmount(
  mode: InvoiceDiscountMode,
  value: number,
  subtotal: number,
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (mode === "percent") return discountFlatFromPercent(subtotal, value);
  return roundAed(Math.min(subtotal > 0 ? subtotal : value, value));
}

/** First percentage in a reason or approval note, such as "(15%)". */
export function percentInDiscountText(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const pct = Number(match[1]);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return Math.min(100, pct);
}

function formatDiscountPercent(percent: number): string {
  const rounded = Math.round((percent + Number.EPSILON) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** Invoice-detail lines for approved discount overrides. */
export function describeApprovedDiscountLines(
  adjustments: Array<{
    id?: string;
    adjustment_type: string;
    adjusted_amount: number | null;
    reason?: string | null;
    approved_by?: string | null;
  }>,
): Array<{ key: string; label: string; amount: number }> {
  return adjustments
    .filter((row) => row.adjustment_type === "discount_override")
    .map((row, index) => {
      const amount = Math.round((Math.abs(Number(row.adjusted_amount) || 0) + Number.EPSILON) * 100) / 100;
      const pct = percentInDiscountText(row.reason) ?? percentInDiscountText(row.approved_by);
      const approver = row.approved_by?.trim() || "staff";
      const pctLabel = pct == null ? "" : ` ${formatDiscountPercent(pct)}%`;
      return {
        key: row.id ?? `discount-${index}`,
        label: `Discount${pctLabel} — approved by ${approver}`,
        amount,
      };
    })
    .filter((row) => row.amount > 0.009);
}

export function discountReasonWithMode(
  reason: string,
  mode: InvoiceDiscountMode,
  enteredValue: number,
): string {
  const trimmed = reason.trim();
  if (mode !== "percent" || enteredValue <= 0) return trimmed;
  const suffix = `(${enteredValue}%)`;
  if (trimmed.includes(suffix)) return trimmed;
  return trimmed ? `${trimmed} ${suffix}` : suffix;
}
