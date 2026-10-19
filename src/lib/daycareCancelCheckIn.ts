import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { HOURLY_PLACEHOLDER_SERVICE_TYPE, removeSingleSessionFromDraft } from "@/lib/daycareHourlyDraftInvoice";
import { parseHourlyDraftId } from "@/lib/daycareSessionMeta";
import { withoutSupersededInvoices } from "@/lib/invoiceStatus";
import { canVoidInvoiceStatus, loadInvoiceVoidPreview, voidInvoice, type InvoiceVoidPreview } from "@/lib/voidInvoice";

type DaycareSession = Database["public"]["Tables"]["daycare_sessions"]["Row"];
type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];

async function creditUnitsToRestore(
  sessionId: string,
  creditId: string,
  serviceCode: string,
): Promise<number> {
  if (serviceCode !== "daycare_hourly") return 1;

  const { data: invoices } = await withoutSupersededInvoices(
    supabase.from("invoices").select("id").eq("service_id", sessionId).limit(1),
  );

  const invoiceId = invoices?.[0]?.id;
  if (!invoiceId) return 1;

  const { data: lines } = await supabase
    .from("invoice_line_items")
    .select("quantity, description")
    .eq("invoice_id", invoiceId);

  const hourlyLine = (lines ?? []).find((line) => /hourly/i.test(line.description ?? ""));
  if (hourlyLine && hourlyLine.quantity > 0) {
    const fromDescription = hourlyLine.description?.match(/\(([\d.]+)\s*hr\)/i)?.[1];
    if (fromDescription) {
      const parsed = Number(fromDescription);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return hourlyLine.quantity;
  }
  return 1;
}

type SessionRow = DaycareSession & { pets: { name: string } | null };

type LineRemoval = {
  invoiceId: string;
  petName: string;
  isPrimary: boolean;
  promotedSessionId?: string;
};

type InspectedCancel = {
  row: SessionRow;
  lineRemoval: LineRemoval | null;
  invoicesToVoid: InvoiceRow[];
};

async function inspectDaycareCancel(sessionId: string): Promise<InspectedCancel> {
  const { data: session, error: sessionErr } = await supabase
    .from("daycare_sessions")
    .select("*, pets(name)")
    .eq("id", sessionId)
    .single();

  if (sessionErr) throw sessionErr;
  if (!session) throw new Error("Session not found");

  const row = session as SessionRow;
  if (!row.checked_in) {
    throw new Error("This session is not checked in");
  }

  let lineRemoval: LineRemoval | null = null;
  const invoicesToVoid: InvoiceRow[] = [];

  const draftIdFromNotes = parseHourlyDraftId(row.notes);
  const { data: draftViaServiceId } = await supabase
    .from("invoices")
    .select("*")
    .eq("service_id", sessionId)
    .eq("status", "draft")
    .limit(1);
  const draftIdViaService = draftViaServiceId?.[0]?.id ?? null;
  const draftInvoiceId = draftIdFromNotes ?? draftIdViaService;

  if (draftInvoiceId) {
    const draftMarker = `HOURLY_DRAFT:${draftInvoiceId}`;
    const { data: siblings } = await supabase
      .from("daycare_sessions")
      .select("id, notes")
      .ilike("notes", `%${draftMarker}%`)
      .neq("id", sessionId);

    const siblingCount = siblings?.length ?? 0;
    const isPrimary = draftIdViaService === draftInvoiceId;
    const { data: draftLines } = await supabase
      .from("invoice_line_items")
      .select("id, service_type")
      .eq("invoice_id", draftInvoiceId);
    const nonPlaceholderLines = (draftLines ?? []).filter(
      (line) => line.service_type !== HOURLY_PLACEHOLDER_SERVICE_TYPE,
    );

    if (siblingCount > 0 || nonPlaceholderLines.length > 0) {
      lineRemoval = {
        invoiceId: draftInvoiceId,
        petName: row.pets?.name ?? "Pet",
        isPrimary,
        promotedSessionId: isPrimary && siblings && siblings.length > 0 ? siblings[0].id : undefined,
      };
    } else {
      const { data: fullInvoice } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", draftInvoiceId)
        .single();
      if (fullInvoice && canVoidInvoiceStatus(fullInvoice.status)) {
        invoicesToVoid.push(fullInvoice as InvoiceRow);
      }
    }
  }

  const { data: otherInvoices, error: invErr } = await withoutSupersededInvoices(
    supabase.from("invoices").select("*").eq("service_id", sessionId).neq("status", "draft"),
  );
  if (invErr) throw invErr;
  for (const invoice of otherInvoices ?? []) {
    if (canVoidInvoiceStatus(invoice.status) && !invoicesToVoid.some((row) => row.id === invoice.id)) {
      invoicesToVoid.push(invoice as InvoiceRow);
    }
  }

  return { row, lineRemoval, invoicesToVoid };
}

export type DaycareCancelPlan = {
  /** Shared hourly draft keeps the invoice and drops only this dog's line. */
  lineRemoval: boolean;
  invoices: InvoiceVoidPreview[];
};

export async function planDaycareCheckInCancel(sessionId: string): Promise<DaycareCancelPlan> {
  const inspected = await inspectDaycareCancel(sessionId);
  const invoices: InvoiceVoidPreview[] = [];
  for (const invoice of inspected.invoicesToVoid) {
    invoices.push(await loadInvoiceVoidPreview(invoice.id));
  }
  return { lineRemoval: inspected.lineRemoval != null, invoices };
}

export type DaycareCheckInCancelInput = {
  reason: string;
  staff: string;
};

/**
 * Undo a daycare check-in: void linked invoices through void_invoice, restore
 * package credit, and delete the session.
 *
 * A shared hourly draft drops only this dog's placeholder line. That invoice
 * stays open for the other dogs.
 */
export async function cancelDaycareCheckIn(
  sessionId: string,
  input: DaycareCheckInCancelInput,
): Promise<void> {
  const { row, lineRemoval, invoicesToVoid } = await inspectDaycareCancel(sessionId);
  const voidable = invoicesToVoid.filter((invoice) => canVoidInvoiceStatus(invoice.status));

  let unitsToRestore = 0;
  let creditId: string | null = null;
  if (row.package_id) {
    const { data: credit, error: creditErr } = await supabase
      .from("service_credits")
      .select("id, service_code, units_consumed")
      .eq("id", row.package_id)
      .maybeSingle();
    if (creditErr) throw creditErr;
    if (credit && credit.units_consumed > 0) {
      creditId = credit.id;
      unitsToRestore = await creditUnitsToRestore(sessionId, credit.id, credit.service_code);
    }
  }

  if (voidable.length > 0) {
    const reason = input.reason.trim();
    const staff = input.staff.trim();
    if (!reason) throw new Error("A void reason is required.");
    if (!staff) throw new Error("Staff name is required.");
    for (const invoice of voidable) {
      await voidInvoice({ invoiceId: invoice.id, reason, staff });
    }
  }

  if (lineRemoval) {
    await removeSingleSessionFromDraft({
      invoiceId: lineRemoval.invoiceId,
      cancelledSessionId: sessionId,
      petName: lineRemoval.petName,
      isPrimary: lineRemoval.isPrimary,
      promotedSessionId: lineRemoval.promotedSessionId,
    });
  }

  if (creditId && unitsToRestore > 0) {
    const { error: restoreErr } = await supabase.rpc("restore_service_credit", {
      p_credit_id: creditId,
      p_units: unitsToRestore,
    });
    if (restoreErr) {
      throw new Error(
        `Could not restore package credit (${restoreErr.message}). Apply migration restore_service_credit if missing.`,
      );
    }
  }

  const { error: deleteErr } = await supabase.from("daycare_sessions").delete().eq("id", sessionId);
  if (deleteErr) throw deleteErr;
}
