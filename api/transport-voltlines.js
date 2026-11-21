// /api/transport-voltlines — link a Woof dog to a Voltlines passenger so a request
// can be sent to the transport hub. Search and link only. Creating a passenger
// stays on Admin Essentials.
//
//   GET  ?status=1
//   GET  ?passengers=<text>     live search, one GET
//   POST { op: "link", petId, passengerId }
//   POST { op: "unlink", petId }
//   POST { op: "directory_sync", next? }   admin / management. Reads only.

export const config = { maxDuration: 30 };

import { createClient } from "@supabase/supabase-js";
import { passengerNames, plannablePassengerAddress, voltlinesConfigured, voltlinesGet } from "./_lib/voltlines.js";
import { inServiceArea } from "./_lib/serviceArea.js";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const pinUsable = (lat, lng) => lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && inServiceArea(Number(lat), Number(lng));

function clients() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) throw new HttpError(500, "Missing Supabase server env vars");
  return {
    url,
    anon,
    admin: createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

async function staffOf(req, url, anon, admin) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new HttpError(401, "Not authorised");
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Not authorised");
  const user = data.user;
  let row = null;
  if (user.email) {
    ({ data: row } = await admin.from("staff").select("active, role").ilike("email", user.email).maybeSingle());
  }
  if (!row) ({ data: row } = await admin.from("staff").select("active, role").eq("id", user.id).maybeSingle());
  if (!row?.active) throw new HttpError(403, "Only active staff can use Voltlines matching");
  return row;
}

function hitOf(row, claim) {
  const names = passengerNames(row);
  const addr = plannablePassengerAddress(row);
  return {
    passengerId: row?.id != null ? String(row.id) : null,
    name: names.full,
    petName: names.pet,
    ownerName: names.owner,
    address: addr?.line ?? null,
    claimedByPetId: claim?.id ?? null,
    claimedByPetName: claim?.name ?? null,
    pinUsable: pinUsable(addr?.lat, addr?.lng),
  };
}

async function searchPassengers(admin, q) {
  const term = clean(q);
  if (term.length < 2) throw new HttpError(400, "Type at least two letters");
  const raw = await voltlinesGet(`v3/passenger/?search=${encodeURIComponent(term)}&page_size=25`, { retry: false });
  const rows = Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : [];
  const ids = rows.map((r) => r?.id).filter((v) => v != null).map(String);
  let claims = [];
  if (ids.length) {
    const { data } = await admin.from("pets").select("id, name, voltlines_passenger_id").in("voltlines_passenger_id", ids);
    claims = data ?? [];
  }
  const byId = new Map(claims.map((c) => [String(c.voltlines_passenger_id), c]));
  return { query: term, passengers: rows.map((r) => hitOf(r, byId.get(String(r?.id)))) };
}

async function link(admin, { petId, passengerId }) {
  const pid = clean(passengerId);
  if (!petId || !pid) throw new HttpError(400, "Pick the dog and the passenger");
  const { data: pet, error: petErr } = await admin.from("pets").select("id, name, owner_id").eq("id", petId).maybeSingle();
  if (petErr) throw new HttpError(500, petErr.message);
  if (!pet) throw new HttpError(404, "That dog no longer exists");
  const { data: other } = await admin.from("pets").select("id, name").eq("voltlines_passenger_id", pid).neq("id", petId).maybeSingle();
  if (other) throw new HttpError(409, `Voltlines passenger ${pid} is already ${other.name}`, "claimed");
  const passenger = await voltlinesGet(`v3/passenger/${encodeURIComponent(pid)}/`, { retry: false });
  const { error } = await admin.from("pets").update({ voltlines_passenger_id: pid }).eq("id", petId);
  if (error) throw new HttpError(500, error.message);
  const branchId = passenger?.branch?.id != null ? String(passenger.branch.id) : null;
  const customerId = passenger?.branch?.customer?.id ?? passenger?.branch?.customer_id ?? passenger?.customer?.id ?? null;
  if (pet.owner_id && (branchId || customerId)) {
    const patch = {};
    if (branchId) patch.voltlines_branch_id = branchId;
    if (customerId != null) patch.voltlines_customer_id = String(customerId);
    await admin.from("owners").update(patch).eq("id", pet.owner_id);
  }
  const names = passengerNames(passenger);
  return { message: `${pet.name} is Voltlines passenger ${pid}${names.full ? ` (${names.full})` : ""}`, passengerId: pid };
}

