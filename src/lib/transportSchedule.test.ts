import { describe, expect, it } from "vitest";
import {
  dubaiToday,
  groupByTime,
  liveStops,
  mergeDemand,
  regularPausedOn,
  shiftIsoDate,
  weekdayOf,
  type DemandRow,
} from "@/lib/transportSchedule";

function row(partial: Partial<DemandRow>): DemandRow {
  return {
    source: "regular",
    source_id: "src",
    branch_id: "main",
    owner_id: "owner",
    pet_id: "pet-1",
    direction: "pickup",
    run_time: null,
    status: "scheduled",
    location_text: null,
    location_lat: null,
    location_lng: null,
    note: null,
    ...partial,
  };
}

describe("mergeDemand", () => {
  it("shows a dog on a regular who is also logged at daycare once, as the regular", () => {
    const stops = mergeDemand([
      row({ source: "daycare", source_id: "session" }),
      row({ source: "regular", source_id: "rule", run_time: "08:30:00" }),
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0].source).toBe("regular");
    expect(stops[0].sources).toEqual(["regular", "daycare"]);
    expect(stops[0].time).toBe("08:30");
  });

  it("lets a one-off request win over a regular for the same run", () => {
    const stops = mergeDemand([
      row({ source: "regular", run_time: "08:30:00" }),
      row({ source: "request", source_id: "req", run_time: "10:00:00", status: "received" }),
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0].source).toBe("request");
    expect(stops[0].time).toBe("10:00");
    expect(stops[0].status).toBe("received");
  });

  it("strikes the regular run a skip covers, and only that direction", () => {
    const stops = mergeDemand([
      row({ source: "regular", direction: "pickup" }),
      row({ source: "regular", direction: "dropoff" }),
      row({ source: "skip", direction: "pickup" }),
    ]);
    expect(liveStops(stops).map((s) => s.direction)).toEqual(["dropoff"]);
    const pickup = stops.find((s) => s.direction === "pickup")!;
    expect(pickup.struck).toBe("Cancelled");
    expect(pickup.badge).toBe("cancelled");
  });

  it("lets an approved cancel-day strike a one-off for that day too", () => {
    const stops = mergeDemand([row({ source: "request", run_time: "09:00:00" }), row({ source: "skip" })]);
    expect(liveStops(stops)).toHaveLength(0);
    expect(stops[0].struck).toBe("Cancelled");
  });

  it("does not let a skip remove a boarding run", () => {
    const stops = mergeDemand([row({ source: "boarding" }), row({ source: "skip" })]);
    expect(stops).toHaveLength(1);
    expect(stops[0].source).toBe("boarding");
    expect(stops[0].struck).toBeNull();
  });

  it("keeps a paused regular as a struck row, and a live run wins over it", () => {
    const paused = mergeDemand([row({ struck: "Paused" })]);
    expect(paused[0].struck).toBe("Paused");
    expect(paused[0].badge).toBe("paused");
    const daycare = mergeDemand([row({ struck: "Paused" }), row({ source: "daycare" })]);
    expect(daycare[0].struck).toBeNull();
    expect(daycare[0].source).toBe("daycare");
  });

  it("strikes the run a move replaced, and shows the moved-in run on its new date", () => {
    const oldDay = mergeDemand([
      row({ source: "regular", run_time: "08:00:00" }),
      row({ source: "moved", kind: "change", moved_date: "2026-11-05" }),
    ]);
    expect(oldDay[0].struck).toBe("Moved to 2026-11-05");
    expect(oldDay[0].badge).toBe("moved");
    const newDay = mergeDemand([row({ source: "request", kind: "change", moved_date: "2026-11-02", run_time: "10:00:00" })]);
    expect(newDay[0].badge).toBe("moved_in");
    expect(newDay[0].movedDate).toBe("2026-11-02");
    // A move whose old run is not otherwise on the board still says where it went.
    const bare = mergeDemand([row({ source: "moved", kind: "change", moved_date: "2026-11-05" })]);
    expect(bare[0].struck).toBe("Moved to 2026-11-05");
  });

  it("keeps trips to and from the vet apart from the dog's home runs", () => {
    const stops = mergeDemand([
      row({ source: "regular", direction: "pickup", run_time: "08:00:00" }),
      row({ source: "regular", direction: "dropoff", run_time: "17:00:00" }),
      row({ source: "request", source_id: "out", direction: "dropoff", purpose: "vet", deadline_min: 615, run_time: "09:15:00" }),
      row({ source: "request", source_id: "back", direction: "pickup", purpose: "vet", run_time: "11:00:00" }),
    ]);
    expect(liveStops(stops)).toHaveLength(4);
    // The drop-off home after a vet visit does stand in for the evening drop-off.
    const home = mergeDemand([
      row({ source: "regular", direction: "dropoff", run_time: "17:00:00" }),
      row({ source: "request", source_id: "home", direction: "dropoff", purpose: "vet", run_time: "17:30:00" }),
    ]);
    expect(home).toHaveLength(1);
    expect(home[0].badge).toBe("vet");
  });

  it("marks vet legs and keeps their window and deadline", () => {
    const [vet] = mergeDemand([
      row({ source: "request", direction: "dropoff", purpose: "vet", run_time: "09:15:00", deadline_min: 615, window_start_min: 555, window_end_min: 615 }),
    ]);
    expect(vet.badge).toBe("vet");
    expect(vet.deadlineMin).toBe(615);
    expect(vet.time).toBe("09:15");
  });

  it("keeps different pets and directions apart and orders pickups first by time", () => {
    const stops = mergeDemand([
      row({ pet_id: "b", direction: "dropoff", run_time: "17:00:00" }),
      row({ pet_id: "a", direction: "pickup", run_time: "09:00:00" }),
      row({ pet_id: "c", direction: "pickup" }),
      row({ pet_id: "d", direction: "pickup", run_time: "07:45:00" }),
    ]);
    expect(stops.map((s) => `${s.direction}:${s.petId}`)).toEqual([
      "pickup:d",
      "pickup:a",
      "pickup:c",
      "dropoff:b",
    ]);
  });

  it("takes a time from a lower-priority source when the winner has none", () => {
    const stops = mergeDemand([
      row({ source: "request", run_time: null }),
      row({ source: "regular", run_time: "08:15:00" }),
    ]);
    expect(stops[0].source).toBe("request");
    expect(stops[0].time).toBe("08:15");
  });
});

