// /api/transport-voltlines — link a Woof dog to a Voltlines passenger so a request
// can be sent to the transport hub. Search and link only. Creating a passenger
// stays on Admin Essentials.
//
//   GET  ?status=1
//   GET  ?passengers=<text>     live search, one GET
//   POST { op: "link", petId, passengerId }
//   POST { op: "unlink", petId }
//   POST { op: "directory_sync", next? }   admin / management. Reads only.
//   POST { op: "create", petId, addressLine? }        creates the household + passenger
//   POST { op: "push_home", petIds }                  admin / management
//   POST { op: "push_owner_home", ownerId }           after the profile saves a pin/address
//
// Every write refuses unless VOLTLINES_WRITE_ENABLED is exactly "true": the Voltlines
// account is MSH dispatch's, so it is switched on only once they agree.

export const config = { maxDuration: 30 };

import { createClient } from "@supabase/supabase-js";
import {
  passengerNames,
  plannablePassengerAddress,
  voltlinesConfigured,
  voltlinesGet,
  voltlinesPatch,
  voltlinesPost,
  voltlinesWritesEnabled,
} from "./_lib/voltlines.js";
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
    ({ data: row } = await admin.from("staff").select("active, role, first_name, last_name").ilike("email", user.email).maybeSingle());
  }
  if (!row) ({ data: row } = await admin.from("staff").select("active, role, first_name, last_name").eq("id", user.id).maybeSingle());
  if (!row?.active) throw new HttpError(403, "Only active staff can use Voltlines matching");
  // The push log records who moved an address, and woof.staff has no single name column.
  const name = clean([row.first_name, row.last_name].filter(Boolean).join(" ")) || user.email || "staff";
  return { ...row, name };
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

