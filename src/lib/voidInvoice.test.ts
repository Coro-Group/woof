import { describe, expect, it } from "vitest";
import {
  paidAmountForVoid,
  unpaidRemainderForVoid,
  voidInvoicePreviewText,
  voidInvoiceRefusal,
} from "@/lib/voidInvoiceMath";

describe("paidAmountForVoid", () => {
  it("sums payment rows when any exist", () => {
    expect(paidAmountForVoid([40, 60], 0)).toBe(100);
  });

  it("falls back to amount_paid when there are no payment rows", () => {
    expect(paidAmountForVoid([], 75.5)).toBe(75.5);
  });

  it("uses a zero sum of payment rows instead of amount_paid", () => {
    expect(paidAmountForVoid([0], 80)).toBe(0);
  });
});

describe("unpaidRemainderForVoid", () => {
  it("cancels only the unpaid part", () => {
    expect(unpaidRemainderForVoid(100, 40)).toBe(60);
    expect(unpaidRemainderForVoid(100, 100)).toBe(0);
    expect(unpaidRemainderForVoid(100, 0)).toBe(100);
  });
});

describe("voidInvoicePreviewText", () => {
  it("states the wallet credit and the cancelled remainder", () => {
    expect(voidInvoicePreviewText(40, 60)).toBe(
      "Paid AED 40.00 will be returned to the wallet as credit. Unpaid AED 60.00 will be cancelled.",
    );
  });
});

describe("voidInvoiceRefusal", () => {
  it("refuses voided, cancelled, and consolidated", () => {
    expect(voidInvoiceRefusal("voided")).toMatch(/already voided/);
    expect(voidInvoiceRefusal("cancelled")).toMatch(/cancelled/);
    expect(voidInvoiceRefusal("consolidated")).toMatch(/consolidated/);
    expect(voidInvoiceRefusal("paid")).toBeNull();
    expect(voidInvoiceRefusal("draft")).toBeNull();
  });
});
