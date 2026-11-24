import { describe, expect, it } from "vitest";
import {
  formatHourTick,
  formatTimeRange,
  groomingBoardPaymentLabel,
  nextFreeSlotMinutes,
} from "@/lib/groomingBoardUi";

describe("grooming calendar display", () => {
  it("shows a 10-minute booking as a 12-hour range", () => {
    expect(formatTimeRange("09:20:00", 10)).toBe("9:20 AM – 9:30 AM");
    expect(formatHourTick(8 * 60)).toBe("8 AM");
    expect(formatHourTick(13 * 60)).toBe("1 PM");
  });

  it("finds the next free slot without moving booked times", () => {
    expect(
      nextFreeSlotMinutes(
        [
          { startMin: 8 * 60, durationMin: 80 },
          { startMin: 9 * 60 + 30, durationMin: 10 },
        ],
        8 * 60,
        19 * 60,
      ),
    ).toBe(9 * 60 + 40);
  });

  it("labels a package-covered appointment as Package", () => {
    expect(
      groomingBoardPaymentLabel({
        status: "new",
        payment_method: null,
        invoice_status: "outstanding",
        coveredByPackage: true,
      }),
    ).toBe("Package");
    expect(
      groomingBoardPaymentLabel({
        status: "completed",
        payment_method: "card",
        invoice_status: "outstanding",
      }),
    ).toBe("Unpaid");
    expect(
      groomingBoardPaymentLabel({
        status: "paid",
        payment_method: "card",
        invoice_status: "paid",
      }),
    ).toBe("Paid");
  });
});
