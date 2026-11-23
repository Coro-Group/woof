import { describe, expect, it } from "vitest";
import {
  boardingClashes,
  boardingPauseReason,
  ownWindowLabel,
  mergeDemand,
  pausedLabel,
  transferDefaultDirection,
  type DemandRow,
} from "./transportSchedule";

const row = (over: Partial<DemandRow>): DemandRow => ({
  source: "regular",
  source_id: "s1",
  branch_id: "b1",
  owner_id: "o1",
  pet_id: "p1",
  direction: "dropoff",
  run_time: "17:00:00",
  status: "scheduled",
  location_text: null,
  location_lat: null,
  location_lng: null,
  note: null,
  purpose: "regular",
  ...over,
});

describe("boardingPauseReason", () => {
  it("pauses the drop-off on check-in day and keeps the pickup", () => {
    expect(boardingPauseReason("2026-11-16", "2026-11-16", "2026-11-18", "dropoff")).toBe("boarding_check_in");
    expect(boardingPauseReason("2026-11-16", "2026-11-16", "2026-11-18", "pickup")).toBeNull();
  });
  it("pauses both between, and only the pickup on check-out day", () => {
    expect(boardingPauseReason("2026-11-17", "2026-11-16", "2026-11-18", "pickup")).toBe("boarding_mid_stay");
    expect(boardingPauseReason("2026-11-18", "2026-11-16", "2026-11-18", "pickup")).toBe("boarding_check_out");
    expect(boardingPauseReason("2026-11-18", "2026-11-16", "2026-11-18", "dropoff")).toBeNull();
  });
  it("ignores same-day stays and days outside", () => {
    expect(boardingPauseReason("2026-11-16", "2026-11-16", "2026-11-16", "dropoff")).toBeNull();
    expect(boardingPauseReason("2026-11-19", "2026-11-16", "2026-11-18", "pickup")).toBeNull();
  });
});

describe("boardingClashes", () => {
  it("lists the checkout-day pickup that will not run", () => {
    const stays = [{ check_in_date: "2026-11-01", check_out_date: "2026-11-02", petIds: ["p1"] }];
    expect(boardingClashes(["p1", "p2"], ["2026-11-02"], ["pickup", "dropoff"], stays)).toEqual([
      { petId: "p1", date: "2026-11-02", direction: "pickup", reason: "boarding_check_out" },
    ]);
  });
});

describe("branch moves in mergeDemand", () => {
  it("keeps a branch move as its own stop beside the home run", () => {
    const stops = mergeDemand([
      row({ source: "regular", source_id: "r1" }),
      row({
        source: "request",
        source_id: "t1",
        purpose: "transfer",
        kind: "one_off",
        transfer_from_branch_id: "dip",
        transfer_to_branch_id: "bb",
      }),
    ]);
    expect(stops).toHaveLength(2);
    const move = stops.find((s) => s.badge === "transfer")!;
    expect(move.transferFromBranchId).toBe("dip");
    expect(move.transferToBranchId).toBe("bb");
  });
  it("is not struck by a cancelled day", () => {
    const stops = mergeDemand([
      row({ source: "skip", source_id: "c1", kind: "cancel" }),
      row({ source: "request", source_id: "t1", purpose: "transfer", kind: "one_off" }),
    ]);
    expect(stops.find((s) => s.sourceId === "t1")?.struck).toBeNull();
  });
  it("defaults to drop-off going to BB and pickup coming back to DIP", () => {
    expect(transferDefaultDirection("bb")).toBe("dropoff");
    expect(transferDefaultDirection("main")).toBe("pickup");
  });
});

describe("pausedLabel", () => {
  const today = "2026-11-11";
  it("reads like AE's master card", () => {
    expect(pausedLabel({ paused_from: "2026-11-10", paused_until: "2026-11-12" }, today)).toBe("Paused until 12 Nov");
    expect(pausedLabel({ paused_from: "2026-11-10", paused_until: null }, today)).toBe("Paused");
    expect(pausedLabel({ paused_from: "2026-11-14", paused_until: "2026-11-20" }, today)).toBe("Paused 14 Nov – 20 Nov");
    expect(pausedLabel({ paused_from: "2026-11-14", paused_until: null }, today)).toBe("Paused from 14 Nov");
  });
  it("is null when there is no pause or it is over", () => {
    expect(pausedLabel({ paused_from: null, paused_until: null }, today)).toBeNull();
    expect(pausedLabel({ paused_from: "2026-11-01", paused_until: "2026-11-05" }, today)).toBeNull();
  });
});

describe("ownWindowLabel", () => {
  it("formats the owner's wider window", () => {
    expect(ownWindowLabel(570, 630)).toBe("9:30–10:30 AM");
    expect(ownWindowLabel(690, 750)).toBe("11:30 AM–12:30 PM");
    expect(ownWindowLabel(null, 540)).toBeNull();
  });
});
