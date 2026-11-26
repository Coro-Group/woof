// Coordinates out of whatever an owner pasted into an address field.
//
// Dubai addresses do not geocode. "SAMANA GREENS, ARJAN" resolves to a compound
// centroid at best and to the UAE geocode-failure point at worst — one such pin
// put ~480km of phantom driving into a live route. A dropped Google Maps pin is
// the one thing that carries the actual villa, so staff paste the share link and
// this reads the numbers straight out of it. A maps.app.goo.gl link from a
// client's phone often expands to the place name only; the pin is then read from
// the map page Google returns, still without geocoding the words. Nothing is
// guessed.
//
// The pin coordinate and the camera coordinate are DIFFERENT numbers in a Maps
// URL, and only one of them is the place:
//
//   .../place/Samana+Greens/@25.0731,55.2419,17z/data=...!3d25.0728!4d55.2401
//                            ^ where the camera sat        ^ the actual pin
//
// !3d/!4d wins wherever it exists. On a long street the camera can sit a hundred
// metres from the door, which is the difference between a driver finding the
// villa and phoning the office.

import { inServiceArea } from "./serviceArea.js";

/** Short links carry no coordinates at all — they have to be followed first. */
const SHORT_LINK = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.com\/maps\?cid=)/i;

// The share page is the one a browser gets. Ask for that, so the preview image
// with the place center is in the HTML.
const MAPS_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html",
  "Accept-Language": "en",
  // Without these, Google answers a datacenter (above all one in Europe) with its
  // cookie-consent page, which has no pin. CONSENT is the old form; SOCS is the
  // one Google reads since 2023 ("reject all", English).
  Cookie: "SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiA_LyaBg; CONSENT=YES+cb.20210720-07-p0.en+FX+410",
};

/**
 * Where a consent.google.com interstitial would have sent us. Google parks the
 * real Maps URL in `continue`; reading it from there is the same link the client
 * shared, not a guess. Any other URL comes back unchanged.
 */
export function unwrapConsentUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? "").trim());
  } catch {
    return url ?? null;
  }
  if (!/^consent\.google\./i.test(parsed.hostname)) return url;
  const next = parsed.searchParams.get("continue");
  return next || url;
}

/** Host and path of a URL, for the log: where a link went, never the place it names. */
function hopOf(url) {
  try {
    const u = new URL(String(url));
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "unparseable";
  }
}

/** The same rule a Voltlines pin is judged by. */
function withinServiceArea(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return inServiceArea(lat, lng);
}

/** True when the text is a Maps link that must be resolved before it can be read. */
export function isShortMapsLink(text) {
  return SHORT_LINK.test(String(text ?? "").trim());
}

/**
 * The pin an owner dropped, or null.
 *
 * Reads, in order of how much the number can be trusted:
 *   1. !3d<lat>!4d<lng>  — the place itself, from a share link's data blob
 *   2. ?q= / ?ll= / ?daddr= / geo:  — an explicit coordinate parameter
 *   3. @<lat>,<lng>      — the camera, which is the pin often enough to keep
 *   4. a bare "25.0731, 55.2419" typed into the field
 *
 * A coordinate outside the areas we serve, or sitting on the UAE geocode-failure
 * centroid, is rejected rather than stored: an unusable pin has to stop a client
 * being planned, never quietly misplace them.
 */
/** At least four decimals: a link chopped at "!4d55" must not become a pin. */
const COORD = "(-?\\d{1,3}\\.\\d{4,})";

/**
 * Google copies the same link in several shapes. The address bar shows
 * `@lat,lng` and `!3d!4d`; the clipboard often percent-encodes those markers
 * (`%40`, `%21`), and a filter in front of us sometimes drops the markers and
 * leaves the numbers. All three are the same pin.
 */
function normalizeMapsText(text) {
  return String(text ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/%21/gi, "!")
    .replace(/%40/gi, "@")
    .replace(/%2C/gi, ",");
}

export function coordinateFromText(text) {
  const raw = normalizeMapsText(text);
  if (!raw.trim()) return null;

  const candidates = [];
  const add = (lat, lng, source) => {
    candidates.push({ lat: Number(lat), lng: Number(lng), source });
  };

  const place = new RegExp(`!3d${COORD}!4d${COORD}`, "g");
  const query = new RegExp(`[?&](?:q|ll|daddr|destination|center)=(?:loc:)?${COORD}\\s*,\\s*${COORD}`, "gi");
  const geo = new RegExp(`\\bgeo:${COORD}\\s*,\\s*${COORD}`, "gi");
  const camera = new RegExp(`@${COORD},${COORD}`, "g");
  const pair = new RegExp(`${COORD}\\s*,\\s*${COORD}`, "g");

  for (const m of raw.matchAll(place)) add(m[1], m[2], "place_pin");
  for (const m of raw.matchAll(query)) add(m[1], m[2], "query_param");
  for (const m of raw.matchAll(geo)) add(m[1], m[2], "geo_uri");
  for (const m of raw.matchAll(camera)) add(m[1], m[2], "camera");
  // A bare pair in prose, or the same pair left behind in a Maps link once the
  // @ and ! markers are gone. Zoom levels and place ids are not four-decimal pairs.
  const mapsLink = /google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(raw);
  if (!/https?:\/\//i.test(raw) || mapsLink) {
    for (const m of raw.matchAll(pair)) add(m[1], m[2], "typed");
  }

  const order = ["place_pin", "query_param", "geo_uri", "camera", "typed"];
  for (const source of order) {
    const hit = candidates.find((c) => c.source === source && withinServiceArea(c.lat, c.lng));
    if (hit) return { lat: hit.lat, lng: hit.lng, source };
  }
  return null;
}

