import { describe, expect, it } from "vitest";
import { offerShiftText, promiseLine } from "@/components/transport/HubOfferTimes";

// The words AE's OfferList / OfferPanel use, so both apps read alike.
describe("offer wording (AE's)", () => {
  it("says how the offer sits against the hour asked for", () => {
    expect(offerShiftText({ shiftHours: 0 })).toBe("the slot they asked for");
    expect(offerShiftText({ shiftHours: -1 })).toBe("1 hour earlier");
    expect(offerShiftText({ shiftHours: 1 })).toBe("1 hour later");
    expect(offerShiftText({ shiftHours: 2 })).toBe("2 hour later");
    expect(offerShiftText({ shiftHours: 0, outsideWindows: true })).toBe("outside the windows we publish");
  });

  it("writes the promise as AE does", () => {
    expect(promiseLine({ slotLabel: "08-09AM", eta: "08:20" })).toBe("Promised: 08-09AM — collected around 08:20");
    expect(promiseLine({ slotLabel: "08-09AM", eta: null })).toBe("Promised: 08-09AM");
  });
});
