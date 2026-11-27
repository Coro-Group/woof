import { describe, expect, it } from "vitest";
import { aeKickAuthorized } from "../../api/_lib/transportHub.js";

// AE kicks a sync with the shared partner secret (27 Nov 2026).
describe("aeKickAuthorized", () => {
  const env = { AE_TRANSPORT_PARTNER_SECRET: "shared-secret" };
  it("takes exactly the shared secret", () => {
    expect(aeKickAuthorized("Bearer shared-secret", env)).toBe(true);
    expect(aeKickAuthorized("Bearer shared-secreT", env)).toBe(false);
    expect(aeKickAuthorized("Bearer shared", env)).toBe(false);
    expect(aeKickAuthorized("shared-secret", env)).toBe(false);
    expect(aeKickAuthorized(undefined, env)).toBe(false);
  });
  it("lets nobody in when no secret is set", () => {
    expect(aeKickAuthorized("Bearer ", {})).toBe(false);
    expect(aeKickAuthorized("Bearer anything", { AE_TRANSPORT_PARTNER_SECRET: "" })).toBe(false);
  });
});
