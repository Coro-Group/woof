import { describe, it, expect } from "vitest";
import { allowedOrigin, normalizePhoneE164, parseVisitRequest } from "../../api/_lib/visitRequest.js";
import handler from "../../api/visit-request.js";
import { visitWhatsAppUrl } from "@/lib/visitRequestWhatsApp";

const good = { name: "Sara Khan", phone: "050 123 4567", petName: "Luna" };

describe("normalizePhoneE164", () => {
  it("turns UAE local numbers into +971 and keeps international ones", () => {
    expect(normalizePhoneE164("050 123 4567")).toBe("+971501234567");
    expect(normalizePhoneE164("501234567")).toBe("+971501234567");
    expect(normalizePhoneE164("00971501234567")).toBe("+971501234567");
    expect(normalizePhoneE164("971501234567")).toBe("+971501234567");
    expect(normalizePhoneE164("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhoneE164("")).toBe("");
  });
});

describe("parseVisitRequest", () => {
  it("cleans the fields and normalises the phone", () => {
    expect(parseVisitRequest(good)).toEqual({
      ok: true,
      value: { contactName: "Sara Khan", phone: "+971501234567", petName: "Luna", interest: null, notes: null, sourcePage: null },
    });
    expect(parseVisitRequest({ ...good, petName: undefined, dogName: "Rex" }).value.petName).toBe("Rex");
  });

  it("accepts Woof's five services and their aliases", () => {
    for (const s of ["daycare", "boarding", "training", "grooming", "transport"]) {
      expect(parseVisitRequest({ ...good, interest: s }).value.interest).toBe(s);
    }
    expect(parseVisitRequest({ ...good, interest: "Daycare" }).value.interest).toBe("daycare");
    expect(parseVisitRequest({ ...good, interest: "Pick-up" }).value.interest).toBe("transport");
    expect(parseVisitRequest({ ...good, interest: "yoga" }).ok).toBe(false);
  });

  it("rejects short names and bad phones", () => {
    expect(parseVisitRequest({ ...good, name: "S" }).ok).toBe(false);
    expect(parseVisitRequest({ ...good, phone: "123" }).ok).toBe(false);
    expect(parseVisitRequest(null).ok).toBe(false);
  });

  it("keeps the client's notes with their line breaks and caps the length", () => {
    expect(parseVisitRequest({ ...good, notes: "  Golden, 2 years.\n\n\n\nShy with big dogs  " }).value.notes).toBe("Golden, 2 years.\n\nShy with big dogs");
    expect(parseVisitRequest({ ...good, notes: "   " }).value.notes).toBeNull();
    expect(parseVisitRequest({ ...good, notes: "x".repeat(1001) }).ok).toBe(false);
  });

  it("flags a filled honeypot as spam", () => {
    expect(parseVisitRequest({ ...good, website: "http://spam" })).toEqual({ ok: true, spam: true });
  });
});

describe("allowedOrigin", () => {
  it("allows woofdubai.ae, coro.ae, their subdomains and localhost only", () => {
    expect(allowedOrigin("https://woofdubai.ae")).toBe("https://woofdubai.ae");
    expect(allowedOrigin("https://www.woofdubai.ae")).toBe("https://www.woofdubai.ae");
    expect(allowedOrigin("https://coro.ae")).toBe("https://coro.ae");
    expect(allowedOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(allowedOrigin("https://woofdubai.ae.evil.com")).toBeNull();
    expect(allowedOrigin("http://woofdubai.ae")).toBeNull();
    expect(allowedOrigin(undefined)).toBeNull();
  });
});

function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    status(c: number) { res.statusCode = c; return res; },
    setHeader(k: string, v: string) { res.headers[k] = v; return res; },
    end(b?: string) { res.body = b ?? ""; return res; },
  };
  return res;
}

function fakeService(count: number) {
  const inserted: unknown[] = [];
  const service = {
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        gte: () => Promise.resolve({ count, error: null }),
        insert: (row: unknown) => { inserted.push(row); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  };
  return { service, inserted };
}

describe("POST /api/visit-request", () => {
  it("answers CORS preflight for woofdubai.ae", async () => {
    const res = fakeRes();
    await handler({ method: "OPTIONS", headers: { origin: "https://woofdubai.ae" } }, res, {});
    expect(res.statusCode).toBe(204);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://woofdubai.ae");
  });

  it("refuses other methods", async () => {
    const res = fakeRes();
    await handler({ method: "GET", headers: {} }, res, {});
    expect(res.statusCode).toBe(405);
  });

  it("returns 400 for a bad submission", async () => {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, body: { name: "S", phone: "1" } }, res, fakeService(0));
    expect(res.statusCode).toBe(400);
  });

  it("slows down a number that already sent three requests this hour", async () => {
    const { service, inserted } = fakeService(3);
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, body: good }, res, { service });
    expect(res.statusCode).toBe(429);
    expect(inserted).toHaveLength(0);
  });

  it("saves the request", async () => {
    const { service, inserted } = fakeService(0);
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, body: JSON.stringify({ ...good, interest: "boarding", page: "/" }) }, res, { service });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(inserted).toEqual([{ contact_name: "Sara Khan", phone: "+971501234567", pet_name: "Luna", interest: "boarding", client_note: null, source: "website", source_page: "/" }]);
  });

  it("answers a filled honeypot with success without saving", async () => {
    const { service, inserted } = fakeService(0);
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, body: { ...good, website: "x" } }, res, { service });
    expect(res.statusCode).toBe(200);
    expect(inserted).toHaveLength(0);
  });
});

describe("visitWhatsAppUrl", () => {
  it("greets the client by first name and mentions the free assessment", () => {
    const url = visitWhatsAppUrl({ phone: "+971501234567", contact_name: "Sara Khan", pet_name: "Luna" });
    expect(url).toMatch(/^https:\/\/wa\.me\/971501234567\?text=/);
    expect(decodeURIComponent(url!.split("text=")[1])).toContain("Hi Sara");
    expect(decodeURIComponent(url!.split("text=")[1])).toContain("free assessment and daycare trial");
    expect(visitWhatsAppUrl({ phone: "", contact_name: "A", pet_name: null })).toBeNull();
  });
});
