import { format, isValid, parseISO } from "date-fns";

export function toSafeDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : parseISO(value.length === 10 ? `${value}T00:00:00` : value);
  return isValid(date) ? date : null;
}

export function safeFormatDate(value: string | Date | null | undefined, pattern: string): string {
  const date = toSafeDate(value);
  return date ? format(date, pattern) : "";
}
