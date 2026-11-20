import { describe, expect, it } from "vitest";
import { legLabel, quoteToPanelOffers, storedToPanelOffers } from "@/components/transport/OfferPanel";
import { requestTrail } from "@/components/transport/RequestDetailSheet";
import type { TransportRequestOffer } from "@/hooks/useTransport";

const stored = (over: Partial<TransportRequestOffer>): TransportRequestOffer => ({
  id: "o1",
  request_id: "r1",
  rank: 1,
  outcome: "offer",
  reason: null,
  slot_start_min: 480,
  slot_label: "08-09AM",
  promised_slot_label: "08-09AM",
  outside_windows: false,
  shift_hours: 0,
  eta_min: 500,
  added_km: 2.14,
  added_minutes: 6.4,
  displaces: 0,
  recommended: true,
  basis: "master",
  declined_by_client: false,
  chosen_by_staff: false,
  created_by: null,
  created_at: "2026-11-20T08:00:00Z",
  ...over,
});

describe("AE's offer rows", () => {
  it("shows a stored offer as AE's OfferList does", () => {
    expect(storedToPanelOffers([stored({})])[0]).toMatchObject({
      offerId: "o1",
      slotLabel: "08-09AM",
      outsideWindows: false,
      eta: "08:20",
      addedKm: 2.1,
      addedMinutes: 6,
      recommended: true,
    });
  });

  it("sells an off-grid offer on its time", () => {
    expect(storedToPanelOffers([stored({ outside_windows: true, eta_min: 662 })])[0]).toMatchObject({
      slotLabel: "around 11:02",
      outsideWindows: true,
    });
  });

  it("maps a live quote the same way", () => {
    const [o] = quoteToPanelOffers([
      { slotLabel: "09-10AM", startMin: 540, promisedSlotLabel: "09-10AM", eta: "09:15", shiftHours: 1, recommended: false, fitsClient: true, displaces: 0, needsVan: false, van: null, basis: "master", addedKm: 1, addedMinutes: 3 },
    ]);
    expect(o).toMatchObject({ offerId: "0", slotLabel: "09-10AM", shiftHours: 1, eta: "09:15" });
  });
});

describe("AE's leg labels and trail", () => {
  it("names each leg", () => {
    expect(legLabel({ direction: "pickup", service_date: "2026-11-20", weekday: null })).toBe("Pickup · Fri 20 Nov");
    expect(legLabel({ direction: "dropoff", service_date: null, weekday: 1 })).toBe("Drop-off · every Monday");
  });

  const lead = { created_by: "Mona", created_at: "2026-11-20T07:00:00Z", offered_by: null, offered_at: null, decided_by: null, decided_at: null };

  it("reads Not yet before anything happens", () => {
    expect(requestTrail("one_off", "received", lead)).toEqual([
      { label: "Created", who: "Mona", at: lead.created_at },
      { label: "Offered", who: null, at: null },
      { label: "Approved", who: null, at: null },
    ]);
  });

  it("records who offered and who approved", () => {
    const t = requestTrail("one_off", "approved", { ...lead, offered_by: "Mona", offered_at: "x", decided_by: "Sara", decided_at: "y" });
    expect(t[1]).toEqual({ label: "Offered", who: "Mona", at: "x" });
    expect(t[2]).toEqual({ label: "Approved", who: "Sara", at: "y" });
  });

  it("says No offer sent when approved without one, and skips Offered for cancellations", () => {
    expect(requestTrail("one_off", "approved", { ...lead, decided_by: "Sara", decided_at: "y" })[1].who).toBe("No offer sent");
    expect(requestTrail("cancel", "approved", lead).map((s) => s.label)).toEqual(["Created", "Approved"]);
  });
});
