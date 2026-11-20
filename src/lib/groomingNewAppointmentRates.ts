import type { Database } from "@/integrations/supabase/types";
import { resolveAddonPricesForKeys } from "@/lib/addonPricing";
import type { DogSizeFormValue } from "@/lib/dogSizeForm";
import {
  type DeshedCoatTier,
  type GroomingPackage,
  deshedCoatTypeFromPetCoat,
  dogSizeFormToPackageSize,
  resolveGroomingPackageRateAmount,
  resolveWoofServiceRateAmount,
  splashCoatTypeFromPetCoat,
} from "@/lib/groomingPackageRateLookup";
import type {
  GroomingPricingCheckbox,
  ManualGroomingAddonAed,
} from "@/lib/groomingNewAppointmentPricing";
import {
  combineGroomingAppointmentQuote,
  GROOMING_FORM_ADDON_SERVICE_CODE,
  isGroomingPricingCheckbox,
  resolvePrimaryGroomingCheckbox,
} from "@/lib/groomingNewAppointmentPricing";

export type GroomingManualFeeBounds = {
  mattingMin: number;
  mattingMax: number;
  heavyMin: number;
  heavyMax: number;
};

type PetCoatType = Database["public"]["Enums"]["coat_type"];

/** Boarding checkout keys resolved via `resolveAddonPricesForKeys` / service_rates. */
const WOOF_ADDON_LEGACY_KEYS: Partial<Record<GroomingPricingCheckbox, string>> = {
  nail_clip: "boarding_addon_nail_clipping",
  teeth_brushing: "boarding_addon_teeth_brushing",
  malaseb_bath: "boarding_addon_malaseb_bath",
};

const WOOF_ADDON_SERVICE_CODES: Partial<
  Record<GroomingPricingCheckbox, Database["public"]["Enums"]["service_code"]>
> = {
  matting_fee: "addon_dematting",
  ear_cleaning: GROOMING_FORM_ADDON_SERVICE_CODE.ear_cleaning,
  paw_wash: GROOMING_FORM_ADDON_SERVICE_CODE.paw_wash,
  pawdicure: GROOMING_FORM_ADDON_SERVICE_CODE.paw_brushing,
};

const ZERO_AED_CHECKBOXES = new Set<GroomingPricingCheckbox>([
  "fur_brushing",
  "blow_dry",
]);

const PACKAGE_PRIMARY_CHECKBOXES = new Set<GroomingPricingCheckbox>([
  "full_groom",
  "deshedding",
  "tidy",
  "splash",
  "bath_only",
  "full_bath_full",
]);

function hasPackagePrimary(selected: Set<GroomingPricingCheckbox>): boolean {
  for (const key of PACKAGE_PRIMARY_CHECKBOXES) {
    if (selected.has(key)) return true;
  }
  return false;
}

function dogSizeFormToDbPetSize(
  dogSize: DogSizeFormValue,
): Database["public"]["Enums"]["pet_size"] {
  switch (dogSize) {
    case "Small":
      return "small";
    case "Medium":
      return "medium";
    case "Large":
    case "Extra Large":
      return "large";
  }
}

function primaryCheckboxToPackage(
  primary: GroomingPricingCheckbox,
  deshedCoat: DeshedCoatTier,
): GroomingPackage | null {
  switch (primary) {
    case "full_groom":
      return "grande";
    case "deshedding":
      return deshedCoat === "long" ? "deshedding_long" : "deshedding_smooth";
    case "bath_only":
    case "full_bath_full":
      return "bijoux";
    default:
      return null;
  }
}

function deseedTierFromPetCoat(petCoat: PetCoatType | null | undefined): DeshedCoatTier {
  return deshedCoatTypeFromPetCoat(petCoat) === "long" ? "long" : "smooth";
}

export async function fetchGroomingManualFeeBounds(): Promise<GroomingManualFeeBounds> {
  const dematting = (await resolveWoofServiceRateAmount({ service_code: "addon_dematting" })) ?? 0;
  const mattingMin = dematting > 0 ? dematting : 0;
  const mattingMax = mattingMin > 0 ? mattingMin * 2 : 0;
  return {
    mattingMin,
    mattingMax: mattingMax > mattingMin ? mattingMax : mattingMin,
    heavyMin: mattingMin > 0 ? Math.round(mattingMin * 0.75 * 100) / 100 : 0,
    heavyMax: mattingMax,
  };
}

export async function fetchCheckboxBasePriceAed(
  checkbox: GroomingPricingCheckbox,
  dogSize: DogSizeFormValue,
  petCoat?: PetCoatType | null,
  bookingDate?: string,
): Promise<number | null> {
  const packageSize = dogSizeFormToPackageSize(dogSize);
  const deshedCoat = deseedTierFromPetCoat(petCoat);

  if (checkbox === "tidy") {
    return resolveWoofServiceRateAmount({
      service_code: "grooming_tidy",
      pet_size: dogSizeFormToDbPetSize(dogSize),
      booking_date: bookingDate,
    });
  }

  if (checkbox === "gland_expression") {
    // Flat rate (no size/coat) — same resolve path as other addon-style services.
    return resolveWoofServiceRateAmount({
      service_code: "grooming_gland_expression",
      pet_size: null,
      coat_type: null,
      booking_date: bookingDate,
    });
  }

  if (checkbox === "deshedding") {
    return resolveWoofServiceRateAmount({
      service_code: "grooming_hair_no_more",
      coat_type: deshedCoatTypeFromPetCoat(petCoat),
      booking_date: bookingDate,
    });
  }

  if (checkbox === "splash") {
    return resolveWoofServiceRateAmount({
      service_code: "grooming_splash",
      pet_size: dogSizeFormToDbPetSize(dogSize),
      coat_type: splashCoatTypeFromPetCoat(petCoat),
      booking_date: bookingDate,
    });
  }

  const pkg = primaryCheckboxToPackage(checkbox, deshedCoat);
  if (!pkg) return null;
  return resolveGroomingPackageRateAmount(pkg, packageSize, bookingDate, petCoat);
}

