import { describe, expect, it } from "vitest";
import { legNote, legsForVisit, normaliseVisit, pendingLabel } from "@/lib/transportVetVisit";

const base = { appointmentDate: "2026-11-02", appointmentTimeMin: 630 };

describe("normaliseVisit (AE rules)", () => {
  it("fills defaults: 15 min early, back to the branch", () => {
    const v = normaliseVisit({ ...base, visitMode: "wait" });
    expect(v.arriveBufferMin).toBe(15);
    expect(v.returnTo).toBe("facility");
  });

  it("refuses what AE refuses", () => {
    const err = (input: object) => {
      try {
        normaliseVisit(input);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(err({ visitMode: "wait" })).toMatch(/appointment date/);
    expect(err({ ...base, visitMode: "wait", arriveBufferMin: 200 })).toMatch(/0 and 180/);
    expect(err({ ...base, visitMode: "wait", returnTo: "owner_collects" })).toMatch(/driver is not waiting/);
    expect(err({ ...base, visitMode: "return_later", returnDate: "2026-11-03" })).toMatch(/admitted/);
    expect(err({ ...base, visitMode: "admitted", returnDate: "2026-11-02" })).toMatch(/later day/);
    expect(err({ ...base, visitMode: "admitted", returnDate: "2026-11-01" })).toMatch(/before it goes/);
    expect(err({ ...base, appointmentTimeMin: 370, visitMode: "wait" })).toMatch(/before the vans start/);
    expect(err({ ...base, visitMode: "wait", returnTo: "home", homeWindowStartMin: 900 })).toMatch(/both ends/);
    expect(err({ ...base, visitMode: "wait", returnTo: "home", homeWindowStartMin: 900, homeWindowEndMin: 1000 })).toMatch(/wider than an hour/);
  });

  it("a waiting driver's visit clears return date and ready time", () => {
    const v = normaliseVisit({ ...base, visitMode: "wait", returnDate: "2026-11-02", readyTimeMin: 700 });
    expect(v.returnDate).toBeNull();
    expect(v.readyTimeMin).toBeNull();
  });
});

describe("legsForVisit", () => {
  it("driver waits: drop-off to the vet arriving by appointment − buffer, pickup back after the visit", () => {
    const { legs, pending } = legsForVisit(normaliseVisit({ ...base, visitMode: "wait", expectedDurationMin: 45 }));
    expect(pending).toBeNull();
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ role: "outbound", direction: "dropoff", deadline_min: 615, window_start_min: 555, window_end_min: 615 });
    expect(legs[1]).toMatchObject({ role: "return", direction: "pickup", service_date: "2026-11-02", window_start_min: 675, window_end_min: 735 });
  });

  it("return later with no ready time yet: only the way there, return owed", () => {
    const { legs, pending } = legsForVisit(normaliseVisit({ ...base, visitMode: "return_later" }));
    expect(legs.map((l) => l.role)).toEqual(["outbound"]);
    expect(pending).toBe("ready_time");
    expect(pendingLabel(pending)).toMatch(/vet to say/);
  });

  it("admitted without a discharge date: return date owed", () => {
    expect(legsForVisit(normaliseVisit({ ...base, visitMode: "admitted" })).pending).toBe("return_date");
  });

  it("straight home: pickup back, then a drop-off home once the window is known", () => {
    const owed = legsForVisit(normaliseVisit({ ...base, visitMode: "return_later", readyTimeMin: 840, returnTo: "home" }));
    expect(owed.legs.map((l) => l.role)).toEqual(["outbound", "return"]);
    expect(owed.pending).toBe("home_window");
    const full = legsForVisit(
      normaliseVisit({ ...base, visitMode: "return_later", readyTimeMin: 840, returnTo: "home", homeWindowStartMin: 1020, homeWindowEndMin: 1080 }),
    );
    expect(full.legs.map((l) => l.role)).toEqual(["outbound", "return", "home"]);
    expect(full.legs[2]).toMatchObject({ direction: "dropoff", atClinic: false, window_start_min: 1020 });
  });

  it("owner collects: only the way there", () => {
    const { legs, pending } = legsForVisit(normaliseVisit({ ...base, visitMode: "return_later", returnTo: "owner_collects" }));
    expect(legs.map((l) => l.role)).toEqual(["outbound"]);
    expect(pending).toBeNull();
  });

  it("writes AE's leg notes", () => {
    const meta = { vetLabel: "Blue Oasis Vet", appointmentTimeMin: 630, visitMode: "wait" as const, notes: "Vaccines" };
    expect(legNote(meta, { role: "outbound", deadline_min: 615, window_start_min: 555 })).toBe(
      "VET · Blue Oasis Vet · appointment 10:30 — arrive by 10:15 · driver waits · Vaccines",
    );
    expect(legNote(meta, { role: "return", deadline_min: null, window_start_min: 675 })).toBe(
      "VET RETURN · collect from Blue Oasis Vet from 11:15 · same driver, waiting",
    );
  });
});
