// Where the vans go, and when.
//
// One rule, imported everywhere a pin is judged. It used to be a Dubai-only box
// copied into four files, and the box had been drawn to catch geocode failures —
// the UAE centroid pin that put ~480 km of phantom driving into a live route —
// but it also shut out every honest Abu Dhabi home. Anywhere in the UAE is served
// (Chris, 24 Sep 2026) — a pin that is wrong gets corrected by the team, not
// blocked here; 265 Abu Dhabi clients had been unplannable for no reason anyone
// had decided. Only the geocode-failure centroid is still refused, because it is
// not an address at all.
//
// Abu Dhabi runs only in the middle of the day: pickups and dropoffs there are
// offered 11AM–2PM, usually on a run of their own, grouped when several Abu Dhabi
// stops fall on the same day.
//
// Boxes, not polygons: they only have to separate "somewhere in the UAE" from
// "not in the country" and pick out Abu Dhabi city. Checked in order, first match
// wins, so Abu Dhabi city is found before the UAE-wide catch-all.

export const UAE_CENTROID = { lat: 23.424076, lng: 53.847818 };

export const SERVICE_AREAS = [
  {
    key: "abu_dhabi",
    label: "Abu Dhabi",
    // Abu Dhabi island, Reem, Saadiyat, Yas, Al Raha, Khalifa City, MBZ, Shakhbout,
    // Mussafah, Al Shamkha, up the coast to Ghantoot. Al Ain is not served.
    lat: [24.15, 24.87],
    lng: [54.2, 54.9],
    window: { startMin: 11 * 60, endMin: 14 * 60, label: "11AM–2PM" },
  },
  {
    key: "dubai_sharjah",
    label: "Dubai / Sharjah",
    lat: [24.7, 25.45],
    lng: [54.85, 55.8],
    window: null,
  },
  {
    key: "uae",
    label: "UAE",
    // The rest of the country: Al Ain, the Western Region, Ajman, UAQ, RAK,
    // Fujairah, Hatta. Stops at 51.58°E so Doha stays out.
    lat: [22.6, 26.1],
    lng: [51.58, 56.4],
    window: null,
  },
];

function isCentroid(lat, lng) {
  // ~1 km of the failure point: geocoding gave up and returned the middle of the UAE.
  const dLat = lat - UAE_CENTROID.lat;
  const dLng = lng - UAE_CENTROID.lng;
  return Math.sqrt(dLat * dLat + dLng * dLng) < 0.01;
}

/** The area a coordinate falls in, or null when it is nowhere we drive. */
export function serviceAreaOf(lat, lng) {
  if (lat == null || lng == null) return null;
  const y = Number(lat);
  const x = Number(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
  if (isCentroid(y, x)) return null;
  return (
    SERVICE_AREAS.find(
      (a) => y >= a.lat[0] && y <= a.lat[1] && x >= a.lng[0] && x <= a.lng[1],
    ) ?? null
  );
}

/** Whether a pin can be planned against. */
export function inServiceArea(lat, lng) {
  return serviceAreaOf(lat, lng) != null;
}

/** The hours an area may be offered, or null when any published hour will do. */
export function areaWindowFor(lat, lng) {
  return serviceAreaOf(lat, lng)?.window ?? null;
}

/** Whether a published slot sits wholly inside an area's hours. */
export function slotInWindow(slot, window) {
  if (!window) return true;
  if (!slot) return false;
  return slot.start_min >= window.startMin && slot.end_min <= window.endMin;
}

/**
 * The slot to quote around when the one asked for is outside the area's hours:
 * the in-window slot nearest the asked hour. Returns the asked slot unchanged when
 * it already fits, or null when the catalogue has nothing inside the window.
 */
export function nearestSlotInWindow(requested, slots, window) {
  if (!window || slotInWindow(requested, window)) return requested ?? null;
  const target = requested ? (requested.start_min + requested.end_min) / 2 : window.startMin;
  const inside = (slots ?? []).filter((s) => slotInWindow(s, window));
  if (!inside.length) return null;
  return inside.reduce((best, s) =>
    Math.abs((s.start_min + s.end_min) / 2 - target) <
    Math.abs((best.start_min + best.end_min) / 2 - target)
      ? s
      : best,
  );
}
