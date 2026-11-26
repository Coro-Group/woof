import { describe, it, expect } from "vitest";
import {
  clampVisitRequestAlertDurationSec,
  clampVisitRequestAlertVolume,
  isTodoVisitRequest,
  isVisitRequestWaitingTooLong,
  newestNewVisitRequest,
  parseVisitRequestAlertPrefs,
  parseVisitRequestSoundStyle,
  pickVisitRequestVoice,
  todoVisitRequests,
  VISIT_REQUEST_CHIME_GAIN,
  VISIT_REQUEST_VOICE_URL,
  visitRequestAlarmBanner,
  visitRequestNewToast,
  visitRequestNotice,
  visitRequestTabTitle,
  visitRequestWaitingLabel,
  visitRequestWaitingMinutes,
} from "@/lib/visitRequestAlerts";

describe("todo visit requests", () => {
  it("counts only To do (status new)", () => {
    expect(isTodoVisitRequest("new")).toBe(true);
    expect(isTodoVisitRequest("contacted")).toBe(false);
    expect(
      todoVisitRequests([
        { id: "1", status: "new" },
        { id: "2", status: "contacted" },
        { id: "3", status: "new" },
      ]).map((r) => r.id),
    ).toEqual(["1", "3"]);
  });
});

describe("tab title", () => {
  it("prefixes the brand with the open count and drops the prefix at 0", () => {
    expect(visitRequestTabTitle(2)).toBe("(2) Woof");
    expect(visitRequestTabTitle(0)).toBe("Woof");
  });
});

describe("waiting too long", () => {
  const created = "2026-11-26T10:00:00.000Z";
  const t0 = Date.parse(created);

  it("labels elapsed minutes and turns red from 30 minutes", () => {
    expect(visitRequestWaitingMinutes(created, t0 + 29 * 60_000)).toBe(29);
    expect(isVisitRequestWaitingTooLong(created, t0 + 29 * 60_000)).toBe(false);
    expect(isVisitRequestWaitingTooLong(created, t0 + 30 * 60_000)).toBe(true);
    expect(visitRequestWaitingLabel(45)).toBe("Waiting 45 min");
  });
});

describe("notice line and toast", () => {
  it("shows client, pet, service and the new-request toast", () => {
    expect(
      visitRequestNotice({
        id: "r1",
        contact_name: "Sara Khan",
        pet_name: "Luna",
        interest: "daycare",
        created_at: "2026-11-26T10:00:00.000Z",
      }),
    ).toEqual({
      id: "r1",
      kind: "visit",
      contactName: "Sara Khan",
      pet: "Luna",
      service: "Daycare",
      requestedAt: "2026-11-26T10:00:00.000Z",
    });
    expect(visitRequestNewToast("Sara Khan")).toBe("New request from Sara Khan");
  });
});

describe("alarm banner and newest request", () => {
  const sara = {
    id: "r1",
    contact_name: "Sara Khan",
    pet_name: "Luna",
    interest: "daycare" as const,
    created_at: "2026-11-26T10:00:00.000Z",
    status: "new",
  };

  it("formats the ringing banner", () => {
    expect(visitRequestAlarmBanner(sara)).toBe(
      "🔔 New request from Sara Khan — Luna, Daycare",
    );
  });

  it("rings only the newest unseen To do request", () => {
    const older = { ...sara, id: "r0", contact_name: "Ali", created_at: "2026-11-26T09:59:00.000Z" };
    const seen = new Set<string>(["old"]);
    expect(newestNewVisitRequest([older, sara], seen)?.id).toBe("r1");
    expect(newestNewVisitRequest([{ ...sara, status: "contacted" }], new Set())).toBeNull();
    expect(newestNewVisitRequest([sara], new Set(["r1"]))).toBeNull();
  });
});

describe("alert prefs", () => {
  it("clamps volume and duration and fills defaults", () => {
    expect(clampVisitRequestAlertVolume(0.3)).toBe(0.3);
    expect(clampVisitRequestAlertVolume(2)).toBe(1);
    expect(clampVisitRequestAlertDurationSec(5)).toBe(10);
    expect(parseVisitRequestAlertPrefs({ style: "chime" }).style).toBe("chime");
    expect(parseVisitRequestSoundStyle("other")).toBe("chime_voice");
  });

  it("prefers a calm English female voice", () => {
    expect(
      pickVisitRequestVoice([
        { name: "Google UK English Male", lang: "en-GB" },
        { name: "Samantha", lang: "en-US" },
      ])?.name,
    ).toBe("Samantha");
  });

  it("ships a recorded voice clip and uses an audible chime gain", () => {
    expect(VISIT_REQUEST_VOICE_URL).toBe("/sounds/new-booking-request.m4a");
    expect(VISIT_REQUEST_CHIME_GAIN).toBe(0.72);
  });
});
