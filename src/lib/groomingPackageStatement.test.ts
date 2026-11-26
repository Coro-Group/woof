import { describe, expect, it } from "vitest";
import {
  assignCoveredVisits,
  groomingSoldPackageStatus,
  isUpcomingPackageAppointment,
  lineMatchesPackageUse,
  parsePackageUseDateLabel,
  sessionsLeft,
  unlinkedSessionCount,
} from "./groomingPackageStatement";

const SHORT = "6 Summer Splash (Short Hair)";
const LONG = "6 Summer Splash (Long Hair)";

function rockyLine(dateLabel: string, pet = "Rocky"): string {
  return `Summer Splash short hair — ${pet} — ${dateLabel} (base covered by ${SHORT})`;
}

describe("lineMatchesPackageUse", () => {
  it("reads the service, pet, and date from a covered grooming line", () => {
    const match = lineMatchesPackageUse(rockyLine("3 Mar 2026"), [SHORT], "Rocky", false);
    expect(match).toEqual({
      petName: "Rocky",
      service: "Summer Splash short hair",
      dateLabel: "3 Mar 2026 (base covered by 6 Summer Splash (Short Hair))",
    });
    expect(parsePackageUseDateLabel(match?.dateLabel)).toBe("2026-03-03");
  });

  it("rejects a different package name and a different pet", () => {
    expect(lineMatchesPackageUse(rockyLine("3 Mar 2026"), [LONG], "Rocky", false)).toBeNull();
    expect(lineMatchesPackageUse(rockyLine("3 Mar 2026", "Luna"), [SHORT], "Rocky", false)).toBeNull();
  });

  it("includes another pet only when the credit is a shared pool", () => {
    const line = rockyLine("3 Mar 2026", "Luna");
    expect(lineMatchesPackageUse(line, [SHORT], "Rocky", true)?.petName).toBe("Luna");
  });
});

describe("assignCoveredVisits", () => {
  it("returns every used visit, oldest first, for one exhausted package", () => {
    const visits = [
      { date: "2026-06-01", id: "f" },
      { date: "2026-01-04", id: "a" },
      { date: "2026-02-02", id: "b" },
      { date: "2026-03-03", id: "c" },
      { date: "2026-04-04", id: "d" },
      { date: "2026-05-05", id: "e" },
    ];
    const assigned = assignCoveredVisits(
      "rocky",
      [{ id: "rocky", unitsConsumed: 6, purchaseDate: "2026-01-01" }],
      visits,
    );
    expect(assigned.map((visit) => visit.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("gives later visits, including an upcoming one, to the active renewal", () => {
    const visits = [
      { date: "2026-01-10" },
      { date: "2026-02-10" },
      { date: "2026-03-10" },
      { date: "2026-04-10" },
      { date: "2026-05-10" },
      { date: "2026-06-10" },
      { date: "2026-07-01" },
      { date: "2026-12-01" },
    ];
    const credits = [
      { id: "exhausted", unitsConsumed: 6, purchaseDate: "2026-01-01" },
      { id: "active", unitsConsumed: 2, purchaseDate: "2026-07-01" },
    ];
    expect(assignCoveredVisits("exhausted", credits, visits)).toHaveLength(6);
    expect(assignCoveredVisits("active", credits, visits).map((visit) => visit.date)).toEqual([
      "2026-07-01",
      "2026-12-01",
    ]);
  });
});

describe("package statement status", () => {
  it("marks 6/6 exhausted and keeps sessions left at zero", () => {
    expect(
      groomingSoldPackageStatus({
        sessionsUsed: 6,
        sessionsTotal: 6,
        expiryDate: "2026-12-01",
        today: "2026-11-26",
      }),
    ).toBe("Exhausted");
    expect(sessionsLeft(6, 6)).toBe(0);
    expect(unlinkedSessionCount(6, 6)).toBe(0);
    expect(unlinkedSessionCount(6, 4)).toBe(2);
  });

  it("treats a future booked visit as upcoming and a completed visit as history only", () => {
    expect(isUpcomingPackageAppointment("2026-12-01", "new", "2026-11-26")).toBe(true);
    expect(isUpcomingPackageAppointment("2026-06-01", "completed", "2026-11-26")).toBe(false);
    expect(isUpcomingPackageAppointment("2026-12-01", "cancelled", "2026-11-26")).toBe(false);
  });
});
