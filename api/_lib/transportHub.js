// The transport hub (admin-essentials, "AE").
//
// Dispatchers plan every brand's vans on AE's Master board and Desk. Woof keeps
// requests, the schedule, and regulars, and hands AE the runs through
// /api/transport-partner (Bearer AE_TRANSPORT_PARTNER_SECRET):
//
//   * sync  — dogs that ride, their regulars, and every dated change for the next
//             weeks. AE shows them tagged "Woof".
//   * quote — offer times for a new one-off, from AE's own quote (Master first,
//             then Voltlines routes).
//
// Switched OFF unless TRANSPORT_HUB_ENABLED is exactly "true". Nothing runs on a schedule.
// buildHubSync() is pure so it is tested alone.

export const HUB_PREFIX = "woof:";
export const SYNC_DAYS = 56;
export const WOOF_SITE = "AQ";

export function hubEnabled(env = process.env) {
  return env.TRANSPORT_HUB_ENABLED === "true";
}

export function hubConfigured(env = process.env) {
  return !!env.AE_TRANSPORT_PARTNER_URL && !!env.AE_TRANSPORT_PARTNER_SECRET;
}

export async function hubPost(body, env = process.env, fetchImpl = fetch) {
  const res = await fetchImpl(env.AE_TRANSPORT_PARTNER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.AE_TRANSPORT_PARTNER_SECRET}`,
      "Content-Type": "application/json",
      "User-Agent": "Woof-App/1.0 (transport hub)",
    },
    body: JSON.stringify({ partner: "woof", ...body }),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = new Error(parsed?.error || `The hub answered ${res.status}`);
    err.status = res.status;
    err.details = parsed?.details ?? null;
    err.code = parsed?.code ?? null;
    throw err;
  }
  return parsed;
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function slotStartMin(time) {
  if (!time) return null;
  const [h] = String(time).split(":").map(Number);
  return Number.isInteger(h) && h >= 0 && h < 24 ? h * 60 : null;
}

const ownerName = (o) => [o?.first_name, o?.last_name].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ") || null;

/**
 * AE's sync body from Woof's requests, regulars, and the day the schedule shows.
 * One facility (Al Quoz), so every dog is site AQ.
 */
export function buildHubSync({ from, to, regulars, days, pets }) {
  const notSent = [];
  const usedPets = new Set();
  const note = (what, petId, reason) => notSent.push({ what, petId, pet: pets.get(petId)?.name ?? null, reason });
  const ref = (...parts) => `${HUB_PREFIX}${parts.join(":")}`;
  const linked = (petId) => !!pets.get(petId)?.voltlines_passenger_id;
  const use = (petId) => usedPets.add(petId);

  const rules = [];
  for (const rg of regulars) {
    if (rg.ends_on && rg.ends_on < from) continue;
    if (rg.transfer_to_branch_id) {
      note("regular", rg.pet_id, "cross-facility regular — Woof has one site");
      continue;
    }
    if (!linked(rg.pet_id)) {
      note("regular", rg.pet_id, "not on Voltlines");
      continue;
    }
    use(rg.pet_id);
    for (const direction of rg.direction === "both" ? ["pickup", "dropoff"] : [rg.direction]) {
      const time = direction === "pickup" ? rg.pickup_time : rg.dropoff_time;
      const ws = direction === "pickup" ? rg.pickup_window_start_min : rg.dropoff_window_start_min;
      const we = direction === "pickup" ? rg.pickup_window_end_min : rg.dropoff_window_end_min;
      rules.push({
        ref: ref("regular", rg.id, direction),
        clientRef: ref("pet", rg.pet_id),
        weekday: rg.weekday,
        direction,
        startMin: slotStartMin(time),
        windowStartMin: ws ?? null,
        windowEndMin: ws != null ? we ?? null : null,
        effectiveFrom: rg.starts_on ?? null,
        effectiveTo: rg.ends_on ?? null,
        note: rg.notes ?? null,
      });
    }
  }

  const requests = [];
  const seen = new Set();
  const push = (row, petId) => {
    if (seen.has(row.ref)) return;
    seen.add(row.ref);
    use(petId);
    requests.push(row);
  };
  for (const { date, stops } of days) {
    const covered = new Set(
      stops
        .filter((s) => (s.source === "regular" || s.source === "request") && !s.struck)
        .map((s) => `${s.pet_id}|${s.direction}`),
    );
    for (const s of stops) {
      if (!s.pet_id || !s.direction) continue;
      const clientRef = ref("pet", s.pet_id);
      const base = { clientRef, direction: s.direction, date };
      if (!linked(s.pet_id)) {
        if (s.source !== "skip" && s.source !== "moved" && !s.struck) note(`${s.source} ${date}`, s.pet_id, "not on Voltlines");
        continue;
      }
      if (s.source === "regular") {
        if (s.struck && s.purpose !== "transfer") {
          push({ ...base, ref: ref("off", s.source_id, s.pet_id, date, s.direction), kind: "cancel", note: `Woof: ${s.struck}` }, s.pet_id);
        }
        continue;
      }
      if (s.source === "skip" || s.source === "moved") {
        push({ ...base, ref: ref(s.source, s.source_id, s.pet_id, date), kind: "cancel", note: s.note ?? null }, s.pet_id);
        continue;
      }
      if (s.source === "request") {
        if (s.struck) continue; // cancelled, or a home trip a boarding stay pauses
        // AE plans only what has been agreed: a request still received or offered waits.
        if (s.status && s.status !== "approved") continue;
        if (s.purpose === "transfer") {
          note(`branch move ${date}`, s.pet_id, "cross-facility move — Woof has one site");
          continue;
        }
        const location =
          s.location_text && s.location_lat != null && s.location_lng != null
            ? { label: s.location_text, lat: s.location_lat, lng: s.location_lng }
            : null;
        if (s.location_text && !location) {
          note(`trip ${date}`, s.pet_id, "a different address with no pin");
          continue;
        }
        push(
          {
            ...base,
            ref: ref("request", s.source_id, s.pet_id),
            kind: "one_off",
            startMin: slotStartMin(s.run_time),
            note: [s.purpose === "vet" ? "Vet" : null, s.note].filter(Boolean).join(" · ") || null,
            ...(location ? { location } : {}),
          },
          s.pet_id,
        );
        continue;
      }
      if (s.source === "daycare" || s.source === "boarding") {
        if (covered.has(`${s.pet_id}|${s.direction}`)) continue;
        push(
          {
            ...base,
            ref: ref(s.source, s.source_id, s.pet_id, s.direction),
            kind: "one_off",
            startMin: null,
            note: s.source === "boarding" ? `Boarding ${s.note ?? ""}`.trim() : "Daycare transport",
          },
          s.pet_id,
        );
      }
    }
  }

  const clients = [...usedPets].map((petId) => {
    const pet = pets.get(petId);
    return {
      ref: ref("pet", petId),
      passengerId: Number(pet.voltlines_passenger_id),
      petName: pet.name,
      ownerName: ownerName(pet.owner),
      site: WOOF_SITE,
      lat: pet.owner?.pin_lat ?? null,
      lng: pet.owner?.pin_lng ?? null,
    };
  });

  return { body: { op: "sync", from, to, clients, rules, requests }, notSent };
}
