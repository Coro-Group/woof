// /api/transport-hub — Woof ⇄ the transport hub (admin-essentials).
//
//   GET  ?status=1  → { enabled, configured, hub }
//   POST { op: "quote", petId, date, direction, startMin, location? }
//   POST { op: "sync" }  admin / management. Sends today + 56 days.
//
// Refused unless TRANSPORT_HUB_ENABLED is exactly "true" and the AE URL and secret are set.

export const config = { maxDuration: 300 };

import { createClient } from "@supabase/supabase-js";
import { SYNC_DAYS, addDays, buildHubSync, hubConfigured, hubEnabled, hubPost } from "./_lib/transportHub.js";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const dubaiToday = () => new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);

async function caller(req) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) throw new HttpError(500, "Missing Supabase server env vars");
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new HttpError(401, "Not authorised");
  const db = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Not authorised");
  const email = data.user.email;
  let staff = null;
  if (email) ({ data: staff } = await db.from("staff").select("active, role").ilike("email", email).maybeSingle());
  if (!staff) ({ data: staff } = await db.from("staff").select("active, role").eq("id", data.user.id).maybeSingle());
  if (!staff?.active) throw new HttpError(403, "Only active staff can use the transport hub");
  return { db, staff };
}

function requireSwitchedOn() {
  if (!hubEnabled()) throw new HttpError(503, "The link to the transport hub is switched off");
  if (!hubConfigured()) throw new HttpError(503, "The transport hub address or secret is not set");
}

async function quote(db, body) {
  const { petId, date, direction, startMin, location, kind } = body ?? {};
  if (!petId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) throw new HttpError(422, "petId and date are required");
  if (direction !== "pickup" && direction !== "dropoff") throw new HttpError(422, "direction must be pickup or dropoff");
  if (!Number.isInteger(startMin)) throw new HttpError(422, "startMin is required (the hour asked for)");
  const { data: pet } = await db.from("pets").select("id, voltlines_passenger_id").eq("id", petId).maybeSingle();
  if (!pet) throw new HttpError(404, "Dog not found");
  if (!pet.voltlines_passenger_id) {
    throw new HttpError(409, "This dog has no transport profile yet — create it on the request first");
  }
  // new_recurring: AE quotes it against the Master base for the weekday of `date`.
  const quoteKind = kind === "new_recurring" ? { kind: "new_recurring" } : {};
  try {
    return await hubPost({ op: "quote", clientRef: `woof:pet:${petId}`, date, direction, startMin, ...quoteKind, ...(location ? { location } : {}) });
  } catch (err) {
    // A profile created moments ago is still on its way to the dispatch board.
    if (err.status === 404) {
      throw new HttpError(409, "This dog's transport profile is still reaching the dispatch board — press Offer again in a few seconds.");
    }
    throw err;
  }
}

async function sync(db) {
  const from = dubaiToday();
  const to = addDays(from, SYNC_DAYS - 1);
  const { data: regulars, error: rErr } = await db.from("transport_regular").select("*").eq("is_active", true);
  if (rErr) throw new HttpError(500, rErr.message);

  const dates = Array.from({ length: SYNC_DAYS }, (_, i) => addDays(from, i));
  const days = [];
  for (let i = 0; i < dates.length; i += 8) {
    const batch = await Promise.all(
      dates.slice(i, i + 8).map(async (date) => {
        const { data, error } = await db.rpc("transport_day_demand", { p_date: date, p_branch_id: null });
        if (error) throw new HttpError(500, `Reading ${date}: ${error.message}`);
        return { date, stops: data ?? [] };
      }),
    );
    days.push(...batch);
  }

  // Dogs on requests still waiting: AE needs them as clients to offer them times.
  const { data: openReqs, error: oErr } = await db
    .from("transport_request")
    .select("service_date, weekday, transport_request_pet(pet_id)")
    .in("status", ["received", "offered"])
    .in("kind", ["one_off", "new_recurring"]);
  if (oErr) throw new HttpError(500, oErr.message);
  const openPets = (openReqs ?? [])
    .filter((r) => r.weekday != null || (r.service_date && r.service_date >= from))
    .flatMap((r) => (r.transport_request_pet ?? []).map((p) => ({ petId: p.pet_id })));

  const petIds = new Set((regulars ?? []).map((r) => r.pet_id));
  for (const o of openPets) if (o.petId) petIds.add(o.petId);
  for (const d of days) for (const s of d.stops) if (s.pet_id) petIds.add(s.pet_id);
  const pets = new Map();
  const ids = [...petIds];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from("pets")
      .select("id, name, voltlines_passenger_id, owners(first_name, last_name, pin_lat, pin_lng)")
      .in("id", ids.slice(i, i + 200));
    if (error) throw new HttpError(500, error.message);
    for (const p of data ?? []) pets.set(p.id, { ...p, owner: p.owners });
  }

  const { body, notSent } = buildHubSync({ from, to, regulars: regulars ?? [], days, pets, openPets });
  const hub = await hubPost(body);
  const byDog = new Map();
  for (const n of notSent) {
    const key = `${n.petId}|${n.reason}`;
    const held = byDog.get(key) ?? { petId: n.petId, pet: n.pet, reason: n.reason, count: 0 };
    held.count += 1;
    byDog.set(key, held);
  }
  return {
    ok: true,
    range: { from, to },
    sent: { dogs: body.clients.length, regulars: body.rules.length, dated: body.requests.length },
    hub,
    notSent: [...byDog.values()].sort((a, b) => String(a.pet).localeCompare(String(b.pet))),
  };
}

