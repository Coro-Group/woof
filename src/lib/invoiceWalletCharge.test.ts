import { describe, expect, it } from "vitest";
import {
  combinedInvoiceDiscount,
  invoiceWalletBalanceDue,
  invoiceWalletChargeTotal,
  memberDiscountBesideAdjustments,
} from "@/lib/invoiceWalletCharge";

describe("invoiceWalletChargeTotal", () => {
  it("charges the discounted total, not the pre-discount subtotal", () => {
    expect(
      invoiceWalletChargeTotal({ total: 75.6, subtotal: 94.5, discountAmount: 18.9 }),
    ).toBe(75.6);
    expect(
      invoiceWalletChargeTotal({ total: 54.6, subtotal: 68.25, discountAmount: 13.65 }),
    ).toBe(54.6);
  });

  it("does not charge the subtotal when the discount has not been copied onto total yet", () => {
    expect(
      invoiceWalletChargeTotal({ total: 94.5, subtotal: 94.5, discountAmount: 18.9 }),
    ).toBe(75.6);
  });

  it("charges total when there is no discount", () => {
    expect(
      invoiceWalletChargeTotal({ total: 94.5, subtotal: 94.5, discountAmount: 0 }),
    ).toBe(94.5);
  });
});

describe("invoiceWalletBalanceDue", () => {
  it("is total minus amount already paid", () => {
    expect(
      invoiceWalletBalanceDue({
        total: 75.6,
        subtotal: 94.5,
        discountAmount: 18.9,
        amountPaid: 20,
      }),
    ).toBe(55.6);
  });
});

describe("combinedInvoiceDiscount", () => {
  it("does not add an adjustment that is already inside the header discount", () => {
    expect(combinedInvoiceDiscount(18.9, 18.9)).toBe(18.9);
  });

  it("adds an adjustment that is not on the header yet", () => {
    expect(combinedInvoiceDiscount(18.9, 30)).toBe(48.9);
  });
});

describe("memberDiscountBesideAdjustments", () => {
  it("keeps the member portion that is not already an adjustment", () => {
    expect(memberDiscountBesideAdjustments(18.9, 0)).toBe(18.9);
    expect(memberDiscountBesideAdjustments(30, 11.1)).toBe(18.9);
    expect(memberDiscountBesideAdjustments(18.9, 30)).toBe(18.9);
  });
});
