import { describe, expect, it } from "vitest";

import { isBoardingNightLineItem } from "@/lib/boardingInvoiceLineUtils";
import {
  boardingNightLinesMatch,
  bookingOverlapsPeakRecalcWindow,
  peakRecalcMoney,
  walletCreditForPeakRecalc,
  walletCreditInAmendmentReason,
} from "@/lib/peakPricingRecalcDecision";

describe("peak pricing recalculation", () => {
  it("includes stays with a night in 30 Nov – 4 Dec 2026", () => {
    expect(bookingOverlapsPeakRecalcWindow("2026-11-22", "2026-12-02")).toBe(true);
    expect(bookingOverlapsPeakRecalcWindow("2026-12-02", "2026-12-04")).toBe(true);
    expect(bookingOverlapsPeakRecalcWindow("2026-12-04", "2026-12-05")).toBe(true);
    expect(bookingOverlapsPeakRecalcWindow("2026-11-29", "2026-11-30")).toBe(false);
    expect(bookingOverlapsPeakRecalcWindow("2026-12-05", "2026-12-08")).toBe(false);
  });

  it("credits only money already collected above the new total", () => {
    expect(walletCreditForPeakRecalc("paid", 1179, 1155)).toBe(24);
    expect(walletCreditForPeakRecalc("partially_paid", 100, 176)).toBe(0);
    expect(walletCreditForPeakRecalc("partially_paid", 200, 176)).toBe(24);
    expect(walletCreditForPeakRecalc("draft", 0, 437.1)).toBe(0);
    expect(walletCreditForPeakRecalc("outstanding", 0, 100)).toBe(0);
    expect(walletCreditForPeakRecalc("voided", 100, 50)).toBe(0);
  });

  it("INV-2026-11616 Brian: two peak nights drop the paid total by 24", () => {
    const money = peakRecalcMoney({
      status: "paid",
      amountPaid: 1179,
      oldTotal: 1179,
      previousSubtotal: 1179,
      nextSubtotal: 1155,
      discountPct: 0,
      discountAmount: 0,
      adjustments: [],
    });
    expect(money.newTotal).toBe(1155);
    expect(money.difference).toBe(-24);
    expect(money.walletCredit).toBe(24);
    expect(
      isBoardingNightLineItem({
        service_type: "boarding",
        pricing_key: "boarding_night",
        description: "Brian — Boarding — Peak — 30 Nov – 1 Dec 2026 (2 nights)",
      }),
    ).toBe(true);
    expect(
      boardingNightLinesMatch(
        [
          {
            description: "Brian — Boarding — Off-peak — 22 Nov – 29 Nov 2026 (8 nights)",
            quantity: 8,
            unitPrice: 115.5,
            pricingKey: "boarding_night",
          },
          {
            description: "Brian — Boarding — Peak — 30 Nov – 1 Dec 2026 (2 nights)",
            quantity: 2,
            unitPrice: 127.5,
            pricingKey: "boarding_night",
          },
        ],
        [
          {
            description: "Brian — Boarding — Off-peak — 22 Nov – 1 Dec 2026 (10 nights)",
            quantity: 10,
            unitPrice: 115.5,
            pricingKey: "boarding_night",
          },
        ],
      ),
    ).toBe(false);
  });

  it("INV-2026-12383 Axel and Dexter: a higher draft total is not credited", () => {
    const money = peakRecalcMoney({
      status: "draft",
      amountPaid: 0,
      oldTotal: 413.1,
      previousSubtotal: 486,
      nextSubtotal: 510,
      discountPct: 0,
      discountAmount: 72.9,
      adjustments: [
        {
          adjustment_type: "double_occupancy_discount",
          adjusted_amount: -72.9,
          reason: "Double occupancy 15% discount (2 pets sharing room)",
          approved_by: "system",
        },
      ],
    });
    expect(money.newTotal).toBe(433.5);
    expect(money.newDiscount).toBe(76.5);
    expect(money.oldDiscount).toBe(72.9);
    expect(money.difference).toBe(20.4);
    expect(money.walletCredit).toBe(0);
    expect(
      boardingNightLinesMatch(
        [
          {
            description: "Axel — Boarding — Peak — 2 Dec 2026 (1 night)",
            quantity: 1,
            unitPrice: 127.5,
            pricingKey: "boarding_night",
          },
          {
            description: "Axel — Boarding — Off-peak — 3 Dec 2026 (1 night)",
            quantity: 1,
            unitPrice: 115.5,
            pricingKey: "boarding_night",
          },
        ],
        [
          {
            description: "Axel — Boarding — Peak — 2 Dec – 3 Dec 2026 (2 nights)",
            quantity: 2,
            unitPrice: 127.5,
            pricingKey: "boarding_night",
          },
        ],
      ),
    ).toBe(false);
  });

  it("keeps a fixed AED discount when the reason has no percent", () => {
    const money = peakRecalcMoney({
      status: "outstanding",
      amountPaid: 0,
      oldTotal: 100,
      previousSubtotal: 110,
      nextSubtotal: 130,
      discountPct: 0,
      discountAmount: 10,
      adjustments: [
        {
          adjustment_type: "goodwill_credit",
          adjusted_amount: 10,
          reason: "Goodwill",
          approved_by: "staff",
        },
      ],
    });
    expect(money.newDiscount).toBe(10);
    expect(money.newTotal).toBe(120);
    expect(money.walletCredit).toBe(0);
  });

  it("INV-2026-12505 applies 15% to boarding nights only, not transport", () => {
    const money = peakRecalcMoney({
      status: "draft",
      amountPaid: 0,
      oldTotal: 2014.75,
      previousSubtotal: 2337.4,
      nextSubtotal: 2313.4,
      previousNightSubtotal: 2151,
      nextNightSubtotal: 2127,
      discountPct: 0,
      discountAmount: 322.65,
      adjustments: [
        {
          adjustment_type: "double_occupancy_discount",
          adjusted_amount: -322.65,
          reason: "Double occupancy 15% discount (2 pets sharing room)",
          approved_by: "system",
        },
      ],
    });
    expect(money.newDiscount).toBe(319.05);
    expect(money.newTotal).toBe(1994.35);
    expect(money.difference).toBe(-20.4);
  });

  it("INV-2026-10201 keeps 334.95 when 10% does not match the night or invoice base", () => {
    const money = peakRecalcMoney({
      status: "partially_paid",
      amountPaid: 1500,
      oldTotal: 3524.55,
      previousSubtotal: 3859.5,
      nextSubtotal: 3859.5,
      previousNightSubtotal: 3859.5,
      nextNightSubtotal: 3859.5,
      discountPct: 8.68,
      discountAmount: 334.95,
      adjustments: [
        {
          adjustment_type: "discount_override",
          adjusted_amount: 334.95,
          reason: "Long stay-10% on non peak period.",
          approved_by: "Lourdes",
        },
      ],
    });
    expect(money.newDiscount).toBe(334.95);
    expect(money.difference).toBe(0);
    expect(money.adjustmentAmounts).toEqual([]);
  });

  it("reads a logged wallet credit back from the amendment reason", () => {
    expect(
      walletCreditInAmendmentReason(
        "Recalculated boarding nights from current peak periods. Total 1179.00 → 1155.00. wallet_credit=24.00.",
      ),
    ).toBe(24);
    expect(walletCreditInAmendmentReason("No credit")).toBe(0);
  });
});
