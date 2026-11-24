import type { SupabaseClient } from "@supabase/supabase-js";
import { format, parseISO } from "date-fns";

import type { Database } from "@/integrations/supabase/types";
import { createServiceInvoice } from "@/lib/bookingUtils";
import { parseGroomingMeta } from "@/lib/groomingAppointmentMeta";
import { pickInvoiceLineForService } from "@/lib/sameDayServiceInvoice";
import { labelForGroomingService } from "@/lib/groomingCatalog";
import { groomingPaymentMethodLabel } from "@/lib/groomingPaymentMethod";
import { invoiceDueDateAtCheckIn } from "@/lib/invoiceDueDate";
import { withoutSupersededInvoices } from "@/lib/invoiceStatus";
import { recalculateInvoiceTotals } from "@/lib/invoiceRecalc";
import { roundAed } from "@/lib/money";

type Client = SupabaseClient<Database>;

export type FinalizeGroomingCheckoutResult = {
  invoiceId: string;
  status: string;
  total: number;
  amountPaid: number;
};

export type GroomingInvoicePriceSyncResult =
  | { kind: "no_invoice" }
  | { kind: "skipped"; reason: string }
  | { kind: "unchanged" }
  | { kind: "synced"; invoiceId: string; total: number };

type GroomingApptForCheckout = {
  id: string;
  owner_id: string;
  appointment_date: string;
  price: number | null;
  service: Database["public"]["Enums"]["grooming_service"];
  notes: string | null;
  payment_method: string | null;
  invoice_id: string | null;
  pets: { name: string } | null;
};

type InvoiceRow = Pick<
  Database["public"]["Tables"]["invoices"]["Row"],
  "id" | "status" | "total" | "amount_paid" | "due_date"
>;

/** Build a grooming invoice line description from appointment data. */
export function groomingInvoiceLineDescription(args: {
  service: string;
  notes: string | null;
  petName: string;
  appointmentDate: string;
}): string {
  const primary = labelForGroomingService(args.service);
  const extra = parseGroomingMeta(args.notes).services;
  const labels = Array.from(new Set([primary, ...extra]));
  const svcLabel = labels.join(" + ");
  let dateLabel: string;
  try {
    dateLabel = format(parseISO(args.appointmentDate), "d MMM yyyy");
  } catch {
    dateLabel = args.appointmentDate;
  }
  return `${svcLabel} — ${args.petName} — ${dateLabel}`;
}

/** Coerce Postgres numeric / string appointment prices to AED. */
export function groomingPriceAed(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return roundAed(parsed);
}

/** Whether a grooming appointment price change may update the linked invoice line. */
export function canSyncGroomingAppointmentPriceToInvoice(
  status: string,
  amountPaid: number | null | undefined,
): boolean {
  if (["voided", "consolidated", "cancelled", "paid", "partially_paid"].includes(status)) return false;
  if (status === "draft") return true;
  if (status === "outstanding" || status === "overdue") {
    return roundAed(amountPaid ?? 0) <= 0;
  }
  return false;
}

/** Status patch applied at grooming checkout based on invoice total. */
export function checkoutInvoiceFinalizePatch(
  currentStatus: string,
  total: number,
  dueDate: string,
): { status: string; due_date?: string; paid_at?: string } | null {
  if (total <= 0) {
    if (currentStatus === "paid") return null;
    return { status: "paid", paid_at: new Date().toISOString() };
  }
  if (currentStatus === "draft") {
    return { status: "outstanding", due_date: dueDate };
  }
  return null;
}

async function loadAppointment(
  supabase: Client,
  appointmentId: string,
): Promise<GroomingApptForCheckout> {
  const { data, error } = await supabase
    .from("grooming_appointments")
    .select(
      "id, owner_id, appointment_date, price, service, notes, payment_method, invoice_id, pets(name)",
    )
    .eq("id", appointmentId)
    .single();
  if (error) throw error;
  return data as GroomingApptForCheckout;
}

