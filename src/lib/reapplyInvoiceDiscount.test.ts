import { describe, expect, it } from "vitest";
import { describeApprovedDiscountLines } from "@/lib/invoiceAdjustmentDiscount";
import { reapplyInvoiceDiscount, type ReapplyDiscountAdjustment } from "@/lib/reapplyInvoiceDiscount";
import { vatAmountFromGrossInclusive } from "@/lib/vatConfig";

function percentOverride(amount: number, percent = 15): ReapplyDiscountAdjustment {
  return {
    id: "override-1",
    adjustment_type: "discount_override",
    adjusted_amount: amount,
    reason: `sharing with Luna Azmi (${percent}%)`,
    approved_by: "Lourdes",
  };
}

describe("reapplyInvoiceDiscount", () => {
  const night = 100;

  it("re-applies 15% when the stay is extended by one night", () => {
    const before = 14 * night;
    const after = 15 * night;
    const result = reapplyInvoiceDiscount({
      previousSubtotal: before,
      subtotal: after,
      discountPct: 15,
      discountAmount: 210,
      adjustments: [percentOverride(210)],
      amountPaid: 0,
      currentStatus: "outstanding",
    });
    expect(result.discountPct).toBe(15);
    expect(result.discountAmount).toBe(225);
    expect(result.total).toBe(1500 - 225);
    expect(result.adjustmentAmounts).toEqual([{ id: "override-1", adjustedAmount: 225 }]);
  });

  it("re-applies 15% when the stay is shortened", () => {
    const result = reapplyInvoiceDiscount({
      previousSubtotal: 14 * night,
      subtotal: 13 * night,
      discountPct: 15,
      discountAmount: 210,
      adjustments: [percentOverride(210)],
      amountPaid: 0,
      currentStatus: "outstanding",
    });
    expect(result.discountAmount).toBe(195);
    expect(result.total).toBe(1300 - 195);
    expect(result.discountPct).toBe(15);
  });

  it("re-applies 15% after a drop-off line is added", () => {
    const result = reapplyInvoiceDiscount({
      previousSubtotal: 1400,
      subtotal: 1480,
      discountPct: 15,
      discountAmount: 210,
      adjustments: [percentOverride(210)],
      amountPaid: 0,
      currentStatus: "outstanding",
    });
    expect(result.discountAmount).toBe(222);
    expect(result.total).toBe(1480 - 222);
  });

  it("keeps a fixed AED 100 discount when a line is added", () => {
    const result = reapplyInvoiceDiscount({
      previousSubtotal: 400,
      subtotal: 480,
      discountPct: 25,
      discountAmount: 100,
      adjustments: [{
        id: "flat-1",
        adjustment_type: "discount_override",
        adjusted_amount: 100,
        reason: "goodwill",
        approved_by: "Lourdes",
      }],
      amountPaid: 0,
      currentStatus: "outstanding",
    });
    expect(result.discountAmount).toBe(100);
    expect(result.total).toBe(380);
    expect(result.discountPct).toBe(0);
    expect(result.adjustmentAmounts).toEqual([]);
  });

  it("caps a fixed discount that is larger than the new total", () => {
    const result = reapplyInvoiceDiscount({
      previousSubtotal: 400,
      subtotal: 80,
      discountPct: 25,
      discountAmount: 100,
      adjustments: [{
        id: "flat-1",
        adjustment_type: "discount_override",
        adjusted_amount: 100,
        reason: "goodwill",
        approved_by: "Lourdes",
      }],
      amountPaid: 0,
      currentStatus: "outstanding",
    });
    expect(result.discountAmount).toBe(80);
    expect(result.total).toBe(0);
    expect(result.adjustmentAmounts).toEqual([{ id: "flat-1", adjustedAmount: 80 }]);
  });

  it("keeps a partially paid invoice partially paid when the new total is still above the payment", () => {
    const result = reapplyInvoiceDiscount({
      previousSubtotal: 1400,
      subtotal: 1500,
      discountPct: 15,
      discountAmount: 210,
      adjustments: [percentOverride(210)],
      amountPaid: 200,
      currentStatus: "partially_paid",
    });
    expect(result.total).toBe(1275);
    expect(result.status).toBe("partially_paid");
    expect(result.vatAed).toBe(vatAmountFromGrossInclusive(1275));
  });

  it("marks the invoice paid when a shorter stay brings the total down to the amount already paid", () => {
    const result = reapplyInvoiceDiscount({
      previousSubtotal: 1400,
      subtotal: 200,
      discountPct: 15,
      discountAmount: 210,
      adjustments: [percentOverride(210)],
      amountPaid: 180,
      currentStatus: "partially_paid",
    });
    expect(result.discountAmount).toBe(30);
    expect(result.total).toBe(170);
    expect(result.status).toBe("paid");
  });
});

describe("describeApprovedDiscountLines", () => {
  it("shows the approved percent discount", () => {
    expect(describeApprovedDiscountLines([{
      id: "override-1",
      adjustment_type: "discount_override",
      adjusted_amount: 242.55,
      reason: "sharing with Luna Azmi (15%)",
      approved_by: "Lourdes",
    }])).toEqual([{
      key: "override-1",
      label: "Discount 15% — approved by Lourdes",
      amount: 242.55,
    }]);
  });
});
