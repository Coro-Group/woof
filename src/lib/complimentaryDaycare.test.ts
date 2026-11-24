import { describe, expect, it } from "vitest";
import {
  complimentaryCreditIdFromChoice,
  complimentaryDaycareChoiceValue,
  complimentaryDaycareLine,
  complimentaryDaycareSummary,
} from "@/lib/complimentaryDaycare";

describe("complimentary daycare days", () => {
  it("formats the package line as total, used, and remaining", () => {
    expect(complimentaryDaycareSummary(2, 0)).toBe(
      "Complimentary daycare: 2 days · used 0 · remaining 2",
    );
    expect(complimentaryDaycareSummary(2, 1)).toBe(
      "Complimentary daycare: 2 days · used 1 · remaining 1",
    );
  });

  it("prices a used day at AED 0 with the SSPL note", () => {
    expect(complimentaryDaycareLine("Miso")).toEqual({
      description: "Daycare — Miso — Complimentary (SSPL package)",
      quantity: 1,
      unitPrice: 0,
      serviceType: "daycare",
      preserveUnitPrice: true,
    });
  });

  it("keeps a complimentary choice distinct from a paid package id", () => {
    const choice = complimentaryDaycareChoiceValue("credit-1");
    expect(complimentaryCreditIdFromChoice(choice)).toBe("credit-1");
    expect(complimentaryCreditIdFromChoice("hourly")).toBeNull();
    expect(complimentaryCreditIdFromChoice("single")).toBeNull();
  });
});
