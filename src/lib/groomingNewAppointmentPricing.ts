import type { GroomingService } from "@/lib/groomingCatalog";
import type { DogSizeFormValue } from "@/lib/dogSizeForm";
import type { GroomingManualFeeBounds } from "@/lib/groomingNewAppointmentRates";

/** Checkbox `value`s used on the New Appointment form (pricing + primary resolution). */
export type GroomingPricingCheckbox =
  | "full_groom"
  | "deshedding"
  | "tidy"
  | "splash"
  | "bath_only"
  | "full_bath_full"
  | "fur_brushing"
  | "teeth_brushing"
  | "nail_clip"
  | "gland_expression"
  | "blow_dry"
  | "ear_cleaning"
  | "pawdicure"
  | "paw_wash"
  | "malaseb_bath"
  | "matting_fee"
  | "heavy_dog_fee";

const ALL_PRICING_CHECKBOXES: readonly GroomingPricingCheckbox[] = [
  "full_groom",
  "deshedding",
  "tidy",
  "splash",
  "bath_only",
  "full_bath_full",
  "fur_brushing",
  "teeth_brushing",
  "nail_clip",
  "gland_expression",
  "blow_dry",
  "ear_cleaning",
  "pawdicure",
  "paw_wash",
  "malaseb_bath",
  "matting_fee",
  "heavy_dog_fee",
] as const;

export type ManualGroomingAddonAed = {
  matting_fee?: number;
  heavy_dog_fee?: number;
};

export function clampMattingFeeAed(
  n: number,
  bounds?: Pick<GroomingManualFeeBounds, "mattingMin" | "mattingMax">,
): number {
  const min = bounds?.mattingMin ?? 0;
  const max = bounds?.mattingMax ?? min;
  if (max <= min) return Math.max(0, n);
  return Math.min(max, Math.max(min, n));
}

export function clampHeavyDogFeeAed(
  n: number,
  bounds?: Pick<GroomingManualFeeBounds, "heavyMin" | "heavyMax">,
): number {
  const min = bounds?.heavyMin ?? 0;
  const max = bounds?.heavyMax ?? min;
  if (max <= min) return Math.max(0, n);
  return Math.min(max, Math.max(min, n));
}

export function isGroomingPricingCheckbox(v: string): v is GroomingPricingCheckbox {
  return (ALL_PRICING_CHECKBOXES as readonly string[]).includes(v);
}

const BASE_PRIORITY: GroomingPricingCheckbox[] = [
  "full_groom",
  "deshedding",
  "tidy",
  "splash",
  "bath_only",
  "full_bath_full",
];

/**
 * Grooming-form add-ons that resolve through service_rates.
 * Standalone anal glands use grooming_gland_expression; ticked beside a package
 * they use addon_glands. Ear cleaning, paw wash, and paw brushing have their
 * own codes and stay unpriced until a service_rates row exists.
 */
export const GROOMING_FORM_ADDON_SERVICE_CODE = {
  ear_cleaning: "addon_ear_cleaning",
  paw_wash: "addon_paw_wash",
  paw_brushing: "addon_paw_brushing",
  gland_standalone: "grooming_gland_expression",
  gland_with_package: "addon_glands",
} as const;

/**
 * Build the appointment price from a resolved base and add-on lookups.
 * A null add-on amount means service_rates has no row — it is not treated as
 * AED 0. When the visit is only those unresolved add-ons, the quote is null
 * so the form asks for a manual price.
 */
export function combineGroomingAppointmentQuote(
  base: number | null,
  addonAmounts: ReadonlyArray<number | null>,
): { base: number; addons: number; total: number } | null {
  if (base == null) return null;
  const resolved = addonAmounts.filter((amount): amount is number => typeof amount === "number");
  if (base === 0 && addonAmounts.length > 0 && resolved.length === 0) return null;
  const addons = resolved.reduce((sum, amount) => sum + amount, 0);
  const roundedBase = Number(base.toFixed(3));
  const roundedAddons = Number(addons.toFixed(3));
  return {
    base: roundedBase,
    addons: roundedAddons,
    total: Number((roundedBase + roundedAddons).toFixed(3)),
  };
}

/** Primary package checkboxes that show live rate hints on the new-appointment form. */
export const GROOMING_BASE_PACKAGE_CHECKBOXES: readonly GroomingPricingCheckbox[] = [
  "full_groom",
  "deshedding",
  "tidy",
  "splash",
  "bath_only",
  "full_bath_full",
] as const;

/**
 * Primary package checkbox for DB `service` + base price tier.
 * Bath + Blow Dry combo: both `bath_only` and `blow_dry` → treat as fixed-rate package (primary `bath_only`).
 * When only add-ons are selected (e.g. nail clip), the first selected checkbox becomes primary.
 */
export function resolvePrimaryGroomingCheckbox(
  selected: readonly GroomingPricingCheckbox[],
): GroomingPricingCheckbox | null {
  if (selected.length === 0) return null;
  const set = new Set(selected);
  if (set.has("bath_only") && set.has("blow_dry")) {
    return "bath_only";
  }
  for (const p of BASE_PRIORITY) {
    if (set.has(p)) return p;
  }
  return selected[0];
}

export function groomingPricingCheckboxToDbService(cb: GroomingPricingCheckbox): GroomingService {
  switch (cb) {
    case "full_groom":
      return "full_groom";
    case "deshedding":
      return "deshedding";
    case "tidy":
      return "tidy";
    case "splash":
      return "splash";
    case "bath_only":
    case "full_bath_full":
    case "blow_dry":
    case "malaseb_bath":
      return "full_bath";
    case "fur_brushing":
    case "teeth_brushing":
    case "ear_cleaning":
      return "brushing";
    case "nail_clip":
      return "nail_clip";
    case "gland_expression":
      return "gland_expression";
    case "pawdicure":
    case "paw_wash":
      return "pawdicure";
    case "matting_fee":
    case "heavy_dog_fee":
      return "brushing";
    default:
      return "full_groom";
  }
}

/** @deprecated Use `fetchNewGroomingAppointmentOriginalAed` (loads live rates). */
export function computeNewGroomingAppointmentOriginalAed(
  _selectedServices: readonly string[],
  _dogSize: DogSizeFormValue | null,
  _manualAddons?: ManualGroomingAddonAed | null,
): number | null {
  return null;
}
