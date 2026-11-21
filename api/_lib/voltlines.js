// Voltlines Control Tower client — reads, plus ONE switched-off write path.
//
// Woof's clients are not on Voltlines yet — the team creates them from here. The
// transport team's hub is admin-essentials (AE), which also talks to Voltlines; Woof hands its
// requests and regulars to AE. This file is the same client as AE's
// api/_lib/voltlines.js, cut down to reads, so that step 2 starts from a tested
// connection instead of a new one:
//
//   * Reads: the admin "Connection check" and the Transport › Regulars › Match
//     Voltlines search (api/transport-voltlines.js), one GET per search.
//   * Writes: AE's "create this dog on Voltlines" (customer → branch → passenger, or a
//     passenger beside a sibling) through voltlinesPost(), and AE's household pin move
//     (PATCH the passenger's home address and the branch address) through
//     voltlinesPatch(). Both refuse
//     unless VOLTLINES_WRITE_ENABLED is exactly "true" (AE's flag defaults ON; this one
//     defaults OFF) — the shared Voltlines account is MSH dispatch's, so it is switched
//     on only once they agree. Nothing deletes.
//   * No cron and no page calls Voltlines by itself.
//   * Never use calculate-route as a health check: it shares AE's 30-a-minute and
//     daily route caps, and spending them here would stall AE's quotes.
//
// Things AE learned the hard way, kept here:
//   * Every request names its caller in User-Agent. Voltlines answers Node's default
//     ("node") with 403 "This client is not allowed", and rate-limits by that name, so
//     Woof uses its own name (not AE's) and it is overridable by env.
//   * A 429 "Throttled" says how long to wait (error.details.wait, seconds); waits up
//     to a minute are retried within a 90 s budget. "LimitExceeded" is a block that
//     waiting does not lift and is not retried.
//   * Times come back as UTC with an unreliable tz label: render in Asia/Dubai (+4).
//   * A passenger's user.first_name is the DOG and last_name the HOUSEHOLD.

const BASE = process.env.VOLTLINES_BASE_URL || "https://core.petzania.voltlines.com/api";
const DUBAI_OFFSET_MIN = 240;

export const VOLTLINES_USER_AGENT = process.env.VOLTLINES_USER_AGENT || "Woof-App/1.0 (transport)";

/** Writes stay off unless the env var is exactly "true" (step 2, with MSH sign-off). */
export function voltlinesWritesEnabled() {
  return process.env.VOLTLINES_WRITE_ENABLED === "true";
}

/** Whether a token is configured, without reading it out. */
export function voltlinesConfigured() {
  return !!process.env.VOLTLINES_TOKEN;
}

function voltlinesToken() {
  const t = process.env.VOLTLINES_TOKEN;
  if (!t) throw new Error("Missing VOLTLINES_TOKEN");
  return t;
}

function voltlinesHeaders() {
  return {
    Authorization: `Token ${voltlinesToken()}`,
    "User-Agent": VOLTLINES_USER_AGENT,
    Accept: "application/json",
  };
}

const THROTTLE_BUDGET_MS = 90000;
const THROTTLE_MAX_WAIT_MS = 60000;

/** Milliseconds Voltlines asks us to wait, or null when it is not a throttle. */
export function throttleNamedWaitMs(status, body) {
  if (status !== 429 || body?.error?.type !== "Throttled") return null;
  const seconds = Number(body.error.details?.wait);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
}

/** How long to sleep before retrying a throttle, or null when we should not. */
export function throttleWaitMs(status, body) {
  const ms = throttleNamedWaitMs(status, body);
  if (ms == null || ms > THROTTLE_MAX_WAIT_MS) return null;
  return ms + 100 + Math.floor(Math.random() * 400);
}

async function getOnce(path) {
  const res = await fetch(`${BASE}/${path.replace(/^\//, "")}`, { method: "GET", headers: voltlinesHeaders() });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = new Error(`Voltlines ${res.status} on ${path}`);
    err.status = res.status;
    err.body = parsed ?? text?.slice(0, 400);
    throw err;
  }
  return parsed;
}

/**
 * GET a Voltlines path, retrying short throttles. `retry: false` makes one attempt
 * only (the connection check reports a throttle rather than waiting it out).
 */
