import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { Database, Json } from "@/integrations/supabase/types";
import { groomingServiceToPricingKey } from "@/lib/addonPricing";
import { formatTimeRange } from "@/lib/groomingBoardUi";
import { DogSizeField } from "@/components/DogSizeField";
import { PetSpecialAlertsBanner } from "@/components/PetSpecialAlertsBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DogSizeFormValue } from "@/lib/dogSizeForm";
import { petSizeToDogSizeFormValue } from "@/lib/dogSizeForm";
import {
  vatAmountFromGrossInclusive,
  vatLineLabel,
} from "@/lib/vatConfig";
import {
  estimatedPickupFromStartAndDuration,
  GROOMING_SERVICE_CHECKBOX_OPTIONS,
  type GroomingServiceCheckbox,
} from "@/lib/groomingServiceForm";
import {
  draftFinalAed,
  draftManualAddonAed,
  draftOriginalAed,
  normalizedDiscountPct,
  type GroomingManualFeeBounds,
  type PetGroomingDraft,
} from "@/lib/groomingPetDraft";
import { GroomingGroomerSelect } from "@/components/grooming/GroomingGroomerSelect";
import { useGroomingGroomers } from "@/hooks/useGroomingGroomers";
import { fetchCheckboxBasePriceAed } from "@/lib/groomingNewAppointmentRates";
import {
  useNewGroomingAppointmentPrice,
  useNewGroomingAppointmentPriceBreakdown,
} from "@/hooks/useNewGroomingAppointmentPrice";
import type { GroomingStationRow } from "@/hooks/useGroomingStations";
import { supabase } from "@/integrations/supabase/client";
import {
  GROOMING_BASE_PACKAGE_CHECKBOXES,
  groomingPricingCheckboxToDbService,
  isGroomingPricingCheckbox,
  resolvePrimaryGroomingCheckbox,
} from "@/lib/groomingNewAppointmentPricing";
import { maxDurationMinutesForTimeInput } from "@/lib/groomingScheduleUtils";

type PetRecord = {
  id: string;
  name: string;
  breed?: string | null;
  weight_kg?: number | null;
  colour?: string | null;
  grooming_notes?: string | null;
  special_alerts?: unknown;
  coat_type?: Database["public"]["Enums"]["coat_type"] | null;
  size?: string | null;
};

type Props = {
  pet: PetRecord;
  draft: PetGroomingDraft;
  onChange: (patch: Partial<PetGroomingDraft>) => void;
  groomingStations: GroomingStationRow[];
  manualFeeBounds: GroomingManualFeeBounds | null | undefined;
  mattingDefault: string;
  heavyDefault: string;
  lastGroomDate?: string;
  showPreferredGroomerHint?: boolean;
  isComplimentary: boolean;
  enabled: boolean;
  showPetHeader?: boolean;
};

function formatLastGroomed(isoDate: string | undefined): string {
  if (!isoDate) return "Last groomed: No record found";
  try {
    return `Last groomed: ${format(new Date(isoDate), "d MMM yyyy")}`;
  } catch {
    return "Last groomed: No record found";
  }
}