async function resolveInvoice(
  supabase: Client,
  appt: GroomingApptForCheckout,
): Promise<InvoiceRow | null> {
  if (appt.invoice_id) {
    const { data, error } = await withoutSupersededInvoices(
      supabase
        .from("invoices")
        .select("id, status, total, amount_paid, due_date")
        .eq("id", appt.invoice_id)
        .maybeSingle(),
    );
    if (error) throw error;
    if (data) return data;
  }

  const { data, error } = await withoutSupersededInvoices(
    supabase
      .from("invoices")
      .select("id, status, total, amount_paid, due_date")
      .eq("service_type", "grooming")
      .eq("service_id", appt.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  if (error) throw error;
  return data;
}

async function createInvoiceForAppointment(
  supabase: Client,
  appt: GroomingApptForCheckout,
): Promise<string> {
  const petName = appt.pets?.name ?? "Pet";
  const linePrice = Math.max(0, appt.price ?? 0);
  const notes = appt.payment_method
    ? `Payment method: ${groomingPaymentMethodLabel(appt.payment_method)}`
    : undefined;

  return createServiceInvoice(
    {
      ownerId: appt.owner_id,
      serviceType: "grooming",
      referenceId: appt.id,
      checkInDate: appt.appointment_date,
      notes,
      invoiceStatus: "draft",
      lineItems: [
        {
          description: groomingInvoiceLineDescription({
            service: appt.service,
            notes: appt.notes,
            petName,
            appointmentDate: appt.appointment_date,
          }),
          quantity: 1,
          unitPrice: linePrice,
          serviceType: "grooming",
          preserveUnitPrice: true,
        },
      ],
    },
    supabase,
  );
}

async function syncAppointmentPriceToInvoiceLine(
  supabase: Client,
  invoiceId: string,
  appt: Pick<
    GroomingApptForCheckout,
    "price" | "service" | "notes" | "appointment_date" | "pets"
  >,
): Promise<GroomingInvoicePriceSyncResult> {
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("status, amount_paid, total")
    .eq("id", invoiceId)
    .single();
  if (invErr) throw invErr;
  if (!canSyncGroomingAppointmentPriceToInvoice(invoice.status, invoice.amount_paid)) {
    return {
      kind: "skipped",
      reason:
        invoice.status === "partially_paid" || roundAed(invoice.amount_paid ?? 0) > 0
          ? "Invoice already has payments — update the invoice manually."
          : `Invoice status is ${invoice.status.replace(/_/g, " ")} — update the invoice manually.`,
    };
  }

  const targetPrice = groomingPriceAed(appt.price);
  const { data: lines, error: linesErr } = await supabase
    .from("invoice_line_items")
    .select("id, unit_price, quantity, sort_order, service_type, description")
    .eq("invoice_id", invoiceId)
    .order("sort_order", { ascending: true });
  if (linesErr) throw linesErr;

  const expectedDescription = groomingInvoiceLineDescription({
    service: appt.service,
    notes: appt.notes,
    petName: appt.pets?.name ?? "Pet",
    appointmentDate: appt.appointment_date,
  });
  const primary = pickInvoiceLineForService(lines ?? [], "grooming", expectedDescription);
  if (!primary) return { kind: "skipped", reason: "No grooming line on this invoice to update." };

  const currentTotal = groomingPriceAed(primary.unit_price * Math.max(1, primary.quantity));
  if (currentTotal === targetPrice) return { kind: "unchanged" };

  const lineTotal = targetPrice;
  const { error: updErr } = await supabase
    .from("invoice_line_items")
    .update({
      unit_price: targetPrice,
      total_price: lineTotal,
      line_total: lineTotal,
    })
    .eq("id", primary.id);
  if (updErr) throw updErr;

  await recalculateInvoiceTotals(invoiceId, supabase);

  const { data: refreshed, error: refreshErr } = await supabase
    .from("invoices")
    .select("total")
    .eq("id", invoiceId)
    .single();
  if (refreshErr) throw refreshErr;

  return {
    kind: "synced",
    invoiceId,
    total: roundAed(refreshed.total ?? targetPrice),
  };
}

async function finalizeInvoiceStatus(
  supabase: Client,
  invoiceId: string,
  dueDate: string,
): Promise<InvoiceRow> {
  const { data: invoice, error: fetchErr } = await supabase
    .from("invoices")
    .select("id, status, total, amount_paid, due_date")
    .eq("id", invoiceId)
    .single();
  if (fetchErr) throw fetchErr;

  const total = roundAed(invoice.total ?? 0);
  const patch = checkoutInvoiceFinalizePatch(invoice.status, total, dueDate);
  if (patch) {
    const { error: updErr } = await supabase
      .from("invoices")
      .update(patch)
      .eq("id", invoiceId);
    if (updErr) throw updErr;
  }

  const { data: refreshed, error: refreshErr } = await supabase
    .from("invoices")
    .select("id, status, total, amount_paid, due_date")
    .eq("id", invoiceId)
    .single();
  if (refreshErr) throw refreshErr;
  return refreshed;
}

async function linkAppointmentInvoice(
  supabase: Client,
  appointmentId: string,
  invoiceId: string,
): Promise<void> {
  const { error } = await supabase
    .from("grooming_appointments")
    .update({ invoice_id: invoiceId })
    .eq("id", appointmentId);
  if (error) throw error;
}

/** Sync invoice line items from the current grooming appointment price when allowed. */
export async function syncGroomingInvoicePriceFromAppointment(
  supabase: Client,
  appointmentId: string,
  knownPrice?: number | null,
): Promise<GroomingInvoicePriceSyncResult> {
  const appt = await loadAppointment(supabase, appointmentId);
  if (knownPrice !== undefined) appt.price = groomingPriceAed(knownPrice);
  const invoice = await resolveInvoice(supabase, appt);
  if (!invoice) return { kind: "no_invoice" };
  return syncAppointmentPriceToInvoiceLine(supabase, invoice.id, appt);
}

/** @deprecated Use syncGroomingInvoicePriceFromAppointment */
export async function syncGroomingDraftInvoiceFromAppointment(
  supabase: Client,
  appointmentId: string,
): Promise<void> {
  await syncGroomingInvoicePriceFromAppointment(supabase, appointmentId);
}

/**
 * Ensure a grooming appointment has an invoice, sync draft lines from the
 * appointment price, flip draft → outstanding at checkout (or paid when zero),
 * and link grooming_appointments.invoice_id.
 */
export async function finalizeGroomingCheckoutInvoice(
  supabase: Client,
  params: { appointmentId: string; performedBy?: string },
): Promise<FinalizeGroomingCheckoutResult> {
  void params.performedBy;

  const appt = await loadAppointment(supabase, params.appointmentId);
  let invoice = await resolveInvoice(supabase, appt);

  if (!invoice) {
    const invoiceId = await createInvoiceForAppointment(supabase, appt);
    invoice = await resolveInvoice(supabase, { ...appt, invoice_id: invoiceId });
    if (!invoice) throw new Error("Invoice was created but could not be loaded.");
  }

  await syncAppointmentPriceToInvoiceLine(supabase, invoice.id, appt);

  const dueDate = invoiceDueDateAtCheckIn(appt.appointment_date);
  invoice = await finalizeInvoiceStatus(supabase, invoice.id, dueDate);
  await linkAppointmentInvoice(supabase, appt.id, invoice.id);

  return {
    invoiceId: invoice.id,
    status: invoice.status,
    total: roundAed(invoice.total ?? 0),
    amountPaid: roundAed(invoice.amount_paid ?? 0),
  };
}
