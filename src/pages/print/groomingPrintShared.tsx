/* eslint-disable react-refresh/only-export-components */
import { addMinutes, format, parse, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { labelForGroomingService, type GroomingService } from "@/lib/groomingCatalog";
import { ownerDisplayName } from "@/lib/bookingUtils";
import {
  invoiceDisplayTotals,
  netFromGrossInclusive,
  vatAmountFromGrossInclusive,
  vatLineLabel,
} from "@/lib/vatConfig";
import { petMedicalConditions, petMedicationNotes } from "@/lib/petCareNotes";

export type GroomingInvoiceMoney = {
  netExVat: number;
  vat: number;
  grandTotal: number;
};

function groomingMoneyFromPrice(price: number): GroomingInvoiceMoney {
  const gross = Math.max(0, price);
  return {
    netExVat: netFromGrossInclusive(gross),
    vat: vatAmountFromGrossInclusive(gross),
    grandTotal: gross,
  };
}

export type GroomingPrintRow = {
  id: string;
  appointment_date: string;
  appointment_time: string | null;
  duration_minutes: number | null;
  service: GroomingService;
  grooming_notes: string | null;
  notes: string | null;
  visit_notes: string | null;
  pet_id: string;
  owner_id: string;
  price: number | null;
  booking_id: string | null;
  owners: {
    first_name: string;
    last_name: string | null;
    phone: string | null;
    phone2: string | null;
    email: string | null;
    address: string | null;
  } | null;
  pets: {
    name: string;
    breed: string | null;
    size: "small" | "medium" | "large" | null;
    grooming_notes: string | null;
    medical_conditions: string | null;
    medication_notes: string | null;
    medications: string | null;
  } | null;
  bookings: {
    booking_ref: string | null;
  } | null;
};

const GROOMING_APPOINTMENT_PRINT_SELECT = `
  id, appointment_date, appointment_time, duration_minutes, service, grooming_notes, notes, visit_notes, pet_id, owner_id, price, booking_id,
  owners(first_name, last_name, phone, phone2, email, address),
  pets(name, breed, size, grooming_notes, medical_conditions, medication_notes, medications),
  bookings(booking_ref)
`;

const PACKAGE_LABEL: Partial<Record<GroomingService, string>> = {
  full_groom: "Grande - Full Groom",
  full_bath: "Bijoux - Full Bath",
  splash: "Summer Splash",
  tidy: "Tidy",
  deshedding: "Deshedding",
  brushing: "Brushing",
  nail_clip: "Nail Clip",
  gland_expression: "Anal Gland Expression",
  pawdicure: "Pawdicure",
};

export function formatAppointmentTime(time: string | null): string {
  if (!time) return "—";
  const normalized = time.length >= 5 ? time.slice(0, 5) : time;
  try {
    return format(parseISO(`2000-01-01T${normalized}`), "h:mm a");
  } catch {
    return normalized;
  }
}

type PreviousGroomMap = Record<string, string | null>;
type AmountMap = Record<string, GroomingInvoiceMoney | null>;

export async function fetchGroomingRowsForDateRange(
  fromDate: string,
  toDate: string,
): Promise<{
  appointments: GroomingPrintRow[];
  previousByPetId: PreviousGroomMap;
  amountByAppointmentId: AmountMap;
}> {
  const { data, error } = await supabase
    .from("grooming_appointments")
    .select(GROOMING_APPOINTMENT_PRINT_SELECT)
    .gte("appointment_date", fromDate)
    .lte("appointment_date", toDate)
    .neq("status", "cancelled")
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true, nullsFirst: false });

  if (error) throw error;
  const appointments = (data ?? []) as unknown as GroomingPrintRow[];
  return enrichGroomingRows(appointments);
}

export async function fetchGroomingRowsForDate(
  date: string,
): Promise<{
  appointments: GroomingPrintRow[];
  previousByPetId: PreviousGroomMap;
  amountByAppointmentId: AmountMap;
}> {
  return fetchGroomingRowsForDateRange(date, date);
}

