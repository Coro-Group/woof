import { describe, expect, it } from "vitest";
import { isPaidWithoutSettlement } from "@/lib/paidWithoutSettlement";

describe("isPaidWithoutSettlement", () => {
  it("flags paid invoices with zero amount_paid and no payment rows", () => {
    expect(
      isPaidWithoutSettlement({
        status: "paid",
        amountPaid: 0,
        grossTotal: 1000,
        hasPaymentRows: false,
      }),
    ).toBe(true);
  });

  it("ignores zero-value paid invoices", () => {
    expect(
      isPaidWithoutSettlement({
        status: "paid",
        amountPaid: 0,
        grossTotal: 0,
        hasPaymentRows: false,
      }),
    ).toBe(false);
  });

  it("ignores paid invoices that have amount_paid or payment rows", () => {
    expect(
      isPaidWithoutSettlement({
        status: "paid",
        amountPaid: 1000,
        grossTotal: 1000,
        hasPaymentRows: false,
      }),
    ).toBe(false);
    expect(
      isPaidWithoutSettlement({
        status: "paid",
        amountPaid: 0,
        grossTotal: 1000,
        hasPaymentRows: true,
      }),
    ).toBe(false);
  });

  it("ignores non-paid statuses", () => {
    expect(
      isPaidWithoutSettlement({
        status: "outstanding",
        amountPaid: 0,
        grossTotal: 1000,
        hasPaymentRows: false,
      }),
    ).toBe(false);
  });
});
