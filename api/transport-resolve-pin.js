// POST /api/transport-resolve-pin  { text }
//
// Reads the pin out of a pasted Google Maps link (following a short maps.app.goo.gl
// link, and opening the map page when the link only names the place) so the owner
// form can show staff the pin was found before they save. Same reader as AE's
// endpoint of the same name (api/_lib/mapsPin.js is a copy of AE's).

// Opening the share page is a second round trip to Google.
export const config = { maxDuration: 30 };

import { createClient } from "@supabase/supabase-js";
import { pinFromAddress } from "./_lib/mapsPin.js";
import { serviceAreaOf } from "./_lib/serviceArea.js";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function isActiveStaff(admin, user) {
  if (user.email) {
    const { data } = await admin.from("staff").select("active").ilike("email", user.email).maybeSingle();
    if (data) return !!data.active;
  }
  const { data } = await admin.from("staff").select("active").eq("id", user.id).maybeSingle();
  return !!data?.active;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return json(res, 500, { error: "Missing Supabase server env vars" });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) return json(res, 401, { error: "Not authorised" });

  const client = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const {
    data: { user },
    error: userErr,
  } = await client.auth.getUser(token);
  if (userErr || !user) return json(res, 401, { error: "Not authorised" });
  if (!(await isActiveStaff(admin, user))) return json(res, 403, { error: "Not authorised" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  const text = String(body.text ?? "").trim();
  if (!text) return json(res, 400, { error: "Paste a Google Maps link" });

  const trace = [];
  const pin = await pinFromAddress(text, { trace });
  if (!pin) {
    // Hosts and paths only — the link itself names a client's home.
    console.warn("[resolve-pin] no pin", { region: process.env.VERCEL_REGION ?? null, trace });
    return json(res, 422, {
      error: "No usable pin in that link. Drop a pin in Google Maps and share it, or type \"lat, lng\".",
    });
  }
  const area = serviceAreaOf(pin.lat, pin.lng);
  return json(res, 200, { lat: pin.lat, lng: pin.lng, source: pin.source, area: area?.label ?? null });
}
