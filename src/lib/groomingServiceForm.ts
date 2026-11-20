import { addMinutes, format, parse } from "date-fns";
import type { GroomingService } from "@/lib/groomingCatalog";

export type GroomingServiceCheckbox =
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

export const DISCOUNT_QUICK_PCTS = [5, 10, 15, 20, 25, 30, 50, 100] as const;

export const GROOMING_SERVICE_CHECKBOX_OPTIONS: Array<{
  value: GroomingServiceCheckbox;
  label: string;
  mapsTo: GroomingService;
  manualPriceRange?: { min: number; max: number; default: number };
}> = [
  { value: "full_groom", label: "Full groom", mapsTo: "full_groom" },
  { value: "deshedding", label: "Deshedding", mapsTo: "deshedding" },
  { value: "tidy", label: "Tidy", mapsTo: "tidy" },
  { value: "splash", label: "Splash", mapsTo: "splash" },
  { value: "bath_only", label: "Bath only", mapsTo: "full_bath" },
  { value: "full_bath_full", label: "Full bath", mapsTo: "full_bath" },
  { value: "fur_brushing", label: "Fur brushing", mapsTo: "brushing" },
  { value: "teeth_brushing", label: "Teeth brushing", mapsTo: "brushing" },
  { value: "nail_clip", label: "Nail clip", mapsTo: "nail_clip" },
  { value: "gland_expression", label: "Anal Gland Expression", mapsTo: "gland_expression" },
  { value: "blow_dry", label: "Blow dry", mapsTo: "full_bath" },
  { value: "ear_cleaning", label: "Ear cleaning", mapsTo: "brushing" },
  { value: "pawdicure", label: "Pawdicure / paw brushing", mapsTo: "pawdicure" },
  { value: "paw_wash", label: "Paw wash", mapsTo: "pawdicure" },
  { value: "malaseb_bath", label: "Malaseb bath", mapsTo: "full_bath" },
  { value: "matting_fee", label: "Matting fee", mapsTo: "brushing" },
  { value: "heavy_dog_fee", label: "Heavy dog fee", mapsTo: "brushing" },
];

export function estimatedPickupFromStartAndDuration(
  timeValue: string,
  durationMinutes: number,
): string {
  if (!/^\d{2}:\d{2}$/.test(timeValue)) return "—";
  const safeMinutes =
    Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 0;
  try {
    const start = parse(`${timeValue}:00`, "HH:mm:ss", new Date(2000, 0, 1));
    return format(addMinutes(start, safeMinutes), "h:mm a");
  } catch {
    return "—";
  }
}

export function groomingTimeToDb(t: string): string {
  const parts = t.split(":");
  const h = parts[0] ?? "10";
  const m = parts[1] ?? "00";
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`;
}

/** Matches saved `Services:` tokens like `Matting fee (AED 80)` to a checkbox/filter label. */
export function serviceTokenMatchesSavedOption(savedToken: string, optionLabel: string): boolean {
  const t = savedToken.trim().toLowerCase();
  const l = optionLabel.toLowerCase();
  if (t === l) return true;
  if (t.startsWith(`${l} (`)) return true;
  if (t.startsWith(`${l} —`) || t.startsWith(`${l} -`)) return true;
  return false;
}
