import { describe, expect, it } from "vitest";

import {
  clampHeavyDogFeeAed,
  clampMattingFeeAed,
  combineGroomingAppointmentQuote,
  GROOMING_FORM_ADDON_SERVICE_CODE,
  isGroomingPricingCheckbox,
  resolvePrimaryGroomingCheckbox,
  groomingPricingCheckboxToDbService,
} from "./groomingNewAppointmentPricing";

describe("groomingNewAppointmentPricing", () => {
  it("resolvePrimaryGroomingCheckbox respects base priority", () => {
    expect(resolvePrimaryGroomingCheckbox(["nail_clip", "full_groom"])).toBe("full_groom");
    expect(resolvePrimaryGroomingCheckbox(["bath_only", "deshedding"])).toBe("deshedding");
  });

  it("bath_only + blow_dry combo uses bath_only as primary", () => {
    expect(resolvePrimaryGroomingCheckbox(["bath_only", "blow_dry"])).toBe("bath_only");
  });

  it("addon-only selection uses first selected checkbox as primary", () => {
    expect(resolvePrimaryGroomingCheckbox(["nail_clip"])).toBe("nail_clip");
    expect(resolvePrimaryGroomingCheckbox(["teeth_brushing", "nail_clip"])).toBe("teeth_brushing");
    expect(resolvePrimaryGroomingCheckbox(["malaseb_bath"])).toBe("malaseb_bath");
  });

  it("isGroomingPricingCheckbox guards unknown values", () => {
    expect(isGroomingPricingCheckbox("full_groom")).toBe(true);
    expect(isGroomingPricingCheckbox("not_a_service")).toBe(false);
  });

  it("groomingPricingCheckboxToDbService maps nail_clip to nail_clip service", () => {
    expect(groomingPricingCheckboxToDbService("nail_clip")).toBe("nail_clip");
    expect(groomingPricingCheckboxToDbService("tidy")).toBe("tidy");
    expect(groomingPricingCheckboxToDbService("gland_expression")).toBe("gland_expression");
    expect(groomingPricingCheckboxToDbService("splash")).toBe("splash");
  });

  it("resolvePrimaryGroomingCheckbox includes tidy and splash in base priority", () => {
    expect(resolvePrimaryGroomingCheckbox(["nail_clip", "tidy"])).toBe("tidy");
    expect(resolvePrimaryGroomingCheckbox(["nail_clip", "splash"])).toBe("splash");
  });

  it("clampMattingFeeAed respects bounds", () => {
    expect(clampMattingFeeAed(50, { mattingMin: 10, mattingMax: 40 })).toBe(40);
    expect(clampMattingFeeAed(5, { mattingMin: 10, mattingMax: 40 })).toBe(10);
  });

  it("prices a standalone gland visit from the resolved service rate", () => {
    expect(GROOMING_FORM_ADDON_SERVICE_CODE.gland_standalone).toBe("grooming_gland_expression");
    expect(combineGroomingAppointmentQuote(0, [10])).toEqual({
      base: 0,
      addons: 10,
      total: 10,
    });
  });

  it("uses the glands add-on code beside a package and leaves an unrated add-on out", () => {
    expect(GROOMING_FORM_ADDON_SERVICE_CODE.gland_with_package).toBe("addon_glands");
    expect(GROOMING_FORM_ADDON_SERVICE_CODE.ear_cleaning).toBe("addon_ear_cleaning");
    expect(GROOMING_FORM_ADDON_SERVICE_CODE.paw_wash).toBe("addon_paw_wash");
    expect(GROOMING_FORM_ADDON_SERVICE_CODE.paw_brushing).toBe("addon_paw_brushing");
    expect(combineGroomingAppointmentQuote(100, [7, null])).toEqual({
      base: 100,
      addons: 7,
      total: 107,
    });
  });

  it("asks for a manual price when the only selected add-on has no rate", () => {
    expect(combineGroomingAppointmentQuote(0, [null])).toBeNull();
  });

  it("clampHeavyDogFeeAed respects bounds", () => {
    expect(clampHeavyDogFeeAed(100, { heavyMin: 20, heavyMax: 80 })).toBe(80);
  });
});
