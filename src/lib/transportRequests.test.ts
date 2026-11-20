import { describe, expect, it } from "vitest";
import {
  cardMissed,
  cardNeedsTime,
  cardSummary,
  daysLate,
  groupRequests,
  rowMissed,
  sortInbox,
  type RequestRowLike,
} from "@/lib/transportRequests";

let n = 0;
function row(partial: Partial<RequestRowLike>): RequestRowLike {
  n += 1;
  return {
    id: `r${n}`,
    group_id: "g1",
    branch_id: "main",
    owner_id: "o1",
    kind: "one_off",
    cadence: null,
    direction: "pickup",
    service_date: "2026-11-03",
    weekday: null,
    starts_on: null,
    ends_on: null,
    paused_from: null,
    paused_until: null,
    status: "received",
    notes: null,
    rejection_reason: null,
    location_text: null,
    created_at: "2026-10-30T08:00:00Z",
    decided_at: null,
    owners: { first_name: "Olive", last_name: "Test" },
    transport_request_pet: [{ pet_id: "p1", pets: { name: "Rex" } }],
    transport_slots: null,
    ...partial,
  };
}

describe("groupRequests", () => {
  it("collapses a pickup + drop-off ask over two dates into one card", () => {
    const cards = groupRequests([
      row({ direction: "pickup", service_date: "2026-11-03", transport_slots: { label: "08-09AM", start_min: 480, end_min: 540 } }),
      row({ direction: "dropoff", service_date: "2026-11-03", transport_slots: { label: "5-6PM", start_min: 1020, end_min: 1080 } }),
      row({ direction: "pickup", service_date: "2026-11-04", transport_slots: { label: "08-09AM", start_min: 480, end_min: 540 } }),
      row({ direction: "dropoff", service_date: "2026-11-04", transport_slots: { label: "5-6PM", start_min: 1020, end_min: 1080 } }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].directions).toEqual(["pickup", "dropoff"]);
    expect(cards[0].dates).toEqual(["2026-11-03", "2026-11-04"]);
    expect(cards[0].ownerName).toBe("Olive Test");
    expect(cardSummary(cards[0])).toBe("Pickup 08-09AM + Drop-off 5-6PM · Tue 3 Nov, Wed 4 Nov");
  });

  it("keeps separate groups apart", () => {
    expect(groupRequests([row({ group_id: "a" }), row({ group_id: "b" })])).toHaveLength(2);
  });

  it("shows a part-answered card as still received", () => {
    const [card] = groupRequests([row({ status: "approved" }), row({ status: "received", direction: "dropoff" })]);
    expect(card.status).toBe("received");
  });
});

describe("cardSummary", () => {
  it("describes a regular by its weekdays and start", () => {
    const [card] = groupRequests([
      row({ kind: "new_recurring", service_date: null, weekday: 1, starts_on: "2026-11-02" }),
      row({ kind: "new_recurring", service_date: null, weekday: 3, starts_on: "2026-11-02" }),
    ]);
    expect(cardSummary(card)).toBe("Pickup · every Mon, Wed from 2 Nov");
  });

  it("describes cancellations and pauses", () => {
    const [day] = groupRequests([row({ kind: "cancel", cadence: "one_off", service_date: "2026-11-09" })]);
    expect(cardSummary(day)).toBe("Cancel pickup · Mon 9 Nov");
    const [end] = groupRequests([row({ kind: "cancel", cadence: "regular", service_date: null, weekday: 2, ends_on: "2026-11-10" })]);
    expect(cardSummary(end)).toBe("End regular pickup · Tue · last day 10 Nov");
    const [pause] = groupRequests([
      row({ kind: "pause", service_date: null, weekday: 1, direction: "dropoff", paused_from: "2026-11-02", paused_until: "2026-11-09" }),
    ]);
    expect(cardSummary(pause)).toBe("Pause drop-off · Mon · 2 Nov – 9 Nov, then runs again");
  });
});

describe("views", () => {
  it("flags additions with no time, not cancellations", () => {
    expect(cardNeedsTime(groupRequests([row({})])[0])).toBe(true);
    expect(cardNeedsTime(groupRequests([row({ kind: "cancel", cadence: "one_off" })])[0])).toBe(false);
  });

  it("calls a request missed when its date passed before we answered", () => {
    const today = "2026-10-30";
    // Still unanswered after its day.
    expect(rowMissed(row({ service_date: "2026-10-28" }), today)).toBe(true);
    // Its day is today: not missed yet.
    expect(rowMissed(row({ service_date: today }), today)).toBe(false);
    // Approved the day after (Dubai time) → missed, 1 day late.
    const late = row({ service_date: "2026-10-28", status: "approved", decided_at: "2026-10-29T06:00:00Z" });
    expect(rowMissed(late, today)).toBe(true);
    expect(daysLate(late)).toBe(1);
    // Rejected late counts too.
    expect(rowMissed(row({ service_date: "2026-10-28", status: "rejected", decided_at: "2026-10-30T06:00:00Z" }), today)).toBe(true);
    // Approved on the day, or before → answered in time.
    expect(rowMissed(row({ service_date: "2026-10-28", status: "approved", decided_at: "2026-10-28T05:00:00Z" }), today)).toBe(false);
    expect(rowMissed(row({ service_date: "2026-10-28", status: "approved", decided_at: "2026-10-26T05:00:00Z" }), today)).toBe(false);
    // 22:30 UTC on the 27th is already the 28th in Dubai: on the day, not late.
    expect(rowMissed(row({ service_date: "2026-10-28", status: "approved", decided_at: "2026-10-27T22:30:00Z" }), today)).toBe(false);
    // Withdrawn and cancellations are never "missed".
    expect(rowMissed(row({ service_date: "2026-10-28", status: "cancelled", decided_at: "2026-10-30T06:00:00Z" }), today)).toBe(false);
    expect(rowMissed(row({ service_date: "2026-10-28", kind: "cancel", cadence: "one_off" }), today)).toBe(false);
  });

  it("keeps an unanswered card whose days have all passed out of the Inbox", () => {
    const [card] = groupRequests([row({ service_date: "2026-10-28" }), row({ service_date: "2026-11-02", direction: "dropoff" })]);
    expect(cardMissed(card, "2026-10-30")).toBe(false);
    const [past] = groupRequests([row({ service_date: "2026-10-28" })]);
    expect(cardMissed(past, "2026-10-30")).toBe(true);
  });

  it("sorts newest first, or earliest transport first with undated last", () => {
    const cards = groupRequests([
      row({ group_id: "old", created_at: "2026-10-29T08:00:00Z", service_date: "2026-11-01" }),
      row({ group_id: "new", created_at: "2026-10-30T08:00:00Z", service_date: "2026-11-05" }),
      row({ group_id: "weekly", created_at: "2026-10-30T09:00:00Z", kind: "pause", service_date: null, weekday: 1 }),
    ]);
    expect(sortInbox(cards, "arrival").map((c) => c.groupId)).toEqual(["weekly", "new", "old"]);
    expect(sortInbox(cards, "transport").map((c) => c.groupId)).toEqual(["old", "new", "weekly"]);
  });
});
