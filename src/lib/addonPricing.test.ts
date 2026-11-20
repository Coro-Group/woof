import { describe, expect, it } from "vitest";

import {
  GROOMING_SERVICE_TO_SERVICE_CODE,
  groomingServiceToPricingKey,
  legacyPricingKeyToServiceCode,
} from "./addonPricing";

describe("addonPricing legacy key bridge", () => {
  it("groomingServiceToPricingKey maps form services to service_code", () => {
    expect(groomingServiceToPricingKey("full_groom")).toBe("grooming_full_service");
    expect(groomingServiceToPricingKey("nail_clip")).toBe("addon_nails");
  });

  it("legacyPricingKeyToServiceCode maps grooming_grande tiers to full service", () => {
    expect(legacyPricingKeyToServiceCode("grooming_grande_s")).toBe("grooming_full_service");
    expect(legacyPricingKeyToServiceCode("grooming_grande_xl")).toBe("grooming_full_service");
  });

  it("legacyPricingKeyToServiceCode maps boarding add-on keys", () => {
    expect(legacyPricingKeyToServiceCode("boarding_addon_nail_clipping")).toBe("addon_nails");
    expect(legacyPricingKeyToServiceCode("boarding_addon_full_groom_checkout")).toBe(
      "grooming_full_service",
    );
  });

  it("GROOMING_SERVICE_TO_SERVICE_CODE covers primary grooming form services", () => {
    expect(GROOMING_SERVICE_TO_SERVICE_CODE.full_groom).toBe("grooming_full_service");
    expect(GROOMING_SERVICE_TO_SERVICE_CODE.deshedding).toBe("grooming_hair_no_more");
    expect(GROOMING_SERVICE_TO_SERVICE_CODE.tidy).toBe("grooming_tidy");
    expect(GROOMING_SERVICE_TO_SERVICE_CODE.splash).toBe("grooming_splash");
    expect(GROOMING_SERVICE_TO_SERVICE_CODE.gland_expression).toBe("grooming_gland_expression");
  });
});
