/**
 * Validation for website "Request a visit" submissions (api/visit-request.js).
 * Pure functions so they can be unit-tested without Supabase.
 */

export const INTERESTS = ["daycare", "boarding", "training", "grooming", "transport"];

const INTEREST_ALIASES = {
  daycare: "daycare",
  boarding: "boarding",
  training: "training",
  grooming: "grooming",
  transport: "transport",
  "pick-up": "transport",
  pickup: "transport",
};

/** Where a request was sent from: the brand's own page, or coro.ae's planner (/inquire). */
export const SOURCES = ["website", "coro.ae"];

function clean(v, max) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max + 1);
}

/** UAE-friendly E.164: "050 123 4567" → "+971501234567"; keeps other countries' "+…" numbers. */
export function normalizePhoneE164(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  const plus = s.startsWith("+");
  let d = s.replace(/\D/g, "");
  if (!d) return "";
  if (plus) return `+${d}`;
  if (d.startsWith("00")) return `+${d.slice(2)}`;
  if (d.startsWith("971")) return `+${d}`;
  if (d.startsWith("0") && d.length === 10) return `+971${d.slice(1)}`;
  if (d.startsWith("5") && d.length === 9) return `+971${d}`;
  return `+${d}`;
}

/**
 * @returns {{ ok: true, value: object } | { ok: false, error: string } | { ok: true, spam: true }}
 */
export function parseVisitRequest(body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  if (clean(b.website, 200)) return { ok: true, spam: true };

  const contactName = clean(b.name, 100);
  if (contactName.length < 2 || contactName.length > 100) return { ok: false, error: "Please enter your name." };

  const phone = normalizePhoneE164(b.phone);
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return { ok: false, error: "Please enter a valid WhatsApp number." };

  const petName = clean(b.petName ?? b.dogName, 100);
  if (petName.length > 100) return { ok: false, error: "Your dog's name is too long." };

  const rawInterest = clean(b.interest, 40).toLowerCase();
  const interest = rawInterest ? INTEREST_ALIASES[rawInterest] : null;
  if (rawInterest && !interest) return { ok: false, error: "Please choose a service from the list." };

  // Keep the client's line breaks; just tidy each line and cap the length.
  const notes = String(b.notes ?? "").split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (notes.length > 1000) return { ok: false, error: "Please keep your notes under 1,000 characters." };

  const sourcePage = clean(b.page, 300);

  // Where it was sent from: the brand's own page ("website") or coro.ae's planner.
  const rawSource = clean(b.source, 20).toLowerCase();
  const source = SOURCES.includes(rawSource) ? rawSource : "website";

  return {
    ok: true,
    value: {
      source,
      contactName,
      phone,
      petName: petName || null,
      interest,
      notes: notes || null,
      sourcePage: sourcePage && sourcePage.length <= 300 ? sourcePage : null,
    },
  };
}

/** CORS: woofdubai.ae and coro.ae (and their subdomains), plus localhost for development. */
export function allowedOrigin(origin) {
  const o = String(origin || "");
  if (/^https:\/\/([a-z0-9-]+\.)*woofdubai\.ae$/i.test(o)) return o;
  if (/^https:\/\/([a-z0-9-]+\.)*coro\.ae$/i.test(o)) return o;
  if (/^http:\/\/localhost:\d+$/.test(o)) return o;
  return null;
}
