import { describe, expect, it } from "vitest";
import { groupBySlot, mergeDemand, runSlotLabel, slotLabelFor, slotStartOf, type DemandRow } from "@/lib/transportSchedule";

describe("slotLabelFor", () => {
  it("matches AE's transport_slots labels", () => {
    expect(slotLabelFor(360)).toBe("06-07AM");
    expect(slotLabelFor(420)).toBe("07-08AM");
    expect(slotLabelFor(600)).toBe("10-11AM");
    expect(slotLabelFor(660)).toBe("11-12PM");
    expect(slotLabelFor(720)).toBe("12-1PM");
    expect(slotLabelFor(780)).toBe("1-2PM");
    expect(slotLabelFor(1200)).toBe("8-9PM");
  });
});

describe("runSlotLabel", () => {
  it("is the hour slot a time falls in", () => {
    expect(slotStartOf("07:45")).toBe(420);
    expect(runSlotLabel("07:45:00")).toBe("07-08AM");
    expect(runSlotLabel(null)).toBeNull();
  });
  it("is the flexible window when one is set", () => {
    expect(runSlotLabel("06:00", 360, 540)).toBe("6–9 AM · flexible");
  });
});

describe("groupBySlot", () => {
  it("groups by hour, earliest first, untimed last", () => {
    const groups = groupBySlot([{ time: "08:30" }, { time: null }, { time: "07:00" }, { time: "08:00" }]);
    expect(groups.map((g) => [g.label, g.stops.length])).toEqual([
      ["07-08AM", 1],
      ["08-09AM", 2],
      ["No slot time set", 1],
    ]);
  });
});

describe("cross-branch regulars", () => {
  const base = {
    branch_id: "bb",
    owner_id: "o1",
    pet_id: "p1",
    status: "scheduled",
    location_text: null,
    location_lat: null,
    location_lng: null,
    note: null,
  };
  it("are their own branch-move stop, struck by a cancel-day", () => {
    const rows: DemandRow[] = [
      { ...base, source: "regular", source_id: "r1", direction: "pickup", run_time: "08:00", purpose: "transfer", transfer_from_branch_id: "bb", transfer_to_branch_id: "dip" },
      { ...base, source: "skip", source_id: "s1", direction: "pickup", run_time: null, purpose: "regular", kind: "cancel" },
    ];
    const [stop] = mergeDemand(rows);
    expect(stop.badge).toBe("cancelled");
    expect(stop.transferToBranchId).toBe("dip");
  });
  it("run when nothing cancels them", () => {
    const [stop] = mergeDemand([
      { ...base, source: "regular", source_id: "r1", direction: "dropoff", run_time: null, purpose: "transfer", transfer_from_branch_id: "dip", transfer_to_branch_id: "bb" },
    ]);
    expect(stop.struck).toBeNull();
    expect(stop.badge).toBe("transfer");
  });
});