export async function fetchGroomingRowById(
  bookingId: string,
): Promise<{
  appointment: GroomingPrintRow;
  previousGroomDate: string | null;
  invoiceMoney: GroomingInvoiceMoney | null;
}> {
  const { data, error } = await supabase
    .from("grooming_appointments")
    .select(GROOMING_APPOINTMENT_PRINT_SELECT)
    .eq("id", bookingId)
    .single();

  if (error) throw error;
  const row = data as unknown as GroomingPrintRow;

  const enriched = await enrichGroomingRows([row]);
  return {
    appointment: row,
    previousGroomDate: enriched.previousByPetId[row.pet_id] ?? null,
    invoiceMoney:
      enriched.amountByAppointmentId[row.id] ??
      (row.price != null ? groomingMoneyFromPrice(row.price) : null),
  };
}

async function enrichGroomingRows(rows: GroomingPrintRow[]): Promise<{
  appointments: GroomingPrintRow[];
  previousByPetId: PreviousGroomMap;
  amountByAppointmentId: AmountMap;
}> {
  if (rows.length === 0) {
    return { appointments: [], previousByPetId: {}, amountByAppointmentId: {} };
  }

  const minDate = rows.reduce((min, r) => (r.appointment_date < min ? r.appointment_date : min), rows[0].appointment_date);
  const petIds = Array.from(new Set(rows.map((r) => r.pet_id)));
  const appointmentIds = rows.map((r) => r.id);

  const [{ data: previousRows, error: previousError }, { data: invoices, error: invoicesError }] =
    await Promise.all([
      supabase
        .from("grooming_appointments")
        .select("pet_id, appointment_date, status")
        .in("pet_id", petIds)
        .lt("appointment_date", minDate)
        .neq("status", "cancelled")
        .order("appointment_date", { ascending: false }),
      supabase
        .from("invoices")
        .select("service_id, total, vat_aed")
        .eq("service_type", "grooming")
        .in("service_id", appointmentIds),
    ]);

  if (previousError) throw previousError;
  if (invoicesError) throw invoicesError;

  const previousByPetId: PreviousGroomMap = {};
  for (const row of previousRows ?? []) {
    if (!previousByPetId[row.pet_id]) previousByPetId[row.pet_id] = row.appointment_date;
  }

  const amountByAppointmentId: AmountMap = {};
  for (const inv of invoices ?? []) {
    if (!inv.service_id) continue;
    amountByAppointmentId[inv.service_id] = invoiceDisplayTotals({
      total: inv.total,
      vat_aed: inv.vat_aed,
    });
  }

  return {
    appointments: rows,
    previousByPetId,
    amountByAppointmentId,
  };
}

