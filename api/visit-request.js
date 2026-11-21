/**
 * Public endpoint behind the website's "Request a visit" form
 * (the Coro Campus – Woof landing page at woofdubai.ae).
 *
 * POST JSON or form body:
 *   { name, phone, petName?, interest?, notes?, page?, website (honeypot) }
 * → 200 { ok: true }  and a row in visit_requests.
 *
 * Staff see the list on /visit-requests.
 */
import { createClient } from "@supabase/supabase-js";
import { allowedOrigin, parseVisitRequest } from "./_lib/visitRequest.js";

export const config = { maxDuration: 15 };

const MAX_PER_HOUR = 3;
const UNAVAILABLE = "Requests are unavailable right now. Please message us on WhatsApp.";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function formBody(req) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return Object.fromEntries(new URLSearchParams(req.body)); }
  }
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
  return {};
}

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

export default async function handler(req, res, deps = {}) {
  const origin = allowedOrigin(req.headers?.origin);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return json(res, 405, { ok: false, error: "Use POST." });
  }

  const parsed = parseVisitRequest(formBody(req));
  if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error });
  // A filled honeypot gets the normal answer so bots learn nothing.
  if (parsed.spam) return json(res, 200, { ok: true });
  const v = parsed.value;

  const service = deps.service ?? serviceClient();
  if (!service) return json(res, 503, { ok: false, error: UNAVAILABLE });

  const { count, error: countError } = await service
    .from("visit_requests")
    .select("id", { count: "exact", head: true })
    .eq("phone", v.phone)
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (countError) return json(res, 503, { ok: false, error: UNAVAILABLE });
  if ((count || 0) >= MAX_PER_HOUR) return json(res, 429, { ok: false, error: "We already have your request. The team will be in touch soon." });

  const { error: insertError } = await service.from("visit_requests").insert({
    contact_name: v.contactName,
    phone: v.phone,
    pet_name: v.petName,
    interest: v.interest,
    client_note: v.notes,
    source: "website",
    source_page: v.sourcePage,
  });
  if (insertError) return json(res, 503, { ok: false, error: UNAVAILABLE });

  return json(res, 200, { ok: true });
}