export async function voltlinesGet(path, { retry = true } = {}) {
  let waited = 0;
  for (;;) {
    try {
      return await getOnce(path);
    } catch (err) {
      const named = throttleNamedWaitMs(err.status, err.body);
      if (named != null) err.retryAt = new Date(Date.now() + named);
      const wait = retry ? throttleWaitMs(err.status, err.body) : null;
      if (wait == null || waited + wait > THROTTLE_BUDGET_MS) throw err;
      waited += wait;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/**
 * POST to Voltlines — the single write path. Refused unless writes are switched on.
 * Never retried: a create that half-happened must be looked at, not repeated.
 */
export async function voltlinesPost(path, body) {
  return voltlinesSend("POST", path, body);
}

/** PATCH — moving a passenger's or household's address (AE setHouseholdPin). Same switch. */
export async function voltlinesPatch(path, body) {
  return voltlinesSend("PATCH", path, body);
}

async function voltlinesSend(method, path, body) {
  if (!voltlinesWritesEnabled()) {
    const err = new Error("Voltlines writes are switched off for Woof (VOLTLINES_WRITE_ENABLED)");
    err.status = 503;
    err.code = "writes_disabled";
    throw err;
  }
  const res = await fetch(`${BASE}/${path.replace(/^\//, "")}`, {
    method,
    headers: { ...voltlinesHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = new Error(`Voltlines ${res.status} on ${method} ${path}`);
    err.status = res.status;
    err.body = parsed ?? text?.slice(0, 400);
    throw err;
  }
  return parsed;
}

/** Every page of a paginated list (results + next), read-only. */
export async function voltlinesPaginate(path, { maxPages = 50 } = {}) {
  const out = [];
  let next = path;
  for (let page = 0; next && page < maxPages; page += 1) {
    const res = await voltlinesGet(next);
    out.push(...(res?.results ?? []));
    next = res?.next ? String(res.next).replace(/^https?:\/\/[^/]+\/api\//, "") : null;
  }
  return out;
}

/**
 * The one safe "are we connected" call: the first passenger, nothing more. Returns a
 * plain verdict and never the token or any passenger data.
 */
export async function voltlinesConnectionCheck() {
  if (!voltlinesConfigured()) {
    return { ok: false, state: "not_configured", message: "No Voltlines token is set for Woof yet." };
  }
  try {
    const res = await voltlinesGet("v3/passenger/?page_size=1", { retry: false });
    return {
      ok: true,
      state: "connected",
      message: "Connected — Voltlines answered a read.",
      passengerCount: typeof res?.count === "number" ? res.count : null,
    };
  } catch (err) {
    const status = err.status ?? null;
    const message =
      status === 401
        ? "Voltlines refused the token (401) — it was rotated or is wrong."
        : status === 403
          ? "Voltlines refused this client (403) — usually the User-Agent name."
          : status === 429
            ? "Voltlines is rate-limiting this client name (429) — try later."
            : status
              ? `Voltlines answered ${status}.`
              : "Voltlines could not be reached.";
    return {
      ok: false,
      state: status === 401 ? "unauthorised" : status === 403 ? "forbidden" : status === 429 ? "rate_limited" : "error",
      status,
      message,
      retryAt: err.retryAt ? err.retryAt.toISOString() : null,
    };
  }
}

/** Local minutes past midnight in Dubai, from a Voltlines ZonedTimePayload. */
export function localMinutes(payload) {
  if (!payload?.time) return null;
  const h = Number(payload.time.slice(0, 2));
  const m = Number(payload.time.slice(3, 5));
  return (h * 60 + m + DUBAI_OFFSET_MIN) % 1440;
}

/** The address a planner would use: first unarchived one carrying a coordinate. */
export function plannablePassengerAddress(passenger) {
  const list = passenger?.addresses ?? [];
  const a =
    list.find((x) => !x.is_archived && x.coordinate?.latitude != null) ?? list.find((x) => !x.is_archived) ?? null;
  if (!a) return null;
  return {
    id: a.id ?? null,
    line: a.address_line || a.open_address || a.title || null,
    lat: a.coordinate?.latitude ?? null,
    lng: a.coordinate?.longitude ?? null,
  };
}

/** Voltlines names a passenger DOG (first_name) + HOUSEHOLD (last_name). */
export function passengerNames(passenger) {
  const user = passenger?.profile?.user ?? {};
  const full = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || null;
  if (user.first_name || user.last_name) {
    return { full, pet: user.first_name || null, owner: user.last_name || null };
  }
  const [pet, ...rest] = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  return { full, pet: pet ?? null, owner: rest.join(" ") || null };
}