function parseGroomingNotesMeta(notes: string | null | undefined): {
  services: string[];
  groomingDate: string | null;
  estimatedPickup: string | null;
} {
  if (!notes) return { services: [], groomingDate: null, estimatedPickup: null };
  const lines = notes
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const servicesLine = lines.find((l) => l.toLowerCase().startsWith("services:"));
  const groomingDateLine = lines.find((l) =>
    l.toLowerCase().startsWith("grooming date:"),
  );
  const estimatedPickupLine = lines.find((l) =>
    l.toLowerCase().startsWith("estimated pickup:"),
  );
  const services = servicesLine
    ? servicesLine
        .slice("services:".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const groomingDate = groomingDateLine
    ? groomingDateLine.slice("grooming date:".length).trim() || null
    : null;
  const estimatedPickup = estimatedPickupLine
    ? estimatedPickupLine.slice("estimated pickup:".length).trim() || null
    : null;
  return { services, groomingDate, estimatedPickup };
}

function stripMetaFromVisitNotes(notes: string | null | undefined): string {
  if (!notes) return "";
  const metaPrefixes = ["services:", "grooming date:", "discount:", "estimated pickup:"];
  return notes
    .split("\n")
    .filter((l) => !metaPrefixes.some((p) => l.toLowerCase().trimStart().startsWith(p)))
    .join("\n")
    .trim();
}

function appointmentTimeHHMM(time: string | null): string {
  if (!time) return "10:00";
  const s = time.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : "10:00";
}

function estimatedPickupFromDuration(
  timeValue: string,
  durationMinutes: number | null,
): string | null {
  if (!/^\d{2}:\d{2}$/.test(timeValue)) return null;
  const safe =
    durationMinutes != null && Number.isFinite(durationMinutes) && durationMinutes > 0
      ? durationMinutes
      : 0;
  if (safe <= 0) return null;
  try {
    const start = parse(`${timeValue}:00`, "HH:mm:ss", new Date(2000, 0, 1));
    return format(addMinutes(start, safe), "h:mm a");
  } catch {
    return null;
  }
}

function schedulePickupDisplay(a: GroomingPrintRow): string | null {
  const meta = parseGroomingNotesMeta(a.notes);
  if (meta.estimatedPickup?.trim()) return meta.estimatedPickup.trim();
  return estimatedPickupFromDuration(
    appointmentTimeHHMM(a.appointment_time),
    a.duration_minutes,
  );
}

function scheduleServicesDisplay(a: GroomingPrintRow): string {
  const primary = labelForGroomingService(a.service);
  const extra = parseGroomingNotesMeta(a.notes).services;
  const parts = [primary, ...extra.filter((x) => x?.trim())];
  return Array.from(new Set(parts)).join(", ");
}

function scheduleNotesDisplay(a: GroomingPrintRow): string {
  const visit = stripMetaFromVisitNotes(a.notes);
  const vn = (a.visit_notes ?? "").trim();
  if (visit && vn) return `${visit}\n\nStaff visit: ${vn}`;
  return visit || vn || "—";
}

export function GroomingSchedulePrintView({
  appointments,
  dateFrom,
  dateTo,
}: {
  appointments: GroomingPrintRow[];
  dateFrom: string;
  dateTo: string;
}) {
  const fromLabel = format(parseISO(dateFrom), "EEEE, d MMMM yyyy");
  const toLabel = format(parseISO(dateTo), "EEEE, d MMMM yyyy");

  const byDate = new Map<string, GroomingPrintRow[]>();
  for (const a of appointments) {
    const list = byDate.get(a.appointment_date) ?? [];
    list.push(a);
    byDate.set(a.appointment_date, list);
  }
  const dates = Array.from(byDate.keys()).sort();

  return (
    <div className="grooming-schedule-print print-sans w-full max-w-none text-black">
      <header className="schedule-print-header mb-8 text-center">
        <h1 className="schedule-print-title text-lg font-bold leading-tight md:text-xl">
          Grooming Schedule for Second Home Domestic Pets Grooming LLC
        </h1>
        <p className="schedule-print-subtitle mt-3 text-xs leading-relaxed text-neutral-700 md:text-sm">
          From: {fromLabel}
          <span className="mx-2">·</span>
          To: {toLabel}
        </p>
      </header>

      {appointments.length === 0 ? (
        <p className="text-sm">No grooming appointments in this range.</p>
      ) : (
        dates.map((dKey, idx) => {
          const rows = byDate.get(dKey)!;
          return (
            <section
              key={dKey}
              className={
                idx === 0 ? "schedule-day-section-first" : "schedule-day-section"
              }
            >
              <table className="schedule-table w-full border-collapse text-left text-[11px] leading-relaxed">
                <thead>
                  <tr>
                    <th className="schedule-th schedule-col-pet">Pet Name</th>
                    <th className="schedule-th schedule-col-date">Date</th>
                    <th className="schedule-th schedule-col-groomer">Groomer</th>
                    <th className="schedule-th schedule-col-services">Service(s)</th>
                    <th className="schedule-th schedule-col-notes">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const owner = ownerDisplayName(
                      a.owners?.first_name,
                      a.owners?.last_name,
                    );
                    const pickup = schedulePickupDisplay(a);
                    const dateLines = [
                      format(parseISO(a.appointment_date), "EEE, d MMM yyyy"),
                      formatAppointmentTime(a.appointment_time),
                      pickup ? `Pickup: ${pickup}` : null,
                    ].filter(Boolean) as string[];

                    return (
                      <tr key={a.id} className="schedule-data-row">
                        <td className="schedule-td schedule-td-pet align-top">
                          <div className="schedule-pet-lines text-neutral-900">
                            <div className="text-base font-bold leading-tight">
                              {a.pets?.name ?? "—"}
                            </div>
                            <div>Owner: {owner}</div>
                            {a.pets?.breed ? <div>Breed: {a.pets.breed}</div> : null}
                            {a.owners?.address?.trim() ? (
                              <div className="whitespace-pre-wrap break-words">{a.owners.address.trim()}</div>
                            ) : null}
                            {a.owners?.phone?.trim() ? (
                              <div>Home: {a.owners.phone.trim()}</div>
                            ) : null}
                            {a.owners?.phone2?.trim() ? (
                              <div>Cell: {a.owners.phone2.trim()}</div>
                            ) : null}
                            {a.owners?.email?.trim() ? (
                              <div className="break-all">{a.owners.email.trim()}</div>
                            ) : null}
                          </div>
                        </td>
                        <td className="schedule-td schedule-td-date align-top whitespace-pre-line">
                          {dateLines.join("\n")}
                        </td>
                        <td className="schedule-td align-top">
                          {a.grooming_notes?.trim() || "—"}
                        </td>
                        <td className="schedule-td align-top">{scheduleServicesDisplay(a)}</td>
                        <td className="schedule-td schedule-td-notes align-top whitespace-pre-wrap">
                          {scheduleNotesDisplay(a)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })
      )}
    </div>
  );
}

export function GroomingCardBlock({
  appointment,
  previousGroomDate,
  invoiceMoney,
}: {
  appointment: GroomingPrintRow;
  previousGroomDate: string | null;
  invoiceMoney: GroomingInvoiceMoney | null;
}) {
  const owner = ownerDisplayName(appointment.owners?.first_name, appointment.owners?.last_name);
  const serviceLabel = labelForGroomingService(appointment.service);
  const packageLabel = PACKAGE_LABEL[appointment.service] ?? serviceLabel;
  const money = invoiceMoney ?? groomingMoneyFromPrice(appointment.price ?? 0);

  return (
    <article className="print-page border border-black p-4 text-[12px]">
      <header className="mb-3 border-b border-black pb-2">
        <h1 className="text-2xl font-bold">{appointment.pets?.name ?? "Unknown pet"}</h1>
        <p>
          {appointment.pets?.breed ?? "Unknown breed"} · {appointment.pets?.size ? `${appointment.pets.size.charAt(0).toUpperCase()}${appointment.pets.size.slice(1)}` : "—"}
        </p>
        <p className="print-sans text-xs">
          {format(parseISO(appointment.appointment_date), "d MMM yyyy")} ·{" "}
          {formatAppointmentTime(appointment.appointment_time)}
        </p>
        <p className="print-sans text-sm font-semibold">
          {packageLabel}
          {packageLabel !== serviceLabel ? ` (${serviceLabel})` : ""}
        </p>
        <p className="print-sans text-xs">Assigned groomer: {appointment.grooming_notes ?? "—"}</p>
      </header>

      <div className="space-y-2">
        <p>
          <span className="print-label font-semibold uppercase text-[11px]">Owner: </span>
          {owner} · {appointment.owners?.phone ?? "—"}
        </p>
        <p>
          <span className="print-label font-semibold uppercase text-[11px]">Coat notes: </span>
          {appointment.pets?.grooming_notes ?? "—"}
        </p>
        <p>
          <span className="print-label font-semibold uppercase text-[11px]">Sensitivities: </span>
          {[petMedicalConditions(appointment.pets), petMedicationNotes(appointment.pets)]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
        <p>
          <span className="print-label font-semibold uppercase text-[11px]">Previous groom: </span>
          {previousGroomDate ? format(parseISO(previousGroomDate), "d MMM yyyy") : "—"}
        </p>
        <p className="whitespace-pre-line">
          <span className="print-label font-semibold uppercase text-[11px]">Special requests: </span>
          {appointment.notes ?? "—"}
        </p>
      </div>

      <section className="mt-3 border border-black p-2">
        <p className="print-label mb-2 text-[11px] font-semibold uppercase">Checklist</p>
        <div className="grid grid-cols-2 gap-y-1">
          {[
            "Bath",
            "Blow dry",
            "Cut/trim",
            "Nails clipped",
            "Ears cleaned",
            "Teeth brushed",
            "Before photo taken",
            "After photo taken",
          ].map((item) => (
            <p key={item} className="print-sans text-xs">
              ☐ {item}
            </p>
          ))}
        </div>
      </section>

      <footer className="mt-3 border-t border-black pt-2 print-sans text-xs space-y-0.5">
        <p>Booking ref: {appointment.bookings?.booking_ref ?? appointment.booking_id ?? appointment.id.slice(0, 8)}</p>
        <p>Subtotal (ex VAT): AED {money.netExVat.toFixed(2)}</p>
        <p>
          {vatLineLabel()}: AED {money.vat.toFixed(2)}
        </p>
        <p className="font-semibold">Total incl. VAT: AED {money.grandTotal.toFixed(2)}</p>
      </footer>
    </article>
  );
}
