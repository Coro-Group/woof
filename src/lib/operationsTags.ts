import { differenceInCalendarDays, isWithinInterval, parseISO } from "date-fns";

export type TagTone = "default" | "success" | "warning" | "danger" | "muted";

export interface OperationTag {
  key: string;
  label: string;
  tone: TagTone;
}

export function tagToneClass(tone: TagTone): string {
  switch (tone) {
    case "success":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "warning":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "danger":
      return "bg-red-50 text-red-700 border-red-200";
    case "muted":
      return "bg-slate-100 text-slate-700 border-slate-200";
    default:
      return "bg-blue-50 text-blue-700 border-blue-200";
  }
}

export function buildBoardingTags(input: {
  status: string;
  checkInDate: string;
  checkOutDate: string;
  todayDate: string;
}): OperationTag[] {
  const tags: OperationTag[] = [];
  const today = parseISO(input.todayDate);
  const checkIn = parseISO(input.checkInDate);
  const checkOut = parseISO(input.checkOutDate);
  const daysToCheckIn = differenceInCalendarDays(checkIn, today);
  const daysToCheckOut = differenceInCalendarDays(checkOut, today);

  if (
    input.status === "checked_in" &&
    isWithinInterval(today, { start: checkIn, end: checkOut })
  ) {
    tags.push({ key: "active_boarding", label: "Active boarding", tone: "success" });
  }

  if (input.checkInDate === input.todayDate) {
    tags.push({ key: "checking_in_today", label: "Check-in today", tone: "default" });
  } else if (daysToCheckIn > 0) {
    tags.push({
      key: "check_in_in_x_days",
      label: `Check-in in ${daysToCheckIn} day${daysToCheckIn !== 1 ? "s" : ""}`,
      tone: "muted",
    });
  }

  if (input.checkOutDate === input.todayDate || (daysToCheckOut > 0 && daysToCheckOut <= 2)) {
    tags.push({
      key: "checking_out_window",
      label:
        input.checkOutDate === input.todayDate
          ? "Check-out today"
          : `Check-out in ${daysToCheckOut} day${daysToCheckOut !== 1 ? "s" : ""}`,
      tone: "warning",
    });
  }

  if (input.status === "confirmed" && daysToCheckIn < 0) {
    tags.push({ key: "overdue_checkin", label: "Overdue check-in", tone: "danger" });
  }

  if (tags.length === 0) {
    tags.push({
      key: "status",
      label: input.status.replace(/_/g, " "),
      tone: "muted",
    });
  }

  return tags;
}

export function buildDaycareTags(input: {
  sessionDate: string;
  todayDate: string;
  checkedIn: boolean;
  packageId: string | null;
  billingPath?: "single" | "hourly" | "package" | "train";
  hasInvoice?: boolean;
  /** True when the session is linked to a draft invoice (hours not yet entered). */
  hasDraftInvoice?: boolean;
}): OperationTag[] {
  const tags: OperationTag[] = [];

  if (input.sessionDate === input.todayDate && input.checkedIn) {
    tags.push({ key: "checked_in_today", label: "Checked in today", tone: "success" });
  } else if (input.sessionDate > input.todayDate) {
    const days = differenceInCalendarDays(parseISO(input.sessionDate), parseISO(input.todayDate));
    tags.push({
      key: "scheduled_for_date",
      label: `Scheduled in ${days} day${days !== 1 ? "s" : ""}`,
      tone: "default",
    });
  } else if (input.sessionDate < input.todayDate) {
    tags.push({ key: "past_session", label: "Past session", tone: "muted" });
  }

  if (input.billingPath === "hourly") {
    if (input.hasInvoice) {
      tags.push({ key: "hourly_invoiced", label: "Hourly · Invoiced", tone: "success" });
    } else if (input.hasDraftInvoice) {
      tags.push({ key: "hourly_draft", label: "Hourly · Draft invoice", tone: "warning" });
    } else {
      tags.push({ key: "hourly", label: "Hourly · Pending invoice", tone: "warning" });
    }
  } else if (input.billingPath === "train") {
    tags.push({ key: "daycare_train", label: "Daycare & Train", tone: "default" });
  } else if (input.packageId || input.billingPath === "package") {
    tags.push({ key: "package", label: "Package", tone: "default" });
  } else {
    tags.push({ key: "single_day", label: "Single day", tone: "warning" });
  }

  return tags;
}