describe("groupByTime", () => {
  it("groups consecutive stops by time label", () => {
    const groups = groupByTime([{ time: "08:00" }, { time: "08:00" }, { time: "09:00" }, { time: null }]);
    expect(groups.map((g) => [g.label, g.stops.length])).toEqual([
      ["08:00", 2],
      ["09:00", 1],
      ["No time set", 1],
    ]);
  });
});

describe("dates", () => {
  it("matches Postgres extract(dow): 0 = Sunday", () => {
    expect(weekdayOf("2026-11-01")).toBe(0);
    expect(weekdayOf("2026-10-30")).toBe(5);
  });

  it("shifts ISO dates across month ends", () => {
    expect(shiftIsoDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("returns an ISO date for Dubai today", () => {
    expect(dubaiToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("knows when a regular is paused", () => {
    const open = { paused_from: "2026-11-01", paused_until: null };
    const bounded = { paused_from: "2026-11-01", paused_until: "2026-11-05" };
    expect(regularPausedOn(open, "2026-10-31")).toBe(false);
    expect(regularPausedOn(open, "2027-01-01")).toBe(true);
    expect(regularPausedOn(bounded, "2026-11-05")).toBe(true);
    expect(regularPausedOn(bounded, "2026-11-06")).toBe(false);
    expect(regularPausedOn({ paused_from: null, paused_until: null }, "2026-11-01")).toBe(false);
  });
});