/** Woof's Voltlines project, where new households are created. */
const projectId = () => {
  const n = Number(process.env.VOLTLINES_PROJECT_ID);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const idOf = (r) => r?.id ?? r?.data?.id ?? null;

/**
 * A profile address line only when it reads like one. The field is often a maps link
 * or a one-word landmark, and neither belongs on a Voltlines address.
 */
export function voltlinesAddressLine(raw) {
  const typed = clean(raw);
  if (!typed || /^https?:\/\//i.test(typed) || /maps\.app\.goo\.gl|google\.com\/maps/i.test(typed)) return null;
  if (/\d/.test(typed) || typed.split(" ").length >= 3) return typed;
  return null;
}

/** "+9715XXXXXXXX" from a phone as typed, or null (Voltlines 500s on local formats). */
export function voltlinesPhone(raw) {
  let d = String(raw ?? "").split(/[\/,]/)[0].replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("05")) d = `971${d.slice(1)}`;
  if (d.length === 9 && d.startsWith("5")) d = `971${d}`;
  return d.length >= 11 && d.length <= 15 ? `+${d}` : null;
}

async function petWithOwner(admin, petId) {
  const { data: pet, error } = await admin
    .from("pets")
    .select(
      "id, name, owner_id, voltlines_passenger_id, owners(id, first_name, last_name, phone, email, address, pin_lat, pin_lng, transport_notes, voltlines_customer_id, voltlines_branch_id)",
    )
    .eq("id", petId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!pet) throw new HttpError(404, "That dog no longer exists");
  return pet;
}

/**
 * AE's createVoltlinesPassenger: beside a sibling already on Voltlines (same household,
 * home and stops), else a new household — customer, branch, passenger — at the owner's
 * home pin. Voltlines geocodes nothing, so no pin means no create.
 *
 * Woof's clients are not on Voltlines at all yet, so for most dogs this is the new
 * household path; the second dog of a house then joins the first.
 */
async function create(admin, { petId, addressLine }, staff) {
  if (!voltlinesWritesEnabled()) throw new HttpError(503, "Creating on Voltlines is switched off for Woof", "writes_disabled");
  const project = projectId();
  if (!project) throw new HttpError(503, "Woof's Voltlines project is not set (VOLTLINES_PROJECT_ID)", "project_missing");
  if (!petId) throw new HttpError(400, "Pick the dog to create");
  const pet = await petWithOwner(admin, petId);
  if (pet.voltlines_passenger_id) {
    throw new HttpError(409, `${pet.name} is already Voltlines passenger ${pet.voltlines_passenger_id}`, "already_on_voltlines");
  }
  const owner = pet.owners ?? {};
  const household = clean([owner.first_name, owner.last_name].filter(Boolean).join(" ")) || pet.name;

  const { data: siblings } = await admin
    .from("pets")
    .select("id, name, voltlines_passenger_id")
    .eq("owner_id", pet.owner_id)
    .not("voltlines_passenger_id", "is", null)
    .limit(1);
  const sibling = siblings?.[0] ?? null;
  const steps = [];
  let branchId;
  let address;
  let lastName = household;
  if (sibling) {
    const p = await voltlinesGet(`v3/passenger/${sibling.voltlines_passenger_id}/`, { retry: false });
    const home =
      (p?.addresses ?? []).find((a) => !a.is_archived && a.id === p?.default_address_id) ??
      (p?.addresses ?? []).find((a) => !a.is_archived && a.coordinate?.latitude != null);
    branchId = p?.branch?.id ?? null;
    if (!branchId || !home?.coordinate) {
      throw new HttpError(
        409,
        `${sibling.name}'s Voltlines passenger has no household or home to share — create ${pet.name} in Voltlines by hand`,
        "sibling_without_home",
      );
    }
    lastName = passengerNames(p).owner || household;
    address = {
      line: home.address_line || home.open_address || "Home",
      lat: home.coordinate.latitude,
      lng: home.coordinate.longitude,
      pickupStopId: home.pickup?.id ?? null,
      dropoffStopId: home.dropoff?.id ?? null,
    };
    steps.push({ step: "sibling", passengerId: sibling.voltlines_passenger_id, branchId });
  } else {
    if (!pinUsable(owner.pin_lat, owner.pin_lng)) {
      throw new HttpError(400, `${household} has no usable home pin — add one on the client profile first`, "no_pin");
    }
    address = { line: clean(addressLine) || clean(owner.address) || household, lat: Number(owner.pin_lat), lng: Number(owner.pin_lng) };
    const phone = voltlinesPhone(owner.phone);
    const customer = await voltlinesPost("v3/customer/", {
      name: household,
      type: "corporate",
      contact_info: {
        full_name: household,
        ...(phone ? { phone_number: phone } : {}),
        ...(owner.email ? { email: clean(owner.email) } : {}),
      },
    });
    const customerId = idOf(customer);
    if (!customerId) throw new HttpError(502, "Voltlines did not return the new customer");
    steps.push({ step: "customer", customerId });
    const branch = await voltlinesPost(`v3/customer/${customerId}/branch/`, {
      name: household,
      project_id: project,
      address: {
        name: `${household} Office`,
        address_line: address.line,
        coordinate: { latitude: address.lat, longitude: address.lng },
      },
    });
    branchId = idOf(branch);
    if (!branchId) throw new HttpError(502, `Voltlines made customer ${customerId} but returned no household branch`);
    steps.push({ step: "branch", branchId });
    await admin
      .from("owners")
      .update({ voltlines_customer_id: String(customerId), voltlines_branch_id: String(branchId) })
      .eq("id", pet.owner_id);
  }

  const created = await voltlinesPost(`v3/branch/${branchId}/passenger/`, {
    first_name: clean(pet.name),
    last_name: lastName,
    phone_number: sibling ? null : voltlinesPhone(owner.phone),
    tags: ["woof-created"],
    ...(clean(owner.transport_notes) ? { notes: String(owner.transport_notes).trim() } : {}),
    address: {
      name: "Home",
      address_type: "home",
      address_line: address.line,
      coordinate: { latitude: address.lat, longitude: address.lng },
      ...(address.pickupStopId != null ? { pickup_stop_id: address.pickupStopId } : {}),
      ...(address.dropoffStopId != null ? { dropoff_stop_id: address.dropoffStopId } : {}),
    },
  });
  const passengerId = idOf(created);
  if (!passengerId) throw new HttpError(502, "Voltlines did not return the new passenger");
  const { error } = await admin.from("pets").update({ voltlines_passenger_id: String(passengerId) }).eq("id", pet.id);
  if (error) {
    throw new HttpError(
      500,
      `Created Voltlines passenger ${passengerId}, but could not link it: ${error.message}. Link it with the search on the request form.`,
      "created_not_linked",
    );
  }
  console.log("[voltlines] created", JSON.stringify({ pet: pet.id, passengerId, steps, by: staff.name }));
  return { message: `${pet.name} created on Voltlines as passenger ${passengerId}`, passengerId: String(passengerId), steps };
}

/**
 * AE's setHouseholdPin, one dog: PATCH the passenger's home (confirm: true) with Woof's
 * pin and, when the profile line reads as an address, that line. Then the household
 * branch address, once per call. A route already running keeps its snapshot.
 * Throws when this dog cannot be moved; the callers decide what that means.
 */
async function pushOneHome(admin, petId, staff, branchesDone) {
  let logId = null;
  const pet = await petWithOwner(admin, petId);
  const owner = pet.owners ?? {};
  if (!pet.voltlines_passenger_id) throw new Error("not linked to a Voltlines passenger");
  if (!pinUsable(owner.pin_lat, owner.pin_lng)) throw new Error("the client has no usable home pin in Woof");
  const line = voltlinesAddressLine(owner.address);
  const lat = Number(owner.pin_lat);
  const lng = Number(owner.pin_lng);
  const p = await voltlinesGet(`v3/passenger/${encodeURIComponent(pet.voltlines_passenger_id)}/`, { retry: false });
  const home = homeAddressOf(p);
  if (!home?.id) throw new Error("has no home address on Voltlines to move");
  const branchAddress = p?.branch?.address ?? null;
  const { data: log } = await admin
    .from("voltlines_address_push_log")
    .insert({
      pet_id: pet.id,
      owner_id: pet.owner_id,
      passenger_id: String(pet.voltlines_passenger_id),
      address_id: String(home.id),
      before_line: home.address_line ?? null,
      before_lat: home.coordinate?.latitude ?? null,
      before_lng: home.coordinate?.longitude ?? null,
      after_line: line,
      after_lat: lat,
      after_lng: lng,
      branch_address_id: branchAddress?.id != null ? String(branchAddress.id) : null,
      branch_before_line: branchAddress?.address_line ?? null,
      branch_before_lat: branchAddress?.coordinate?.latitude ?? null,
      branch_before_lng: branchAddress?.coordinate?.longitude ?? null,
      pushed_by: staff.name,
    })
    .select("id")
    .maybeSingle();
  logId = log?.id ?? null;
  try {
    await voltlinesPatch(`v3/passenger/${encodeURIComponent(pet.voltlines_passenger_id)}/addresses/${home.id}/`, {
      coordinate: { latitude: lat, longitude: lng },
      ...(line ? { address_line: line } : {}),
      confirm: true,
    });
    let branchNote = null;
    if (line && branchAddress?.id != null && !branchesDone.has(String(branchAddress.id))) {
      branchesDone.add(String(branchAddress.id));
      const branchOnPin = branchAddress?.coordinate?.latitude === lat && branchAddress?.coordinate?.longitude === lng;
      if (branchAddress.address_line !== line || !branchOnPin) {
        try {
          await voltlinesPatch(`v3/branch-address/${branchAddress.id}/`, {
            address_line: line,
            coordinate: { latitude: lat, longitude: lng },
          });
        } catch (e) {
          branchNote = `household address not relabelled: ${e.message}`;
        }
      }
    }
    if (logId) await admin.from("voltlines_address_push_log").update({ status: "done", error: branchNote }).eq("id", logId);
    await admin
      .from("voltlines_passenger_directory")
      .update({ address_line: line ?? home.address_line ?? null, lat, lng, fetched_at: new Date().toISOString() })
      .eq("passenger_id", String(pet.voltlines_passenger_id));
    return { petId, pet: pet.name, passengerId: String(pet.voltlines_passenger_id), ok: true, note: branchNote };
  } catch (e) {
    if (logId) await admin.from("voltlines_address_push_log").update({ status: "failed", error: e.message }).eq("id", logId);
    throw e;
  }
}

/** Picked dogs, admin or management only. One dog failing never stops the rest. */
async function pushHome(admin, { petIds }, staff) {
  if (!["admin", "management"].includes(staff.role)) throw new HttpError(403, "Only admin or management can change Voltlines addresses");
  if (!voltlinesWritesEnabled()) throw new HttpError(503, "Voltlines writes are switched off for Woof", "writes_disabled");
  const ids = [...new Set(Array.isArray(petIds) ? petIds : [])].slice(0, 60);
  if (!ids.length) throw new HttpError(400, "Pick the dogs to send");
  const results = [];
  const branchesDone = new Set();
  for (const petId of ids) {
    try {
      results.push(await pushOneHome(admin, petId, staff, branchesDone));
    } catch (e) {
      results.push({ petId, ok: false, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const ok = results.filter((r) => r.ok).length;
  console.log("[voltlines] push_home", JSON.stringify({ by: staff.name, ok, failed: results.length - ok }));
  return { message: `Sent ${ok} of ${results.length} to Voltlines`, results };
}

/**
 * The client profile just saved a new address or pin. Every dog of that household
 * already on Voltlines gets the same door — moving one and not its sibling splits the
 * stop. A household with nobody linked is not an error: there is nothing to move, and
 * saying so lets the profile report "saved" without a red toast.
 */
async function pushOwnerHome(admin, { ownerId }, staff) {
  if (!ownerId) throw new HttpError(400, "Say which client");
  const { data: pets, error } = await admin
    .from("pets")
    .select("id, name")
    .eq("owner_id", ownerId)
    .not("voltlines_passenger_id", "is", null);
  if (error) throw new HttpError(500, error.message);
  const ids = (pets ?? []).map((p) => p.id);
  if (!ids.length) return { message: "Nobody in this household is on Voltlines", updated: [], results: [] };
  if (!voltlinesWritesEnabled()) throw new HttpError(503, "Voltlines writes are switched off for Woof", "writes_disabled");
  const results = [];
  const branchesDone = new Set();
  for (const petId of ids) {
    try {
      results.push(await pushOneHome(admin, petId, staff, branchesDone));
    } catch (e) {
      results.push({ petId, ok: false, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const updated = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  console.log("[voltlines] push_owner_home", JSON.stringify({ ownerId, by: staff.name, ok: updated.length, failed: failed.length }));
  if (!updated.length) {
    throw new HttpError(502, failed.map((r) => r.error).filter(Boolean).join("; ") || "Voltlines did not take the new home");
  }
  const names = updated.map((r) => r.pet).filter(Boolean).join(", ");
  return {
    message: failed.length
      ? `Voltlines home updated for ${names}. Not updated: ${failed.map((r) => r.error).join("; ")}`
      : `Voltlines home updated for ${names}`,
    updated,
    results,
  };
}

export default async function handler(req, res) {
  try {
    const { url, anon, admin } = clients();
    const staff = await staffOf(req, url, anon, admin);
    if (req.method === "GET") {
      const q = req.query ?? {};
      if (q.status) {
        return json(res, 200, {
          configured: voltlinesConfigured(),
          writesEnabled: voltlinesWritesEnabled(),
          projectConfigured: !!projectId(),
        });
      }
      if (q.passengers != null) return json(res, 200, await searchPassengers(admin, q.passengers));
      return json(res, 400, { error: "Unknown query" });
    }
    if (req.method !== "POST") return json(res, 405, { error: "GET or POST only" });
    if (!voltlinesConfigured()) throw new HttpError(503, "Voltlines is not configured");
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
    if (body.op === "link") return json(res, 200, await link(admin, body));
    if (body.op === "unlink") return json(res, 200, await unlink(admin, body));
    if (body.op === "directory_sync") return json(res, 200, await directorySync(admin, body, staff));
    if (body.op === "create") return json(res, 200, await create(admin, body, staff));
    if (body.op === "push_home") return json(res, 200, await pushHome(admin, body, staff));
    if (body.op === "push_owner_home") return json(res, 200, await pushOwnerHome(admin, body, staff));
    return json(res, 400, { error: "Unknown op" });
  } catch (err) {
    return json(res, err.status || 500, { error: err.message, code: err.code ?? null });
  }
}