/** Service-role client for the automatic sync (no user session). */
function serviceDb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, "Missing Supabase service env vars");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const AUTO_MAX_RUNS = 4;

/**
 * The database-kicked sync. Claims the one autosync row (so two never overlap and an
 * older picture never lands after a newer one), syncs, reports, and goes again while
 * changes keep arriving (at most AUTO_MAX_RUNS times; the cron picks up the rest).
 */
async function autoSync(token) {
  if (typeof token !== "string" || token.length < 32) throw new HttpError(401, "Not authorised");
  requireSwitchedOn();
  const db = serviceDb();
  const { data: claim, error: cErr } = await db.rpc("transport_hub_autosync_claim", { p_token: token });
  if (cErr) throw new HttpError(500, cErr.message);
  if (!claim?.ok) {
    if (claim?.reason === "bad token") throw new HttpError(401, "Not authorised");
    return { ok: true, skipped: claim?.reason ?? "busy" };
  }
  let generation = claim.generation;
  const runs = [];
  for (let i = 1; i <= AUTO_MAX_RUNS; i += 1) {
    let summary = null;
    let failure = null;
    try {
      const r = await sync(db);
      summary = { range: r.range, sent: r.sent, hub: r.hub, notSent: r.notSent.length, generation };
    } catch (err) {
      failure = String(err?.message ?? err).slice(0, 1000);
    }
    const { data: fin, error: fErr } = await db.rpc("transport_hub_autosync_finish", {
      p_token: token,
      p_generation: generation,
      p_result: summary,
      p_error: failure,
      p_continue: i < AUTO_MAX_RUNS,
    });
    runs.push(summary ?? { error: failure });
    if (fErr) throw new HttpError(500, fErr.message);
    if (failure || !fin?.again) break;
    generation = fin.generation;
  }
  return { ok: true, runs };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      await caller(req);
      const enabled = hubEnabled();
      const configured = hubConfigured();
      let hub = null;
      if (enabled && configured) hub = await hubPost({ op: "status" }).catch((err) => ({ enabled: false, error: err.message }));
      return json(res, 200, { enabled, configured, hub });
    }
    if (req.method !== "POST") return json(res, 405, { error: "GET or POST only" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
    if (body.op === "auto") return json(res, 200, await autoSync(body.token));
    const { db, staff } = await caller(req);
    requireSwitchedOn();
    if (body.op === "quote") return json(res, 200, await quote(db, body));
    if (body.op === "sync") {
      if (!["admin", "management"].includes(staff.role)) throw new HttpError(403, "Only admin or management can sync with the hub");
      return json(res, 200, await sync(db));
    }
    return json(res, 400, { error: "Unknown op" });
  } catch (err) {
    return json(res, err.status || 500, { error: err.message, details: err.details ?? null, code: err.code ?? null });
  }
}
