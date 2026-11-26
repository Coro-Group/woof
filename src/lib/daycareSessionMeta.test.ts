import { describe, expect, it } from "vitest";

import {
  composeNotesWithBillingPath,
  composeNotesWithHourlyInvoiced,
  isDuplicateHourlyInvoiceLine,
  sessionNotesHaveHourlyInvoice,
  composeNotesWithHourlyDraft,
  isHourlyBillingInvoiced,
  isHourlyBillingDraft,
  parseHourlyDraftId,
  upgradeHourlyDraftToInvoiced,
  clearHourlyDraftFromNotes,
  parseDaycareBillingPath,
  visibleDaycareNotes,
  enrichDaycareSessionInvoiceMap,
  resolveDaycareSessionInvoiceId,
  isDaycareHourlyPending,
} from "./daycareSessionMeta";

describe("daycareSessionMeta", () => {
  it("parseDaycareBillingPath returns hourly from notes metadata", () => {
    expect(parseDaycareBillingPath("Dog size: Medium\nBILLING_PATH:hourly", null)).toBe("hourly");
  });

  it("parseDaycareBillingPath defaults to single without marker", () => {
    expect(parseDaycareBillingPath("Dog size: Medium", null)).toBe("single");
  });

  it("parseDaycareBillingPath keeps Daycare & Train separate from a full day", () => {
    expect(parseDaycareBillingPath("BILLING_PATH:train", null)).toBe("train");
  });

  it("parseDaycareBillingPath prefers package when package_id set", () => {
    expect(parseDaycareBillingPath("BILLING_PATH:hourly", "pkg-1")).toBe("package");
  });

  it("visibleDaycareNotes strips billing and invoiced metadata", () => {
    expect(
      visibleDaycareNotes("Dog size: Medium\nBILLING_PATH:hourly\nHOURLY_INVOICED:inv-1"),
    ).toBe("Dog size: Medium");
  });

  it("composeNotesWithHourlyInvoiced preserves billing path marker", () => {
    const notes = composeNotesWithHourlyInvoiced("Dog size: Medium\nBILLING_PATH:hourly", "inv-1");
    expect(notes).toContain("BILLING_PATH:hourly");
    expect(notes).toContain("HOURLY_INVOICED:inv-1");
    expect(isHourlyBillingInvoiced(notes)).toBe(true);
  });

  it("resolveDaycareSessionInvoiceId reads hourly family marker from notes", () => {
    const map = new Map<string, string>();
    expect(
      resolveDaycareSessionInvoiceId("sess-2", "BILLING_PATH:hourly\nHOURLY_INVOICED:inv-99", map),
    ).toBe("inv-99");
  });

  it("isDaycareHourlyPending is false once hourly marker is set", () => {
    const map = new Map<string, string>();
    expect(
      isDaycareHourlyPending(
        { sessionId: "s1", notes: "BILLING_PATH:hourly\nHOURLY_INVOICED:inv-1", packageId: null, checkedIn: true },
        map,
      ),
    ).toBe(false);
  });

  it("composeNotesWithBillingPath appends billing marker after visible notes", () => {
    expect(composeNotesWithBillingPath("Dog size: Large", "hourly")).toBe(
      "Dog size: Large\nBILLING_PATH:hourly",
    );
  });

  // ── HOURLY_DRAFT helpers ─────────────────────────────────────────────────

  it("isHourlyBillingDraft detects draft marker", () => {
    expect(isHourlyBillingDraft("BILLING_PATH:hourly\nHOURLY_DRAFT:inv-42")).toBe(true);
    expect(isHourlyBillingDraft("BILLING_PATH:hourly\nHOURLY_INVOICED:inv-42")).toBe(false);
    expect(isHourlyBillingDraft(null)).toBe(false);
  });

  it("parseHourlyDraftId extracts invoice id from draft marker", () => {
    expect(parseHourlyDraftId("BILLING_PATH:hourly\nHOURLY_DRAFT:inv-99")).toBe("inv-99");
    expect(parseHourlyDraftId("HOURLY_INVOICED:inv-99")).toBeNull();
    expect(parseHourlyDraftId(null)).toBeNull();
  });

  it("composeNotesWithHourlyDraft preserves billing path and visible notes", () => {
    const notes = composeNotesWithHourlyDraft("Dog size: Medium\nBILLING_PATH:hourly", "inv-1");
    expect(notes).toContain("BILLING_PATH:hourly");
    expect(notes).toContain("HOURLY_DRAFT:inv-1");
    expect(notes).toContain("Dog size: Medium");
    expect(notes).not.toContain("HOURLY_INVOICED");
  });

  it("composeNotesWithHourlyDraft strips old meta from visible notes", () => {
    const notes = composeNotesWithHourlyDraft(
      "Dog size: Large\nBILLING_PATH:hourly\nHOURLY_DRAFT:old-id",
      "new-id",
    );
    // Old draft marker should be gone; new one added
    expect(notes).not.toContain("HOURLY_DRAFT:old-id");
    expect(notes).toContain("HOURLY_DRAFT:new-id");
  });

  it("does not add a second hourly line once the session is invoiced or the line exists", () => {
    const notes = "BILLING_PATH:hourly\nHOURLY_INVOICED:inv-12487";
    expect(sessionNotesHaveHourlyInvoice(notes, "inv-12487")).toBe(true);
    expect(sessionNotesHaveHourlyInvoice(notes, "other-invoice")).toBe(false);

    const existing = [
      {
        description: "Daycare hourly — Mochi (5 hr)",
        quantity: 5,
        pricingKey: "daycare_hourly",
      },
    ];
    const again = {
      description: "Daycare hourly — Mochi (5 hr)",
      quantity: 5,
      pricingKey: "daycare_hourly",
    };
    expect(isDuplicateHourlyInvoiceLine(existing, again)).toBe(true);
    expect(
      isDuplicateHourlyInvoiceLine(existing, { ...again, quantity: 4 }),
    ).toBe(false);
    expect(isDuplicateHourlyInvoiceLine([], again)).toBe(false);
  });

  it("upgradeHourlyDraftToInvoiced replaces HOURLY_DRAFT with HOURLY_INVOICED", () => {
    const before = "Dog size: Medium\nBILLING_PATH:hourly\nHOURLY_DRAFT:inv-5";
    const after = upgradeHourlyDraftToInvoiced(before, "inv-5");
    expect(after).toContain("HOURLY_INVOICED:inv-5");
    expect(after).not.toContain("HOURLY_DRAFT:inv-5");
    expect(after).toContain("BILLING_PATH:hourly");
  });

  it("upgradeHourlyDraftToInvoiced appends HOURLY_INVOICED when no draft marker", () => {
    const after = upgradeHourlyDraftToInvoiced("BILLING_PATH:hourly", "inv-5");
    expect(after).toContain("HOURLY_INVOICED:inv-5");
  });

  it("clearHourlyDraftFromNotes removes the draft marker", () => {
    const notes = clearHourlyDraftFromNotes(
      "Dog size: Large\nBILLING_PATH:hourly\nHOURLY_DRAFT:inv-7",
      "inv-7",
    );
    expect(notes).not.toContain("HOURLY_DRAFT:inv-7");
    expect(notes).toContain("BILLING_PATH:hourly");
  });

  it("resolveDaycareSessionInvoiceId falls back to HOURLY_DRAFT marker", () => {
    const map = new Map<string, string>();
    expect(
      resolveDaycareSessionInvoiceId("sess-3", "BILLING_PATH:hourly\nHOURLY_DRAFT:draft-88", map),
    ).toBe("draft-88");
  });

  it("resolveDaycareSessionInvoiceId prefers HOURLY_INVOICED over HOURLY_DRAFT", () => {
    const map = new Map<string, string>();
    const notes =
      "BILLING_PATH:hourly\nHOURLY_INVOICED:final-1\nHOURLY_DRAFT:draft-1";
    expect(resolveDaycareSessionInvoiceId("sess-4", notes, map)).toBe("final-1");
  });

  it("isDaycareHourlyPending is true when only HOURLY_DRAFT is set (hours not yet entered)", () => {
    const map = new Map<string, string>();
    expect(
      isDaycareHourlyPending(
        {
          sessionId: "s2",
          notes: "BILLING_PATH:hourly\nHOURLY_DRAFT:draft-1",
          packageId: null,
          checkedIn: true,
        },
        map,
      ),
    ).toBe(true);
  });

  it("isDaycareHourlyPending is false once HOURLY_INVOICED is set (billing complete)", () => {
    const map = new Map<string, string>();
    expect(
      isDaycareHourlyPending(
        {
          sessionId: "s3",
          notes: "BILLING_PATH:hourly\nHOURLY_INVOICED:inv-final",
          packageId: null,
          checkedIn: true,
        },
        map,
      ),
    ).toBe(false);
  });

  it("visibleDaycareNotes strips HOURLY_DRAFT metadata", () => {
    expect(
      visibleDaycareNotes("Dog size: Medium\nBILLING_PATH:hourly\nHOURLY_DRAFT:inv-3"),
    ).toBe("Dog size: Medium");
  });

  it("enrichDaycareSessionInvoiceMap links same-day single-day siblings to primary invoice", () => {
    const primaryMap = new Map([["storm", "inv-1"]]);
    const sessions = [
      {
        id: "storm",
        owner_id: "owner-a",
        session_date: "2026-06-05",
        notes: "BILLING_PATH:single",
        package_id: null,
      },
      {
        id: "sky",
        owner_id: "owner-a",
        session_date: "2026-06-05",
        notes: "BILLING_PATH:single",
        package_id: null,
      },
      {
        id: "ocean",
        owner_id: "owner-a",
        session_date: "2026-06-05",
        notes: "BILLING_PATH:single",
        package_id: null,
      },
    ];
    const enriched = enrichDaycareSessionInvoiceMap(sessions, primaryMap);
    expect(enriched.get("storm")).toBe("inv-1");
    expect(enriched.get("sky")).toBe("inv-1");
    expect(enriched.get("ocean")).toBe("inv-1");
    expect(
      resolveDaycareSessionInvoiceId("sky", "BILLING_PATH:single", enriched),
    ).toBe("inv-1");
  });

  it("enrichDaycareSessionInvoiceMap does not link hourly siblings on same day", () => {
    const primaryMap = new Map([["storm", "inv-1"]]);
    const sessions = [
      {
        id: "storm",
        owner_id: "owner-a",
        session_date: "2026-06-05",
        notes: "BILLING_PATH:single",
        package_id: null,
      },
      {
        id: "hourly-dog",
        owner_id: "owner-a",
        session_date: "2026-06-05",
        notes: "BILLING_PATH:hourly",
        package_id: null,
      },
    ];
    const enriched = enrichDaycareSessionInvoiceMap(sessions, primaryMap);
    expect(enriched.get("hourly-dog")).toBeUndefined();
  });
});
