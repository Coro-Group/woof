import { getSupabase } from "@/lib/supabaseRuntime";
import type { Database } from "@/integrations/supabase/types";

export const GROOMING_SERVICE_TO_SERVICE_CODE: Record<
  string,
  Database["public"]["Enums"]["service_code"]
> = {
  full_groom: "grooming_full_service",
  full_bath: "grooming_bath_brush_tidy",
  splash: "grooming_splash",
  tidy: "grooming_tidy",
  nail_clip: "addon_nails",
  gland_expression: "grooming_gland_expression",
  deshedding: "grooming_hair_no_more",
  pawdicure: "grooming_nail_ear_teeth",
  brushing: "grooming_bath_brush_tidy",
};

export const GROOMING_PRICING_FALLBACK_KEYS = [
  ...new Set(Object.values(GROOMING_SERVICE_TO_SERVICE_CODE)),
];

export function groomingServiceToPricingKey(service: string): string | undefined {
  return GROOMING_SERVICE_TO_SERVICE_CODE[service];
}

/** Maps invoice/boarding legacy pricing_key values to canonical service_code for RPC resolution. */
export function legacyPricingKeyToServiceCode(
  key: string,
): Database["public"]["Enums"]["service_code"] | undefined {
  return LEGACY_KEY_TO_SERVICE_CODE[key];
}

const LEGACY_KEY_TO_SERVICE_CODE: Record<
  string,
  Database["public"]["Enums"]["service_code"]
> = {
  boarding_addon_full_groom_checkout: "grooming_full_service",
  boarding_addon_full_bath: "grooming_bath_brush_tidy",
  boarding_addon_bath_only: "grooming_bath_brush_tidy",
  boarding_addon_nail_clipping: "addon_nails",
  boarding_addon_teeth_brushing: "addon_teeth_cleaning",
  boarding_addon_anal_gland_expression: "addon_glands",
  boarding_addon_de_shedding: "grooming_hair_no_more",
  boarding_addon_de_matting: "addon_dematting",
  boarding_addon_malaseb_bath: "addon_flea_tick_bath",
  boarding_addon_pawdicure: "grooming_nail_ear_teeth",
  boarding_addon_paw_wash: "grooming_bath_brush_tidy",
  boarding_addon_ear_cleaning: "grooming_nail_ear_teeth",
  boarding_addon_fur_brushing: "grooming_bath_brush_tidy",
  boarding_addon_blow_dry: "grooming_splash",
  grooming_grande_s: "grooming_full_service",
  grooming_grande_m: "grooming_full_service",
  grooming_grande_l: "grooming_full_service",
  grooming_grande_xl: "grooming_full_service",
  grooming_full_bath: "grooming_bath_brush_tidy",
  grooming_nail_clip: "addon_nails",
  grooming_deshed_smooth_s: "grooming_hair_no_more",
  grooming_deshed_smooth_m: "grooming_hair_no_more",
  grooming_deshed_smooth_l: "grooming_hair_no_more",
  addon_nails: "addon_nails",
  addon_glands: "addon_glands",
  grooming_gland_expression: "grooming_gland_expression",
  addon_dematting: "addon_dematting",
  addon_teeth_cleaning: "addon_teeth_cleaning",
  addon_flea_tick_bath: "addon_flea_tick_bath",
  addon_specialised_shampoo: "addon_specialised_shampoo",
  treadmill_daycare_addon: "treadmill_daycare_addon",
  treadmill_hourly_addon: "treadmill_hourly_addon",
};

const DROP_KEYS = new Set([
  "registration_member",
  "park_1_dog",
  "park_2_dogs",
  "park_3_dogs",
  "park_extra_dog",
  "park_slot",
  "park:slot",
  "daycare_hourly_family_per_dog",
  "daycare_hourly_3_dogs",
  "daycare_family_per_dog",
  "daycare_3_dogs",
  "boarding_addon_body_trimming",
  "grooming_pawdicure",
  "transport_dubai_shared",
  "transport_dubai",
  "transport_abudhabi",
  "transport_complimentary",
  "transport_free",
  "transport_dubai_private",
  "transport:pickup",
  "transport:dropoff",
]);

function petSizeFromLegacyKey(
  key: string,
): Database["public"]["Enums"]["pet_size"] | null {
  if (key.endsWith("_s")) return "small";
  if (key.endsWith("_m")) return "medium";
  if (key.endsWith("_l")) return "large";
  if (key.endsWith("_xl")) return "large";
  return null;
}

function coatTypeFromLegacyKey(
  key: string,
): Database["public"]["Enums"]["coat_type"] | null {
  if (key.includes("deshed_smooth")) return "short";
  return null;
}

async function resolveServiceRate(
  serviceCode: Database["public"]["Enums"]["service_code"],
  key?: string,
): Promise<number> {
  const { data, error } = await getSupabase().rpc("resolve_woof_service_rate", {
    p_service_code: serviceCode,
    p_pet_size: key ? petSizeFromLegacyKey(key) : null,
    p_coat_type: key ? coatTypeFromLegacyKey(key) : null,
  });
  if (error) throw error;
  const row = (data ?? [])[0];
  return typeof row?.amount_aed === "number" ? row.amount_aed : 0;
}

export async function resolveAddonPricesForKeys(keys: string[]): Promise<Map<string, number>> {
  const uniq = [...new Set(keys.filter(Boolean))];
  const out = new Map<string, number>();
  if (uniq.length === 0) return out;

  for (const k of uniq) {
    if (DROP_KEYS.has(k)) {
      out.set(k, 0);
      continue;
    }
    const serviceCode = LEGACY_KEY_TO_SERVICE_CODE[k];
    if (!serviceCode) {
      out.set(k, 0);
      continue;
    }
    out.set(k, await resolveServiceRate(serviceCode, k));
  }

  return out;
}

export async function getPricingAmountByKey(key: string): Promise<number | null> {
  if (!key || DROP_KEYS.has(key)) return 0;
  const serviceCode = LEGACY_KEY_TO_SERVICE_CODE[key];
  if (!serviceCode) return 0;
  return resolveServiceRate(serviceCode, key);
}
