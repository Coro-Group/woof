import { describe, expect, it } from "vitest";
import { outstandingInvoiceRemainder, resolveWalletChargeAmount, seedInvoicePaymentSplit } from "@/lib/accountBalance";

describe("seedInvoicePaymentSplit", () => {
  it("caps wallet seed at wallet balance when invoice exceeds wallet", () => {
    expect(seedInvoicePaymentSplit(30, 100)).toEqual({
      walletSeed: 30,
      cardSeed: 70,
    });
  });

  it("uses full invoice total when wallet covers it", () => {
    expect(seedInvoicePaymentSplit(200, 100)).toEqual({
      walletSeed: 100,
      cardSeed: 0,
    });
  });

  it("leaves card at zero when wallet is empty", () => {
    expect(seedInvoicePaymentSplit(0, 100)).toEqual({
      walletSeed: 0,
      cardSeed: 100,
    });
  });

  it("partial card entry does not inflate wallet beyond balance", () => {
    const { walletSeed } = seedInvoicePaymentSplit(30, 100);
    const cardEntered = 20;
    const remaining = 100 - walletSeed - cardEntered;
    expect(walletSeed).toBe(30);
    expect(remaining).toBe(50);
  });
});

describe("outstandingInvoiceRemainder", () => {
  it("grosses up a legacy ex-VAT total and prefers payment rows over amount_paid", () => {
    expect(
      outstandingInvoiceRemainder({
        total: 100,
        vatAed: null,
        serviceType: "boarding",
        notes: null,
        paymentAmounts: [40],
        amountPaid: 0,
      }),
    ).toBe(65);
  });

  it("treats a zero payment row as paid zero instead of falling back to amount_paid", () => {
    expect(
      outstandingInvoiceRemainder({
        total: 105,
        vatAed: 5,
        serviceType: "boarding",
        notes: null,
        paymentAmounts: [0],
        amountPaid: 105,
      }),
    ).toBe(105);
  });

  it("falls back to amount_paid when there are no payment rows", () => {
    expect(
      outstandingInvoiceRemainder({
        total: 105,
        vatAed: 5,
        serviceType: "boarding",
        notes: null,
        paymentAmounts: [],
        amountPaid: 40,
      }),
    ).toBe(65);
  });
});

describe("resolveWalletChargeAmount", () => {
  it("charges requested amount when within wallet and balance due", () => {
    expect(resolveWalletChargeAmount(20, 30, 100)).toBe(20);
  });

  it("caps at wallet balance when requested exceeds wallet", () => {
    expect(resolveWalletChargeAmount(50, 30, 100)).toBe(30);
  });

  it("caps at balance due when requested exceeds outstanding", () => {
    expect(resolveWalletChargeAmount(80, 100, 50)).toBe(50);
  });

  it("defaults to full balance due when amount omitted", () => {
    expect(resolveWalletChargeAmount(undefined, 30, 100)).toBe(30);
    expect(resolveWalletChargeAmount(undefined, 200, 100)).toBe(100);
  });

  it("returns zero when wallet is empty", () => {
    expect(resolveWalletChargeAmount(20, 0, 100)).toBe(0);
  });
});