export function GroomingPetDraftCard({
  pet,
  draft,
  onChange,
  groomingStations,
  manualFeeBounds,
  mattingDefault,
  heavyDefault,
  lastGroomDate,
  showPreferredGroomerHint,
  isComplimentary,
  enabled,
  showPetHeader = true,
}: Props) {
  const priceManualRef = useRef(false);
  const dogSizeManualRef = useRef(false);
  const { data: groomers = [] } = useGroomingGroomers();

  const primaryPricingCheckbox = useMemo(
    () =>
      resolvePrimaryGroomingCheckbox(
        draft.selectedServices.filter(isGroomingPricingCheckbox),
      ),
    [draft.selectedServices],
  );

  useEffect(() => {
    priceManualRef.current = false;
  }, [primaryPricingCheckbox, draft.dogSize, draft.useCredit, pet.coat_type]);

  useEffect(() => {
    if (!enabled || dogSizeManualRef.current) return;
    const fromPet = petSizeToDogSizeFormValue(pet.size);
    if (fromPet && !draft.dogSize) {
      onChange({ dogSize: fromPet });
    }
  }, [enabled, pet.size, draft.dogSize, onChange, pet.id]);

  useEffect(() => {
    const max = maxDurationMinutesForTimeInput(draft.apptTime);
    if (max > 0 && draft.durationMin > max) {
      onChange({ durationMin: max });
    }
  }, [draft.apptTime, draft.durationMin, onChange]);

  const manualAddons = useMemo(
    () => draftManualAddonAed(draft, manualFeeBounds),
    [draft, manualFeeBounds],
  );

  const selectedPrimaryServiceCode = useMemo(() => {
    const primaryCb = resolvePrimaryGroomingCheckbox(
      draft.selectedServices.filter(isGroomingPricingCheckbox),
    );
    const primaryService = primaryCb ? groomingPricingCheckboxToDbService(primaryCb) : null;
    return (primaryService ? groomingServiceToPricingKey(primaryService) : null) as
      | Database["public"]["Enums"]["service_code"]
      | null;
  }, [draft.selectedServices]);

  const { data: groomingCredit } = useQuery({
    queryKey: ["grooming_credits", pet.id, selectedPrimaryServiceCode],
    enabled: !!selectedPrimaryServiceCode && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_active_credits_for_pet", {
        p_pet_id: pet.id,
        p_service_code: selectedPrimaryServiceCode,
      });
      if (error) throw error;
      const first = (data ?? [])[0] as
        | { credit_id: string; package_name: string; units_remaining: number; expires_at: string }
        | undefined;
      return first ?? null;
    },
  });

  const { data: priceBreakdown, isFetching: priceFetching } =
    useNewGroomingAppointmentPriceBreakdown({
      selectedServices: draft.selectedServices,
      dogSize: draft.dogSize,
      manualAddons,
      petCoat: pet.coat_type,
      bookingDate: format(draft.appointmentDate, "yyyy-MM-dd"),
      enabled,
    });
  const computedOriginalAed = priceBreakdown?.total ?? null;
  const computedAddonsAed = priceBreakdown?.addons ?? null;
  const computedBaseAed = priceBreakdown?.base ?? null;

  /** Credit available, toggle on, and not a complimentary visit → base is waived. */
  const creditActive = !!groomingCredit && draft.useCredit && !isComplimentary;

  useEffect(() => {
    if (!enabled) return;
    if (isComplimentary) {
      if (draft.price !== "0") onChange({ price: "0" });
      return;
    }
    if (computedOriginalAed == null) {
      // Toggle drives the price when a credit is active; otherwise respect manual edits.
      if (!creditActive && priceManualRef.current) return;
      if (draft.price !== "") onChange({ price: "" });
      return;
    }
    // When a credit is active the base is covered, so only add-ons are charged.
    const target = creditActive ? (computedAddonsAed ?? 0) : computedOriginalAed;
    if (!creditActive && priceManualRef.current) return;
    const next = String(target);
    if (draft.price !== next) onChange({ price: next });
  }, [
    enabled,
    isComplimentary,
    creditActive,
    computedOriginalAed,
    computedAddonsAed,
    draft.price,
    onChange,
  ]);

  const { data: servicePriceHints = {} } = useQuery({
    queryKey: [
      "grooming-checkbox-prices",
      pet.id,
      draft.dogSize,
      pet.coat_type,
      format(draft.appointmentDate, "yyyy-MM-dd"),
    ],
    enabled: enabled && draft.dogSize != null,
    queryFn: async () => {
      const baseOptions = GROOMING_SERVICE_CHECKBOX_OPTIONS.filter((o) =>
        GROOMING_BASE_PACKAGE_CHECKBOXES.includes(o.value),
      );
      const entries = await Promise.all(
        baseOptions.map(async (option) => {
          const amount = await fetchCheckboxBasePriceAed(
            option.value,
            draft.dogSize!,
            pet.coat_type,
            format(draft.appointmentDate, "yyyy-MM-dd"),
          );
          return [option.value, amount] as const;
        }),
      );
      return Object.fromEntries(entries) as Partial<Record<GroomingServiceCheckbox, number | null>>;
    },
  });

  const estPickupTimeLabel = estimatedPickupFromStartAndDuration(
    draft.apptTime,
    draft.durationMin,
  );
  const originalAed = draftOriginalAed(draft.price);
  const finalAed = draftFinalAed(draft.price, draft.discountPct, isComplimentary);
  const saveAed =
    originalAed != null && normalizedDiscountPct(draft.discountPct) > 0 && finalAed != null
      ? Number((originalAed - finalAed).toFixed(2))
      : null;

  return (
    <div className="space-y-4">
      {showPetHeader ? (
        <div className="space-y-1 border-b pb-3">
          <p className="font-semibold">{pet.name}</p>
          <p className="text-xs text-muted-foreground">{formatLastGroomed(lastGroomDate)}</p>
        </div>
      ) : null}

      {groomingCredit ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-emerald-900">
              Available: {groomingCredit.units_remaining} credit(s), exp {groomingCredit.expires_at}
            </p>
            <label className="flex items-center gap-2 text-xs font-medium text-emerald-900">
              <Switch
                checked={draft.useCredit}
                onCheckedChange={(checked) => onChange({ useCredit: checked })}
              />
              Use credit
            </label>
          </div>
          {creditActive ? (
            <p className="text-xs text-emerald-900">
              {computedBaseAed != null
                ? `Base service AED ${computedBaseAed.toFixed(2)} covered by ${groomingCredit.package_name} — add-ons still charged.`
                : `Base service covered by ${groomingCredit.package_name} — add-ons still charged.`}
            </p>
          ) : null}
        </div>
      ) : null}

      <PetSpecialAlertsBanner specialAlerts={pet.special_alerts as Json} />
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Breed: </span>
          {pet.breed ?? "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Weight: </span>
          {pet.weight_kg != null ? `${pet.weight_kg} kg` : "—"}
        </p>
        <p className="col-span-2">
          <span className="text-muted-foreground">Coat / colour: </span>
          {pet.colour ?? "—"}
        </p>
        {pet.grooming_notes ? (
          <p className="col-span-2">
            <span className="text-muted-foreground">Grooming notes: </span>
            {pet.grooming_notes}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>Service</Label>
        <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
          {GROOMING_SERVICE_CHECKBOX_OPTIONS.map((o) => {
            const checked = draft.selectedServices.includes(o.value);
            const r =
              o.value === "matting_fee" &&
              manualFeeBounds &&
              manualFeeBounds.mattingMax > manualFeeBounds.mattingMin
                ? {
                    min: manualFeeBounds.mattingMin,
                    max: manualFeeBounds.mattingMax,
                    default: manualFeeBounds.mattingMin,
                  }
                : o.value === "heavy_dog_fee" &&
                    manualFeeBounds &&
                    manualFeeBounds.heavyMax > manualFeeBounds.heavyMin
                  ? {
                      min: manualFeeBounds.heavyMin,
                      max: manualFeeBounds.heavyMax,
                      default: manualFeeBounds.heavyMin,
                    }
                  : undefined;
            return (
              <label
                key={o.value}
                className={cn(
                  "flex gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60",
                  r ? "col-span-2 flex-col sm:flex-row sm:items-center" : "items-center",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const shouldCheck = e.target.checked;
                      const nextServices = shouldCheck
                        ? draft.selectedServices.includes(o.value)
                          ? draft.selectedServices
                          : [...draft.selectedServices, o.value]
                        : draft.selectedServices.filter((v) => v !== o.value);
                      const patch: Partial<PetGroomingDraft> = {
                        selectedServices: nextServices,
                      };
                      if (shouldCheck && r) {
                        if (o.value === "matting_fee") patch.mattingFeeAed = String(r.default);
                        if (o.value === "heavy_dog_fee") patch.heavyDogFeeAed = String(r.default);
                      }
                      onChange(patch);
                    }}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span>{o.label}</span>
                    {draft.dogSize && GROOMING_BASE_PACKAGE_CHECKBOXES.includes(o.value) ? (
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {servicePriceHints[o.value] == null
                          ? "Rate not configured"
                          : `from AED ${servicePriceHints[o.value]!.toFixed(2)}`}
                      </span>
                    ) : null}
                  </span>
                </span>
                {r && checked ? (
                  <div className="flex shrink-0 items-center gap-1.5 pl-6 sm:pl-0">
                    <span className="text-xs text-muted-foreground">AED</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={r.min}
                      max={r.max}
                      step={1}
                      className="h-8 w-[5.5rem] text-right text-sm"
                      value={o.value === "matting_fee" ? draft.mattingFeeAed : draft.heavyDogFeeAed}
                      onChange={(e) => {
                        if (o.value === "matting_fee") onChange({ mattingFeeAed: e.target.value });
                        else onChange({ heavyDogFeeAed: e.target.value });
                      }}
                    />
                  </div>
                ) : null}
              </label>
            );
          })}
        </div>
      </div>

      <DogSizeField
        name={`grooming-draft-dog-size-${pet.id}`}
        value={draft.dogSize}
        onChange={(value: DogSizeFormValue) => {
          dogSizeManualRef.current = true;
          onChange({ dogSize: value });
        }}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Grooming date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(draft.appointmentDate, "d MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={draft.appointmentDate}
                onSelect={(d) => d && onChange({ appointmentDate: d })}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-2">
          <Label>Time (optional — leave blank to float on backlog)</Label>
          <Input
            type="time"
            value={draft.apptTime}
            onChange={(e) => onChange({ apptTime: e.target.value })}
          />
          {draft.apptTime ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatTimeRange(draft.apptTime, draft.durationMin)}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label>Station (optional)</Label>
          <Select
            value={draft.stationId ?? "__none__"}
            onValueChange={(v) => onChange({ stationId: v === "__none__" ? null : v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select station" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Unassigned</SelectItem>
              {groomingStations.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Duration (minutes)</Label>
          <Input
            type="number"
            min={15}
            step={5}
            value={draft.durationMin}
            onChange={(e) => onChange({ durationMin: parseInt(e.target.value, 10) || 60 })}
          />
        </div>
        <div className="space-y-2">
          <Label>Est. pickup time</Label>
          <Input readOnly value={estPickupTimeLabel} className="bg-muted/40 font-medium tabular-nums" />
        </div>
        <div className="space-y-2">
          <Label>Price (AED)</Label>
          {draft.dogSize && !priceFetching && computedOriginalAed == null ? (
            <p className="text-xs text-amber-700">No matching rate — enter price manually.</p>
          ) : null}
          <Input
            type="number"
            min={0}
            step={1}
            value={draft.price}
            disabled={isComplimentary || creditActive}
            onChange={(e) => {
              priceManualRef.current = true;
              onChange({ price: e.target.value });
            }}
            placeholder="0"
          />
          {creditActive ? (
            <p className="text-xs text-muted-foreground">
              Base covered by credit — add-ons only. Turn off "Use credit" to charge the full price.
            </p>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "space-y-3 rounded-lg border p-3",
          isComplimentary && "pointer-events-none opacity-50",
        )}
      >
        <Label>Discount %</Label>
        <Input
          type="number"
          min={0}
          max={100}
          step={0.5}
          placeholder="Optional discount %"
          value={draft.discountPct}
          onChange={(e) => onChange({ discountPct: e.target.value })}
        />
        <div className="space-y-2">
          <Label>Final price (AED)</Label>
          <Input
            readOnly
            className="font-medium tabular-nums"
            value={finalAed != null ? finalAed.toFixed(2) : "—"}
          />
          {saveAed != null && saveAed > 0 ? (
            <p className="text-sm font-medium text-emerald-700">You save: {saveAed.toFixed(2)} AED</p>
          ) : null}
          {finalAed != null ? (
            <div className="space-y-1 pt-1 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{vatLineLabel()}</span>
                <span className="tabular-nums font-medium">
                  {vatAmountFromGrossInclusive(finalAed).toFixed(2)} AED
                </span>
              </div>
              <div className="flex justify-between gap-3 font-bold">
                <span>Total incl. VAT</span>
                <span className="tabular-nums">{Math.max(0, finalAed).toFixed(2)} AED</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <GroomingGroomerSelect
        groomers={groomers}
        value={draft.groomerName}
        onChange={(name) => onChange({ groomerName: name })}
        showPreferredHint={showPreferredGroomerHint}
      />

      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea
          value={draft.visitNotes}
          onChange={(e) => onChange({ visitNotes: e.target.value })}
          placeholder="Visit instructions…"
          rows={2}
        />
      </div>
    </div>
  );
}

/** Expose computed original for save validation (parent may batch-fetch; card owns live price). */
export function usePetDraftComputedPrice(args: {
  draft: PetGroomingDraft;
  petCoat?: Database["public"]["Enums"]["coat_type"] | null;
  manualFeeBounds: GroomingManualFeeBounds | null | undefined;
  enabled: boolean;
}) {
  const manualAddons = useMemo(
    () => draftManualAddonAed(args.draft, args.manualFeeBounds),
    [args.draft, args.manualFeeBounds],
  );
  return useNewGroomingAppointmentPrice({
    selectedServices: args.draft.selectedServices,
    dogSize: args.draft.dogSize,
    manualAddons,
    petCoat: args.petCoat,
    bookingDate: format(args.draft.appointmentDate, "yyyy-MM-dd"),
    enabled: args.enabled,
  });
}
