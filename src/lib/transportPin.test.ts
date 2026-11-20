import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { pinAreaLabel, resolveMapsPin } from "@/lib/transportPin";

describe("resolveMapsPin", () => {
  it("reads a typed lat, lng without a server round trip", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const pin = await resolveMapsPin("25.0731, 55.2419");
    expect(pin).toMatchObject({ lat: 25.0731, lng: 55.2419, source: "typed", area: "Dubai / Sharjah" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("prefers the place pin over the camera in a long Maps link", async () => {
    const pin = await resolveMapsPin(
      "https://www.google.com/maps/place/Samana+Greens/@25.0731,55.2419,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d25.0728!4d55.2401",
    );
    expect(pin).toMatchObject({ lat: 25.0728, lng: 55.2401, source: "place_pin" });
  });

  it("refuses the UAE geocode-failure centroid", async () => {
    await expect(resolveMapsPin("23.424076, 53.847818")).rejects.toThrow();
  });

  it("refuses text with no coordinates and no link", async () => {
    await expect(resolveMapsPin("Samana Greens, Arjan")).rejects.toThrow(/No usable pin/);
  });

  it("sends short links to the server", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ lat: 25.1, lng: 55.2, source: "place_pin", area: "Dubai / Sharjah" }), { status: 200 }),
    );
    const pin = await resolveMapsPin("https://maps.app.goo.gl/abc123");
    expect(fetchSpy).toHaveBeenCalledWith("/api/transport-resolve-pin", expect.objectContaining({ method: "POST" }));
    expect(pin.lat).toBe(25.1);
    fetchSpy.mockRestore();
  });
});

describe("pinAreaLabel", () => {
  it("names Abu Dhabi before the UAE catch-all", () => {
    expect(pinAreaLabel(24.45, 54.38)).toBe("Abu Dhabi");
    expect(pinAreaLabel(25.2, 55.27)).toBe("Dubai / Sharjah");
    expect(pinAreaLabel(null, null)).toBeNull();
  });
});
