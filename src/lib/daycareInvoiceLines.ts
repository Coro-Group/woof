import { format, parseISO } from "date-fns";

import {
  daycareGroupPricing,
  daycareHourlyInvoiceLineUnits,
  daycareHourlyLinearTotal,
  daycareHourlyHalfHourSlots,
  billableDaycareHourlyHours,
  type PriceByKey,
} from "@/lib/servicePricing";

export type DaycareInvoicePet = {
  id: string;
  name: string;
};

export type DaycareInvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  pricingKey?: string;
  serviceType?: string;
  preserveUnitPrice?: boolean;
};

function formatSessionDate(sessionDate: string): string {
  return format(parseISO(sessionDate), "d MMM yyyy");
}

function petNameFor(petId: string, pets: DaycareInvoicePet[]): string {
  return pets.find((pet) => pet.id === petId)?.name ?? "Pet";
}

/** Flat per-dog rate on the Live Rate Card. Gross, VAT-inclusive, same as other daycare prices. */
export const DAYCARE_TRAIN_PRICING_KEY = "daycare_and_train";
export const DAYCARE_TRAIN_LABEL = "Daycare & Train";
export const DAYCARE_TRAIN_DEFAULT_AED = 155;

export function buildDaycareTrainLineItems(args: {
  petIds: string[];
  pets: DaycareInvoicePet[];
  sessionDate: string;
  unitPrice: number;
}): DaycareInvoiceLineItem[] {
  const { petIds, pets, sessionDate, unitPrice } = args;
  if (petIds.length === 0 || unitPrice <= 0) return [];
  const dateLabel = formatSessionDate(sessionDate);
  return petIds.map((petId) => ({
    description: `${DAYCARE_TRAIN_LABEL} — ${petNameFor(petId, pets)} — ${dateLabel}`,
    quantity: 1,
    unitPrice,
    pricingKey: DAYCARE_TRAIN_PRICING_KEY,
    serviceType: "daycare",
    preserveUnitPrice: true,
  }));
}

export function buildDaycareSingleDayLineItems(args: {
  petIds: string[];
  pets: DaycareInvoicePet[];
  sessionDate: string;
  prices: PriceByKey;
}): DaycareInvoiceLineItem[] {
  const { petIds, pets, sessionDate, prices } = args;
  if (petIds.length === 0) return [];

  const group = daycareGroupPricing(petIds.length, prices);
  if (!group.pricingKey) return [];

  const unitPerPet = group.total / petIds.length;
  const dateLabel = formatSessionDate(sessionDate);

  return petIds.map((petId) => ({
    description: `${petNameFor(petId, pets)} — Daycare full day — ${dateLabel}`,
    quantity: 1,
    unitPrice: unitPerPet,
    pricingKey: group.pricingKey,
    serviceType: "daycare",
    preserveUnitPrice: true,
  }));
}

export function buildDaycareHourlyLineItems(args: {
  petIds: string[];
  pets: DaycareInvoicePet[];
  sessionDate: string;
  hours: number;
  prices: PriceByKey;
}): DaycareInvoiceLineItem[] {
  const { petIds, pets, sessionDate, hours, prices } = args;
  if (petIds.length === 0 || hours <= 0) return [];

  const hourly = daycareHourlyLinearTotal(petIds.length, hours, prices);
  if (hourly.total <= 0) return [];

  const dateLabel = formatSessionDate(sessionDate);
  const roundedHours = hourly.roundedHours;
  const hoursLabel = `${roundedHours} hr${roundedHours === 1 ? "" : "s"}`;
  const lineUnits = daycareHourlyInvoiceLineUnits(roundedHours, hourly.unitRate);

  return petIds.map((petId) => ({
    description: `${petNameFor(petId, pets)} — Daycare hourly — ${dateLabel} (${hoursLabel})`,
    quantity: lineUnits.quantity,
    unitPrice: lineUnits.unitPrice,
    pricingKey: hourly.pricingKey,
    serviceType: "daycare",
    preserveUnitPrice: true,
  }));
}

export function buildDaycareCreditLineItems(args: {
  petIds: string[];
  pets: DaycareInvoicePet[];
  sessionDate: string;
  consumedCreditByPet: Record<string, { package_name?: string | null; service_code?: string | null }>;
  hours: number;
}): DaycareInvoiceLineItem[] {
  const { petIds, pets, sessionDate, consumedCreditByPet, hours } = args;
  const dateLabel = formatSessionDate(sessionDate);

  return petIds.map((petId) => {
    const credit = consumedCreditByPet[petId];
    const packageName = credit?.package_name ?? "package credit";
    const isHourlyCredit = credit?.service_code === "daycare_hourly";
    const units = isHourlyCredit
      ? Math.max(1, daycareHourlyHalfHourSlots(billableDaycareHourlyHours(hours)))
      : 1;
    const serviceLabel = isHourlyCredit ? "Daycare hourly" : "Daycare full day";
    return {
      description: `${petNameFor(petId, pets)} — ${serviceLabel} — ${dateLabel} (covered by ${packageName})`,
      quantity: units,
      unitPrice: 0,
      serviceType: "daycare",
      preserveUnitPrice: true,
    };
  });
}