async function unlink(admin, { petId }) {
  if (!petId) throw new HttpError(400, "Pick the dog");
  const { data: pet } = await admin.from("pets").select("id, name").eq("id", petId).maybeSingle();
  if (!pet) throw new HttpError(404, "That dog no longer exists");
  const { error } = await admin.from("pets").update({ voltlines_passenger_id: null }).eq("id", petId);
  if (error) throw new HttpError(500, error.message);
  return { message: `${pet.name} is no longer linked to a Voltlines passenger` };
}

/** AE's homeAddressOf: the passenger's default address, else its first live one. */
function homeAddressOf(p) {
  const list = (p?.addresses ?? []).filter((a) => !a.is_archived);
  return (
    list.find((a) => a.id === p?.default_address_id) ??
    list.find((a) => a.is_default) ??
    list.find((a) => a.coordinate?.latitude != null) ??
    list[0] ??
    null
  );
}

/** A Voltlines "next" link back to a path our client can call. */
const pagePath = (u) => String(u).replace(new RegExp("^https?://[^/]+/api/"), "");

function directoryRow(p, now) {
  const user = p?.profile?.user ?? {};
  const home = homeAddressOf(p);
  const branchAddress = p?.branch?.address ?? null;
  const str = (v) => (v == null ? null : String(v));
  return {
    passenger_id: String(p.id),
    first_name: clean(user.first_name) || null,
    last_name: clean(user.last_name) || null,
    full_name: clean(user.full_name) || clean([user.first_name, user.last_name].filter(Boolean).join(" ")) || null,
    phone: clean(user.phone_number ?? p?.phone_number ?? p?.profile?.phone_number) || null,
    status: str(p?.status),
    branch_id: str(p?.branch?.id),
    customer_id: str(p?.branch?.customer?.id ?? p?.branch?.customer_id ?? p?.branch?.customer),
    home_address_id: str(home?.id),
    address_line: clean(home?.address_line || home?.open_address || home?.title) || null,
    lat: home?.coordinate?.latitude ?? null,
    lng: home?.coordinate?.longitude ?? null,
    branch_address_id: str(branchAddress?.id),
    branch_address_line: clean(branchAddress?.address_line) || null,
    raw_tags: Array.isArray(p?.tags) ? p.tags.map((t) => String(t?.name ?? t)) : null,
    fetched_at: now,
  };
}

/**
 * One call reads as many directory pages as fit in ~20 s, gently (a pause between
 * pages, Woof's own client name), and saves them. The caller repeats with the
 * returned `next` until it is null. Reads only — nothing is written to Voltlines.
 *
 * The account is MSH dispatch's, so this stays a deliberate admin action and never
 * runs on a schedule. It never touches calculate-route, so it spends none of AE's
 * route budget.
 */
async function directorySync(admin, { next }, staff) {
  if (!["admin", "management"].includes(staff.role)) {
    throw new HttpError(403, "Only admin or management can read the whole directory");
  }
  let path = next ? pagePath(next) : "v3/passenger/?page_size=100";
  if (!path.startsWith("v3/passenger/")) throw new HttpError(400, "Bad page");
  const started = Date.now();
  let saved = 0;
  let total = null;
  while (path && Date.now() - started < 20000) {
    const page = await voltlinesGet(path);
    total = typeof page?.count === "number" ? page.count : total;
    const now = new Date().toISOString();
    const rows = (page?.results ?? []).filter((p) => p?.id != null).map((p) => directoryRow(p, now));
    if (rows.length) {
      const { error } = await admin.from("voltlines_passenger_directory").upsert(rows, { onConflict: "passenger_id" });
      if (error) throw new HttpError(500, error.message);
      saved += rows.length;
    }
    path = page?.next ? pagePath(page.next) : null;
    if (path) await new Promise((r) => setTimeout(r, 400));
  }
  return { saved, next: path, total };
}

export default async function handler(req, res) {
  try {
    const { url, anon, admin } = clients();
    const staff = await staffOf(req, url, anon, admin);
    if (req.method === "GET") {
      const q = req.query ?? {};
      if (q.status) return json(res, 200, { configured: voltlinesConfigured() });
      if (q.passengers != null) return json(res, 200, await searchPassengers(admin, q.passengers));
      return json(res, 400, { error: "Unknown query" });
    }
    if (req.method !== "POST") return json(res, 405, { error: "GET or POST only" });
    if (!voltlinesConfigured()) throw new HttpError(503, "Voltlines is not configured");
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
    if (body.op === "link") return json(res, 200, await link(admin, body));
    if (body.op === "unlink") return json(res, 200, await unlink(admin, body));
    if (body.op === "directory_sync") return json(res, 200, await directorySync(admin, body, staff));
    return json(res, 400, { error: "Unknown op" });
  } catch (err) {
    return json(res, err.status || 500, { error: err.message, code: err.code ?? null });
  }
}
