import type { Database } from "@/integrations/supabase/types";
import type { ServiceType } from "@/hooks/useBilling";
import {
  GROOMING_SERVICE_TO_SERVICE_CODE,
  groomingServiceToPricingKey,
} from "./addonPricing";

export type GroomingService = Database["public"]["Enums"]["grooming_service"];

/**
 * Single source of truth for grooming service options (matches `grooming_service` enum + labels).
 * Use this everywhere: Grooming page, Boarding add-ons, history tables, pricing resolution.
 */
export const GROOMING_SERVICE_OPTIONS: { value: GroomingService; label: string }[] = [
  { value: "full_groom", label: "Full Groom" },
  { value: "full_bath", label: "Full Bath" },
  { value: "splash", label: "Splash" },
  { value: "tidy", label: "Tidy" },
  { value: "nail_clip", label: "Nail Clip" },
  { value: "gland_expression", label: "Anal Gland Expression" },
  { value: "deshedding", label: "Deshedding" },
  { value: "brushing", label: "Brushing" },
  { value: "pawdicure", label: "Pawdicure" },
];

const LABEL_BY_SERVICE = Object.fromEntries(
  GROOMING_SERVICE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<GroomingService, string>;

export function labelForGroomingService(service: string): string {
  return LABEL_BY_SERVICE[service as GroomingService] ?? service.replace(/_/g, " ");
}

/** All service codes used for base grooming services (not transport extras). */
const GROOMING_PRICING_KEY_SET: ReadonlySet<string> = new Set<string>(
  Object.values(GROOMING_SERVICE_TO_SERVICE_CODE),
);

/**
 * True when this resolvable key is the same catalog as the Grooming page.
 */
export function isGroomingPricedAddonKey(key: string): boolean {
  if (!key) return false;
  if (GROOMING_PRICING_KEY_SET.has(key)) return true;
  return false;
}

/** Invoice line `service_type` for an add-on key used on a boarding stay. */
export function serviceTypeForBoardingAddonKey(key: string): ServiceType {
  if (isGroomingPricedAddonKey(key)) return "grooming";
  if (key.startsWith("transport_")) return "transport";
  return "adjustment";
}

/**
 * How to group rows from service-coded addon-like records in Billing → Pricing.
 * Grooming add-ons = anything that charges under the grooming line item catalog.
 * Transport = shuttles / boarding-stay transport lines.
 */
export function addonRateUiGroup(
  r: { addon_type: string; applicable_services: string[] },
): "grooming" | "transport" | "other" {
  const t = r.addon_type;
  const s = r.applicable_services ?? [];
  if (t.startsWith("transport_")) return "transport";
  if (t === "other") return "other";
  if (s.includes("grooming")) return "grooming";
  if (t.startsWith("grooming_")) return "grooming";
  if (s.includes("boarding")) return "transport";
  return "other";
}

/** Boarding “add groom on checkout” — same services & pricing keys as the Grooming page for those services. */
export function boardCheckoutGroomingAddon(
  service: "full_groom" | "full_bath",
): { key: string; label: string } | null {
  const k = groomingServiceToPricingKey(service);
  if (!k) return null;
  return {
    key: k,
    label: `${labelForGroomingService(service)} on checkout`,
  };
}
