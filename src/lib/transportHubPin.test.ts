import { describe, expect, it } from "vitest";
import { takesHubPin } from "../../api/transport-hub.js";

// AE's dispatch moved the door (24 Nov 2026, evening); the link carries when.
const link = { lat: 25.2076, lng: 55.2438, pinSetAt: "2026-11-24T19:15:10.306Z" };

describe("takesHubPin — a pin AE's dispatch saved reaches the owner profile (25 Nov 2026)", () => {
  it("fills an owner with no pin, with or without pinSetAt (Rocco)", () => {
    expect(takesHubPin({ pin_lat: null, pin_lng: null }, link)).toBe(true);
    expect(takesHubPin({ pin_lat: null, pin_lng: null }, { lat: 25.2, lng: 55.3 })).toBe(true);
  });

  it("replaces a copied pin with dispatch's, however recent the copy (Pepsi)", () => {
    const copy = { pin_lat: 25.205372, pin_lng: 55.250923, pin_updated_at: "2026-11-25T06:22:03Z" };
    expect(takesHubPin({ ...copy, pin_source: "voltlines" }, link)).toBe(true);
    expect(takesHubPin({ ...copy, pin_source: "hub" }, link)).toBe(true);
  });

  it("replaces an older pin a person set, never a newer one", () => {
    const own = { pin_lat: 25.1, pin_lng: 55.2, pin_source: "place_pin" };
    expect(takesHubPin({ ...own, pin_updated_at: "2026-11-20T08:00:00Z" }, link)).toBe(true);
    expect(takesHubPin({ ...own, pin_updated_at: "2026-11-25T09:23:38Z" }, link)).toBe(false);
  });

  it("leaves an owner's pin alone when AE's is not a dispatch save, unusable, or the same", () => {
    const own = { pin_lat: 25.1, pin_lng: 55.2, pin_source: "voltlines", pin_updated_at: "2026-11-01T00:00:00Z" };
    expect(takesHubPin(own, { lat: 25.2, lng: 55.3 })).toBe(false);
    expect(takesHubPin(own, { lat: null, lng: null, pinSetAt: link.pinSetAt })).toBe(false);
    expect(takesHubPin({ ...own, pin_lat: link.lat, pin_lng: link.lng }, link)).toBe(false);
  });
});