/** Split of a grooming appointment price into the credit-coverable base vs. add-ons. */
export type GroomingPriceBreakdown = {
  /** Primary package rate — the portion a grooming package credit covers. */
  base: number;
  /** Add-ons (extra services, matting/heavy fees) — never covered by a credit. */
  addons: number;
  /** base + addons. */
  total: number;
};

export async function fetchNewGroomingAppointmentPriceBreakdown(
  selectedServices: readonly string[],
  dogSize: DogSizeFormValue | null,
  manualAddons?: ManualGroomingAddonAed | null,
  options?: { deseedCoat?: DeshedCoatTier; petCoat?: PetCoatType | null; bookingDate?: string },
): Promise<GroomingPriceBreakdown | null> {
  const selected = selectedServices.filter(isGroomingPricingCheckbox);
  if (selected.length === 0) return null;
  if (dogSize == null) return null;

  const set = new Set(selected);
  const bathAndBlow = set.has("bath_only") && set.has("blow_dry");
  const deshedCoat = options?.deseedCoat ?? deseedTierFromPetCoat(options?.petCoat);
  const packageSize = dogSizeFormToPackageSize(dogSize);

  let base: number | null = null;
  if (bathAndBlow) {
    base = await resolveGroomingPackageRateAmount(
      "bath_blow",
      packageSize,
      options?.bookingDate,
      options?.petCoat,
    );
  } else if (set.has("deshedding")) {
    base = await resolveWoofServiceRateAmount({
      service_code: "grooming_hair_no_more",
      coat_type: deshedCoatTypeFromPetCoat(options?.petCoat),
      booking_date: options?.bookingDate,
    });
  } else if (set.has("tidy")) {
    base = await resolveWoofServiceRateAmount({
      service_code: "grooming_tidy",
      pet_size: dogSizeFormToDbPetSize(dogSize),
      booking_date: options?.bookingDate,
    });
  } else if (set.has("splash")) {
    base = await resolveWoofServiceRateAmount({
      service_code: "grooming_splash",
      pet_size: dogSizeFormToDbPetSize(dogSize),
      coat_type: splashCoatTypeFromPetCoat(options?.petCoat),
      booking_date: options?.bookingDate,
    });
  } else {
    const primary = resolvePrimaryGroomingCheckbox(selected);
    const pkg = primary ? primaryCheckboxToPackage(primary, deshedCoat) : null;
    if (pkg) {
      base = await resolveGroomingPackageRateAmount(
        pkg,
        packageSize,
        options?.bookingDate,
        options?.petCoat,
      );
    } else {
      // Addon-only selection (nail clip, standalone glands, etc.): base 0, price from addons.
      base = 0;
    }
  }

  if (base == null) return null;

  const legacyKeys: string[] = [];
  const serviceCodes: Database["public"]["Enums"]["service_code"][] = [];
  const packagePrimary = bathAndBlow || hasPackagePrimary(set);

  for (const key of selected) {
    if (bathAndBlow && key === "blow_dry") continue;
    if (key === "matting_fee" || key === "heavy_dog_fee") continue;
    if (ZERO_AED_CHECKBOXES.has(key)) continue;
    // Standalone glands resolve grooming_gland_expression; beside a package, addon_glands.
    if (key === "gland_expression") {
      serviceCodes.push(
        packagePrimary
          ? GROOMING_FORM_ADDON_SERVICE_CODE.gland_with_package
          : GROOMING_FORM_ADDON_SERVICE_CODE.gland_standalone,
      );
      continue;
    }
    const legacy = WOOF_ADDON_LEGACY_KEYS[key];
    if (legacy) legacyKeys.push(legacy);
    const code = WOOF_ADDON_SERVICE_CODES[key];
    if (code) serviceCodes.push(code);
  }

  const [legacyPrices, serviceAmounts] = await Promise.all([
    resolveAddonPricesForKeys(legacyKeys),
    Promise.all(
      serviceCodes.map(async (code) => {
        try {
          return await resolveWoofServiceRateAmount({
            service_code: code,
            pet_size: null,
            coat_type: null,
            booking_date: options?.bookingDate,
          });
        } catch {
          return null;
        }
      }),
    ),
  ]);

  const addonAmounts: Array<number | null> = [...serviceAmounts];
  for (const key of legacyKeys) {
    const amount = legacyPrices.get(key);
    addonAmounts.push(typeof amount === "number" ? amount : null);
  }

  if (set.has("matting_fee")) {
    const raw = manualAddons?.matting_fee;
    if (typeof raw === "number" && Number.isFinite(raw)) addonAmounts.push(raw);
  }
  if (set.has("heavy_dog_fee")) {
    const raw = manualAddons?.heavy_dog_fee;
    if (typeof raw === "number" && Number.isFinite(raw)) addonAmounts.push(raw);
  }

  return combineGroomingAppointmentQuote(base, addonAmounts);
}

export async function fetchNewGroomingAppointmentOriginalAed(
  selectedServices: readonly string[],
  dogSize: DogSizeFormValue | null,
  manualAddons?: ManualGroomingAddonAed | null,
  options?: { deseedCoat?: DeshedCoatTier; petCoat?: PetCoatType | null; bookingDate?: string },
): Promise<number | null> {
  const breakdown = await fetchNewGroomingAppointmentPriceBreakdown(
    selectedServices,
    dogSize,
    manualAddons,
    options,
  );
  return breakdown ? breakdown.total : null;
}
