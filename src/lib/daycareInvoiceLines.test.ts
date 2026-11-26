import { describe, expect, it } from "vitest";

import { buildPriceMap } from "@/lib/servicePricing";
import {
  buildDaycareHourlyLineItems,
  buildDaycareSingleDayLineItems,
  buildDaycareTrainLineItems,
} from "./daycareInvoiceLines";

describe("daycareInvoiceLines", () => {
  const prices = buildPriceMap([
    { key: "daycare_single_day", amount_aed: 100 },
    { key: "daycare_2_dogs", amount_aed: 180 },
    { key: "daycare_hourly_single_day", amount_aed: 25 },
  ]);

  it("builds per-pet full-day lines with session date", () => {
    const lines = buildDaycareSingleDayLineItems({
      petIds: ["pet-a", "pet-b"],
      pets: [
        { id: "pet-a", name: "Max" },
        { id: "pet-b", name: "Buddy" },
      ],
      sessionDate: "2026-05-27",
      prices,
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      description: "Max — Daycare full day — 27 May 2026",
      quantity: 1,
      unitPrice: 90,
      serviceType: "daycare",
    });
    expect(lines[1].description).toBe("Buddy — Daycare full day — 27 May 2026");
  });

  it("bills Daycare & Train at the per-dog rate with its own line name", () => {
    const lines = buildDaycareTrainLineItems({
      petIds: ["pet-a"],
      pets: [{ id: "pet-a", name: "Rocky" }],
      sessionDate: "2026-11-26",
      unitPrice: 155,
    });
    expect(lines).toEqual([
      {
        description: "Daycare & Train — Rocky — 26 Nov 2026",
        quantity: 1,
        unitPrice: 155,
        pricingKey: "daycare_and_train",
        serviceType: "daycare",
        preserveUnitPrice: true,
      },
    ]);
  });

  it("builds per-pet hourly lines with hours in description", () => {
    const lines = buildDaycareHourlyLineItems({
      petIds: ["pet-a"],
      pets: [{ id: "pet-a", name: "Max" }],
      sessionDate: "2026-05-27",
      hours: 3,
      prices,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: "Max — Daycare hourly — 27 May 2026 (3 hrs)",
      quantity: 6,
      unitPrice: 12.5,
      serviceType: "daycare",
    });
  });
});