/**
 * Follow a shortened Maps link far enough to read the pin out of the long URL it
 * points at. HEAD is enough when Google puts the pin in the redirect. A share
 * from the Maps app often lands on a place name instead (`?q=Al+Jawhara+Tower`),
 * and the coordinates only exist on the page — see placeCardUrl.
 */
export async function resolveShortMapsLink(url, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const target = String(url ?? "").trim();
  if (!isShortMapsLink(target)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(target, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: MAPS_HEADERS,
    });
    // res.url is the final URL after redirects; the Location header covers the
    // case where the runtime hands back the first hop instead.
    return res?.url || res?.headers?.get?.("location") || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A Maps page we are willing to open. Anything else is left unread. */
export function isMapsPageUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? "").trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "maps.google.com") return true;
  if (host === "google.com" || host.endsWith(".google.com")) {
    return parsed.pathname === "/maps" || parsed.pathname.startsWith("/maps/");
  }
  return false;
}

/**
 * The place card a Maps share page loads for the place it names, or null.
 *
 * Clients send maps.app.goo.gl links that expand to a place name plus a feature id
 * (`ftid=0x…:0x…`), with no latitude anywhere in the URL. The page Google serves for
 * it does NOT carry the place: its preview image (`staticmap?center=`) and camera
 * (`!2d…!3d…`) are where Google thinks the VISITOR is — Mumbai from a Mumbai server,
 * the office from the office (found 26 Nov 2026; reading those put the pin wherever
 * the request came from). What the page does carry is a link to the place card,
 * `/maps/preview/place?…pb=!1s<feature id>…`, which the browser loads next.
 *
 * Only a card keyed by a feature id is followed: that is the one place the client
 * shared. A link that names words only (`q=Samana+Greens`) would be a search, and
 * nothing is guessed.
 */
export function placeCardUrl(html) {
  const href = String(html ?? "").match(/<link href="(\/maps\/preview\/place\?[^"]+)"/)?.[1];
  if (!href) return null;
  const path = href.replace(/&amp;/g, "&");
  const pb = path.replace(/%21/gi, "!").replace(/%3A/gi, ":");
  if (!/!1s0x[0-9a-f]+:0x[0-9a-f]+/i.test(pb)) return null;
  return `https://www.google.com${path}`;
}

/**
 * The place's own coordinate from a place card (JSON behind a `)]}'` guard): the
 * `[null, null, lat, lng]` at [6][9], where Maps keeps a place's location.
 */
export function coordinateFromPlaceCard(text) {
  let body;
  try {
    body = JSON.parse(String(text ?? "").replace(/^\)\]\}'\s*/, ""));
  } catch {
    return null;
  }
  const at = body?.[6]?.[9];
  if (!Array.isArray(at)) return null;
  const lat = Number(at[2]);
  const lng = Number(at[3]);
  if (typeof at[2] !== "number" || typeof at[3] !== "number" || !withinServiceArea(lat, lng)) return null;
  return { lat, lng, source: "place_pin" };
}

async function readMapsPage(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!isMapsPageUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: MAPS_HEADERS,
    });
    if (res?.ok === false) return null;
    const finalUrl = res?.url || url;
    const html = typeof res?.text === "function" ? await res.text() : "";
    return { url: finalUrl, html: html || "" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The pin behind an address field, following a short link when there is one.
 * Returns null when the text carries no usable coordinate — the caller then has
 * nothing to plan with, which is the honest outcome.
 */
export async function pinFromAddress(text, options = {}) {
  // `trace` (optional array) collects where each hop landed, host and path only,
  // so a refused link can be explained from the logs.
  const trace = Array.isArray(options.trace) ? options.trace : [];
  const direct = coordinateFromText(text);
  if (direct) return direct;
  const link = String(text ?? "").trim().match(/https?:\/\/\S+/)?.[0];
  if (!link) {
    trace.push("no link");
    return null;
  }

  let pageUrl = null;
  if (isShortMapsLink(link)) {
    const raw = await resolveShortMapsLink(link, options);
    trace.push(`short → ${raw ? hopOf(raw) : "no answer"}`);
    if (!raw) return null;
    // From Europe the short link can end on Google's consent page; the Maps URL
    // it was heading for is in its `continue` parameter.
    const expanded = unwrapConsentUrl(raw);
    if (expanded !== raw) trace.push(`consent → ${hopOf(expanded)}`);
    const fromUrl = coordinateFromText(expanded);
    if (fromUrl) return fromUrl;
    pageUrl = expanded;
  } else if (isMapsPageUrl(link)) {
    pageUrl = link;
  }
  if (!pageUrl || !isMapsPageUrl(pageUrl)) {
    trace.push(`not a Maps page${pageUrl ? `: ${hopOf(pageUrl)}` : ""}`);
    return null;
  }

  // Two tries at most: the page, and once more if Google parked it behind consent.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const page = await readMapsPage(pageUrl, options);
    trace.push(`page → ${page ? `${hopOf(page.url)} (${page.html.length} chars)` : "no answer"}`);
    if (!page) return null;
    // A redirect often lands on a URL that finally contains the pin, including
    // when the first hop was only a place name.
    const fromUrl = coordinateFromText(page.url);
    if (fromUrl) return fromUrl;
    const card = placeCardUrl(page.html);
    if (card) {
      const res = await readMapsPage(card, options);
      const pin = res ? coordinateFromPlaceCard(res.html) : null;
      trace.push(`place card → ${res ? (pin ? "pin" : `no pin (${res.html.length} chars)`) : "no answer"}`);
      return pin;
    }
    const next = unwrapConsentUrl(page.url);
    if (next === page.url || !isMapsPageUrl(next)) {
      trace.push("no place card");
      return null;
    }
    pageUrl = next;
  }
  return null;
}
