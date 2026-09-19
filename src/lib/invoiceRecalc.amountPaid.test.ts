import { describe, expect, it } from "vitest";
import { amountPaidFromPaymentRows } from "@/lib/amountPaidFromPayments";

describe("amountPaidFromPaymentRows", () => {
  it("sums invoice_payments when rows exist", () => {
    expect(amountPaidFromPaymentRows(2796, [1398])).toBe(1398);
    expect(amountPaidFromPaymentRows(0, [100, 50.5])).toBe(150.5);
  });

  it("keeps stored amount_paid when no payment rows (legacy)", () => {
    expect(amountPaidFromPaymentRows(588, [])).toBe(588);
    expect(amountPaidFromPaymentRows(null, [])).toBe(0);
  });

  it("does not preserve an inflated stored value over payment sum", () => {
    expect(amountPaidFromPaymentRows(2796, [1398, 1398])).toBe(2796);
    expect(amountPaidFromPaymentRows(2796, [1398])).toBe(1398);
  });
});
