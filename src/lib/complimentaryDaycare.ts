/** Granted with a grooming package sale. Not a paid daycare package. */
export const COMPLIMENTARY_DAYCARE_SOURCE = "complimentary_daycare";

/** Invoice line note when staff choose to use one complimentary day. */
export const COMPLIMENTARY_DAYCARE_NOTE = "Complimentary (SSPL package)";

/** Billing-path value prefix so a complimentary credit is not treated as a daycare package id. */
export const COMPLIMENTARY_DAYCARE_CHOICE_PREFIX = "comp:";

/** Sales on or after this date receive the package type's complimentary days. */
export const COMPLIMENTARY_DAYCARE_FROM = "2026-11-24";

export function complimentaryDaycareSummary(total: number, used: number): string {
  const safeTotal = Math.max(0, total);
  const safeUsed = Math.max(0, Math.min(used, safeTotal));
  const remaining = safeTotal - safeUsed;
  const dayWord = safeTotal === 1 ? "day" : "days";
  return `Complimentary daycare: ${safeTotal} ${dayWord} · used ${safeUsed} · remaining ${remaining}`;
}

export function complimentaryDaycareChoiceValue(creditId: string): string {
  return `${COMPLIMENTARY_DAYCARE_CHOICE_PREFIX}${creditId}`;
}

export function complimentaryCreditIdFromChoice(choice: string): string | null {
  if (!choice.startsWith(COMPLIMENTARY_DAYCARE_CHOICE_PREFIX)) return null;
  const id = choice.slice(COMPLIMENTARY_DAYCARE_CHOICE_PREFIX.length);
  return id || null;
}

export function complimentaryDaycareLine(petName: string): {
  description: string;
  quantity: number;
  unitPrice: number;
  serviceType: string;
  preserveUnitPrice: true;
} {
  return {
    description: `Daycare — ${petName} — ${COMPLIMENTARY_DAYCARE_NOTE}`,
    quantity: 1,
    unitPrice: 0,
    serviceType: "daycare",
    preserveUnitPrice: true,
  };
}
