import { describe, expect, it } from "vitest";
import { buildHubSync, hubConfigured, hubEnabled, slotStartMin } from "../../api/_lib/transportHub.js";

const owner = { first_name: "Nardeen", last_name: "Turjman", pin_lat: 25.0, pin_lng: 55.2 };
const pets = new Map([
  ["bonnie", { id: "bonnie", name: "Bonnie", voltlines_passenger_id: "101", owner }],
  ["mario", { id: "mario", name: "Mario", voltlines_passenger_id: null, owner }],
]);

const regular = (over: Record<string, unknown> = {}) => ({
  id: "rg1",
  pet_id: "bonnie",
  weekday: 1,
  direction: "both",
  pickup_time: "07:00:00",
  dropoff_time: "19:00:00",
  pickup_window_start_min: null,
  pickup_window_end_min: null,
  dropoff_window_start_min: null,
  dropoff_window_end_min: null,
  starts_on: "2026-11-09",
  ends_on: null,
  transfer_to_branch_id: null,
  notes: null,
  ...over,
});

const stop = (over: Record<string, unknown>) => ({
  source: "regular",
  source_id: "rg1",
  pet_id: "bonnie",
  direction: "pickup",
  run_time: "07:00:00",
  struck: null,
  purpose: "regular",
  note: null,
  location_text: null,
  location_lat: null,
  location_lng: null,
  ...over,
});

const build = (days: Array<{ date: string; stops: unknown[] }>, regulars = [regular()]) =>
  buildHubSync({ from: "2026-11-23", to: "2026-11-30", regulars, days, pets });

describe("hub switch", () => {
  it("is off unless exactly true, and needs both URL and secret", () => {
    expect(hubEnabled({})).toBe(false);
    expect(hubEnabled({ TRANSPORT_HUB_ENABLED: "yes" })).toBe(false);
    expect(hubEnabled({ TRANSPORT_HUB_ENABLED: "true" })).toBe(true);
    expect(hubConfigured({ AE_TRANSPORT_PARTNER_URL: "https://x" })).toBe(false);
    expect(hubConfigured({ AE_TRANSPORT_PARTNER_URL: "https://x", AE_TRANSPORT_PARTNER_SECRET: "s" })).toBe(true);
  });

  it("reads an hour slot from a time", () => {
    expect(slotStartMin("07:30:00")).toBe(420);
    expect(slotStartMin(null)).toBeNull();
  });
});

describe("buildHubSync", () => {
  it("sends a regular as one AE rule per direction, tagged woof and site AQ", () => {
    const { body } = build([]);
    expect(body.rules).toEqual([
      expect.objectContaining({ ref: "woof:regular:rg1:pickup", clientRef: "woof:pet:bonnie", weekday: 1, startMin: 420 }),
      expect.objectContaining({ ref: "woof:regular:rg1:dropoff", startMin: 1140 }),
    ]);
    expect(body.clients).toEqual([
      expect.objectContaining({ ref: "woof:pet:bonnie", passengerId: 101, site: "AQ", ownerName: "Nardeen Turjman" }),
    ]);
  });

  it("calls a struck regular off for that day", () => {
    const { body } = build([{ date: "2026-11-23", stops: [stop({ struck: "Boarding" })] }]);
    expect(body.requests).toEqual([
      expect.objectContaining({ kind: "cancel", date: "2026-11-23", direction: "pickup", note: "Woof: Boarding" }),
    ]);
  });

  it("does not send a dog who is not on Voltlines", () => {
    const { body, notSent } = build([], [regular({ pet_id: "mario" })]);
    expect(body.rules).toEqual([]);
    expect(body.clients).toEqual([]);
    expect(notSent[0]).toMatchObject({ petId: "mario", reason: "not on Voltlines" });
  });

  it("sends a half-past one-off in its hour slot with its one-hour window", () => {
    const { body } = build([
      {
        date: "2026-11-24",
        stops: [
          stop({ source: "request", source_id: "q1", purpose: "regular", run_time: "09:30:00", window_start_min: 570, window_end_min: 630 }),
          stop({ source: "request", source_id: "v1", purpose: "vet", run_time: "11:00:00", window_start_min: 660, window_end_min: 780 }),
        ],
      },
    ]);
    expect(body.requests[0]).toEqual(expect.objectContaining({ ref: "woof:request:q1:bonnie", startMin: 540, windowStartMin: 570, windowEndMin: 630 }));
    expect(body.requests[1].windowStartMin).toBeUndefined();
  });

  it("sends a one-off request and a daycare trip that has no regular", () => {
    const { body } = build([
      {
        date: "2026-11-24",
        stops: [
          stop({ source: "request", source_id: "q1", run_time: "09:00:00", purpose: "regular" }),
          stop({ source: "daycare", source_id: "d1", pet_id: "bonnie", direction: "dropoff", run_time: null }),
        ],
      },
    ]);
    expect(body.requests.map((r) => r.ref)).toEqual(["woof:request:q1:bonnie", "woof:daycare:d1:bonnie:dropoff"]);
  });
});

describe("dogs waiting on a request (23 Nov 2026)", () => {
  it("sends a dog on an open request as a client with nothing to plan, unless it has no transport profile", () => {
    const r = buildHubSync({
      from: "2026-11-23",
      to: "2026-11-30",
      regulars: [],
      days: [],
      pets,
      openPets: [{ petId: "bonnie" }, { petId: "mario" }],
    });
    const refs = r.body.clients.map((c: { ref: string }) => c.ref);
    expect(refs).toContain("woof:pet:bonnie");
    expect(refs).not.toContain("woof:pet:mario");
    expect(r.body.rules).toHaveLength(0);
    expect(r.body.requests).toHaveLength(0);
  });
});
