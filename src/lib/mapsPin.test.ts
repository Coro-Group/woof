import { describe, expect, it } from "vitest";
import { coordinateFromPlaceCard, pinFromAddress, placeCardUrl, unwrapConsentUrl } from "../../api/_lib/mapsPin.js";

// The shape of the link a client shared on 26 Nov 2026: a short link that expands
// to a place name plus feature id, with no coordinate in the URL.
const SHORT = "https://maps.app.goo.gl/i4HvXr9WRLjBgjmR7?g_st=ic";
const FTID = "0x3e5f739843f18cf1:0x76caccdb0d0dbd51";
const PLACE = `https://maps.google.com/maps?q=Petzania+-+The+Retreat,+Dubai&ftid=${FTID}`;
const CONSENT = `https://consent.google.com/m?continue=${encodeURIComponent(PLACE)}&gl=FR&m=0&pc=m&hl=en&src=1`;

// What Google served a server in Mumbai: the preview image and camera are the
// VISITOR's location (Mumbai), and the place is only behind the place-card link.
const CARD_PATH =
  "/maps/preview/place?authuser=0&amp;hl=en&amp;gl=in&amp;pb=%211m14%211s0x3e5f739843f18cf1%3A0x76caccdb0d0dbd51%213m12%211m3%211d3861089.8%212d72.8783527%213d19.0815074";
const CARD_URL = `https://www.google.com${CARD_PATH.replace(/&amp;/g, "&")}`;
const MAP_PAGE = `<html><head><link href="${CARD_PATH}" as="fetch"><meta content="https://maps.google.com/maps/api/staticmap?center=19.0815074%2C72.8783527&amp;zoom=7"></head></html>`;
const CONSENT_PAGE = '<html><form action="https://consent.google.com/save">Before you continue to Google</form></html>';

/** A place card: the place itself at [6][9]; the viewport elsewhere. */
function placeCard(lat: number, lng: number) {
  const place: unknown[] = [];
  place[9] = [null, null, lat, lng];
  const body: unknown[] = [null, [], null, null, [[3617.04, 72.8783527, 19.0815074]], null, place];
  return `)]}'\n${JSON.stringify(body)}`;
}

type Hop = { url: string; html?: string };

/** A fetch that answers each requested URL with where it "redirected" and its body. */
function fakeFetch(routes: Record<string, Hop>) {
  const seen: string[] = [];
  const impl = async (url: string) => {
    seen.push(url);
    const hop = routes[url];
    if (!hop) throw new Error(`unexpected fetch ${url}`);
    return { ok: true, url: hop.url, text: async () => hop.html ?? "", headers: { get: () => null } };
  };
  return { impl, seen };
}

describe("unwrapConsentUrl", () => {
  it("returns the Maps URL a consent page was guarding", () => {
    expect(unwrapConsentUrl(CONSENT)).toBe(PLACE);
  });
  it("leaves any other URL alone", () => {
    expect(unwrapConsentUrl(PLACE)).toBe(PLACE);
    expect(unwrapConsentUrl("not a url")).toBe("not a url");
  });
});

describe("placeCardUrl / coordinateFromPlaceCard", () => {
  it("finds the place card link keyed by the feature id", () => {
    expect(placeCardUrl(MAP_PAGE)).toBe(CARD_URL);
  });
  it("does not follow a card for words only (that would be a search)", () => {
    const wordsOnly = '<link href="/maps/preview/place?authuser=0&amp;q=Samana+Greens&amp;pb=%211m3%211d38610">';
    expect(placeCardUrl(wordsOnly)).toBeNull();
  });
  it("reads the place, not the viewport", () => {
    expect(coordinateFromPlaceCard(placeCard(24.964542, 55.1945565))).toEqual({
      lat: 24.964542,
      lng: 55.1945565,
      source: "place_pin",
    });
  });
  it("refuses a place outside the UAE and bad JSON", () => {
    expect(coordinateFromPlaceCard(placeCard(19.08, 72.87))).toBeNull();
    expect(coordinateFromPlaceCard("<html>")).toBeNull();
  });
});

describe("pinFromAddress", () => {
  it("never takes the page's preview center (the visitor's location) as the pin", async () => {
    const dubaiCenter = MAP_PAGE.replace(/<link[^>]+>/, "").replace("19.0815074%2C72.8783527", "24.9790464%2C55.1944192");
    const { impl } = fakeFetch({ [SHORT]: { url: PLACE }, [PLACE]: { url: PLACE, html: dubaiCenter } });
    expect(await pinFromAddress(SHORT, { fetchImpl: impl })).toBeNull();
  });

  it("reads the pin from the place card of a short link", async () => {
    const trace: string[] = [];
    const { impl, seen } = fakeFetch({
      [SHORT]: { url: PLACE },
      [PLACE]: { url: PLACE, html: MAP_PAGE },
      [CARD_URL]: { url: CARD_URL, html: placeCard(24.964542, 55.1945565) },
    });
    expect(await pinFromAddress(SHORT, { fetchImpl: impl, trace })).toMatchObject({ lat: 24.964542, lng: 55.1945565 });
    expect(seen).toEqual([SHORT, PLACE, CARD_URL]);
    expect(trace.at(-1)).toBe("place card → pin");
  });

  it("gets past Google's consent page when the short link lands on it", async () => {
    const trace: string[] = [];
    const { impl } = fakeFetch({
      [SHORT]: { url: CONSENT },
      [PLACE]: { url: PLACE, html: MAP_PAGE },
      [CARD_URL]: { url: CARD_URL, html: placeCard(24.964542, 55.1945565) },
    });
    expect(await pinFromAddress(SHORT, { fetchImpl: impl, trace })).toMatchObject({ lat: 24.964542 });
    expect(trace[1]).toBe("consent → maps.google.com/maps");
  });

  it("gives up after the second consent page, and the trace never names the place", async () => {
    const trace: string[] = [];
    const { impl } = fakeFetch({ [SHORT]: { url: PLACE }, [PLACE]: { url: CONSENT, html: CONSENT_PAGE } });
    expect(await pinFromAddress(SHORT, { fetchImpl: impl, trace })).toBeNull();
    expect(trace.filter((t) => t.startsWith("page → consent.google.com"))).toHaveLength(2);
    expect(trace.join(" ")).not.toMatch(/Petzania|Retreat/);
  });
});
