/**
 * Helpers for creating and extending a draft invoice for hourly daycare check-ins.
 *
 * Design:
 * - One draft invoice per owner per calendar day for all hourly dogs.
 * - Primary session: linked via invoices.service_id.
 * - Sibling sessions: linked via HOURLY_DRAFT:{invoiceId} in session notes.
 * - Each dog gets a placeholder line (quantity 1, unit_price 0) so the draft
 *   is visible in billing and line items can be added during the stay.
 * - Transport lines are added to the draft when there are no single-day dogs
 *   in the same check-in batch (avoids double-billing on mixed batches).
 * - At Complete Hourly Billing, placeholder lines are replaced with real hour
 *   lines and the invoice is finalised.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { recalculateInvoiceTotals } from "@/lib/invoiceRecalc";
import { findOpenSameDayServiceInvoice, syncMergedInvoiceServiceType } from "@/lib/sameDayServiceInvoiceLookup";
import { composeNotesWithHourlyDraft } from "@/lib/daycareSessionMeta";
import { invoiceDueDateAtCheckIn } from "@/lib/invoiceDueDate";
import { withoutSupersededInvoices } from "@/lib/invoiceStatus";
import {
  netFromGrossInclusive,
  vatAmountFromGrossInclusive,
} from "@/lib/vatConfig";

/** service_type value written on placeholder lines so checkout can find and replace them. */
export const HOURLY_PLACEHOLDER_SERVICE_TYPE = "daycare_hourly_placeholder";

type InvoiceLineInsert = Database["public"]["Tables"]["invoice_line_items"]["Insert"];

export type HourlyDraftSession = {
  id: string;
  notes: string | null;
  petName: string;
};

export type HourlyDraftTransport = {
  pickupUsed: boolean;
  dropoffUsed: boolean;
  /** Don't add transport to the draft (e.g. mixed batch where single-day invoice already has it). */
  skip: boolean;
  qty: number;
  rate: number;
  pricingKey: string | null;
  zoneLabel: string;
  isPrivateFlat: boolean;
};

export type FindOrCreateHourlyDraftParams = {
  ownerId: string;
  sessionDate: string;
  sessions: HourlyDraftSession[];
  transport: HourlyDraftTransport;
};

/** Query for an existing non-voided draft daycare invoice for this owner+date. */
async function findExistingHourlyDraft(
  ownerId: string,
  sessionDate: string,
): Promise<string | null> {
  const { data, error } = await withoutSupersededInvoices(
    supabase
      .from("invoices")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("service_type", "daycare")
      .eq("status", "draft")
      .eq("issue_date", sessionDate)
      .order("created_at", { ascending: true })
      .limit(1),
  );
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

function buildPlaceholderLine(
  petName: string,
  invoiceId: string,
  sortOrder: number,
): InvoiceLineInsert {
  return {
    invoice_id: invoiceId,
    description: `Daycare hourly — ${petName} (hours pending)`,
    quantity: 1,
    unit_price: 0,
    total_price: 0,
    line_total: 0,
    pricing_key: "daycare_hourly_single_day",
    service_type: HOURLY_PLACEHOLDER_SERVICE_TYPE,
    sort_order: sortOrder,
  };
}

function buildTransportLines(
  transport: HourlyDraftTransport,
  invoiceId: string,
  startSortOrder: number,
): InvoiceLineInsert[] {
  const lines: InvoiceLineInsert[] = [];
  let sort = startSortOrder;
  if (transport.skip || (!transport.pickupUsed && !transport.dropoffUsed)) return lines;

  if (transport.pickupUsed) {
    lines.push({
      invoice_id: invoiceId,
      description: transport.isPrivateFlat
        ? `Pickup transport (${transport.zoneLabel}) — family flat rate`
        : `Pickup transport (${transport.zoneLabel})`,
      quantity: transport.qty,
      unit_price: transport.rate,
      total_price: transport.rate * transport.qty,
      line_total: transport.rate * transport.qty,
      pricing_key: transport.pricingKey,
      service_type: "transport",
      sort_order: sort++,
    });
  }
  if (transport.dropoffUsed) {
    lines.push({
      invoice_id: invoiceId,
      description: transport.isPrivateFlat
        ? `Drop-off transport (${transport.zoneLabel}) — family flat rate`
        : `Drop-off transport (${transport.zoneLabel})`,
      quantity: transport.qty,
      unit_price: transport.rate,
      total_price: transport.rate * transport.qty,
      line_total: transport.rate * transport.qty,
      pricing_key: transport.pricingKey,
      service_type: "transport",
      sort_order: sort++,
    });
  }
  return lines;
}

/**
 * Find or create a draft daycare invoice for the given owner+date, then:
 *  - Add placeholder lines for the new sessions.
 *  - Write HOURLY_DRAFT:{invoiceId} into each session's notes.
 *  - Recalculate invoice totals.
 *
 * Returns the invoice id. Throws on any hard error; callers should wrap in
 * try/catch and show a non-blocking toast (the check-in session rows already exist).
 */
export async function findOrCreateHourlyDraft(
  params: FindOrCreateHourlyDraftParams,
): Promise<string> {
  const { ownerId, sessionDate, sessions, transport } = params;
  if (sessions.length === 0) throw new Error("No sessions provided");

  let invoiceId = await findExistingHourlyDraft(ownerId, sessionDate);
  let mergedServiceType: string | null = null;

  if (!invoiceId) {
    const open = await findOpenSameDayServiceInvoice(supabase, ownerId, sessionDate);
    if (open) {
      invoiceId = open.id;
      mergedServiceType = open.service_type;
    }
  }

  if (!invoiceId) {
    // ── Create a new draft invoice ─────────────────────────────────────────
    const transportSubtotal =
      !transport.skip && transport.qty > 0
        ? transport.rate *
          transport.qty *
          ([transport.pickupUsed, transport.dropoffUsed].filter(Boolean).length)
        : 0;
    // All placeholder lines are AED 0; total comes from transport only.
    const grossTotal = Math.max(0, transportSubtotal);
    const vatAed = vatAmountFromGrossInclusive(grossTotal);
    const netExVat = netFromGrossInclusive(grossTotal);
    const dueDate = invoiceDueDateAtCheckIn(sessionDate);

    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .insert({
        owner_id: ownerId,
        service_id: sessions[0].id,
        service_type: "daycare",
        status: "draft",
        issue_date: sessionDate,
        subtotal: netExVat,
        
        discount_pct: 0,
        
        discount_amount: 0,
        total: grossTotal,
        vat_aed: vatAed,
        due_date: dueDate,
      })
      .select("id")
      .single();

    if (invErr) throw invErr;
    invoiceId = inv.id;

    // Insert placeholder + transport lines
    const placeholderLines = sessions.map((s, i) =>
      buildPlaceholderLine(s.petName, invoiceId!, i),
    );
    const transportLines = buildTransportLines(transport, invoiceId, sessions.length);
    const allLines = [...placeholderLines, ...transportLines];

    if (allLines.length > 0) {
      const { error: lineErr } = await supabase.from("invoice_line_items").insert(allLines);
      if (lineErr) {
        // Roll back the invoice to avoid an orphaned header row
        await supabase.from("invoices").delete().eq("id", invoiceId);
        throw lineErr;
      }
    }
  } else {
    // ── Extend an existing draft ───────────────────────────────────────────
    // Count existing lines to set sort_order beyond them
    const { data: existingLines } = await supabase
      .from("invoice_line_items")
      .select("sort_order")
      .eq("invoice_id", invoiceId)
      .order("sort_order", { ascending: false })
      .limit(1);

    const maxSort = existingLines?.[0]?.sort_order ?? -1;
    const placeholderLines = sessions.map((s, i) =>
      buildPlaceholderLine(s.petName, invoiceId!, (maxSort ?? -1) + 1 + i),
    );

    if (placeholderLines.length > 0) {
      const { error: lineErr } = await supabase.from("invoice_line_items").insert(placeholderLines);
      if (lineErr) throw lineErr;
    }

    if (mergedServiceType !== null) {
      await syncMergedInvoiceServiceType(supabase, invoiceId, mergedServiceType, "daycare");
    }
  }

  // ── Write HOURLY_DRAFT marker into each session's notes ──────────────────
  // Primary session (first in list when creating, or all when extending) get the marker.
  // For a new invoice the primary is already linked via service_id; we still write the
  // HOURLY_DRAFT marker so resolveDaycareSessionInvoiceId works uniformly for all sessions.
  await Promise.all(
    sessions.map(async (session) => {
      const newNotes = composeNotesWithHourlyDraft(session.notes, invoiceId!);
      const { error } = await supabase
        .from("daycare_sessions")
        .update({ notes: newNotes })
        .eq("id", session.id);
      if (error) throw error;
    }),
  );

  // Recalculate totals (placeholder lines are AED 0, transport lines carry value)
  await recalculateInvoiceTotals(invoiceId);

  return invoiceId;
}

/**
 * Remove a single session's placeholder line from a multi-dog draft invoice,
 * optionally promoting a new primary session if the cancelled one owned service_id.
 *
 * Does NOT delete the session — caller is responsible for that.
 */
export async function removeSingleSessionFromDraft(params: {
  invoiceId: string;
  cancelledSessionId: string;
  petName: string;
  /** True when the cancelled session is the invoice's service_id primary. */
  isPrimary: boolean;
  /** If primary, this session id will become the new service_id. */
  promotedSessionId?: string;
}): Promise<void> {
  const { invoiceId, cancelledSessionId, petName, isPrimary, promotedSessionId } = params;

  // Remove the placeholder line for this pet
  const descriptionTarget = `Daycare hourly — ${petName} (hours pending)`;
  const { data: matchingLines } = await supabase
    .from("invoice_line_items")
    .select("id")
    .eq("invoice_id", invoiceId)
    .eq("service_type", HOURLY_PLACEHOLDER_SERVICE_TYPE)
    .eq("description", descriptionTarget)
    .limit(1);

  if (matchingLines && matchingLines.length > 0) {
    await supabase.from("invoice_line_items").delete().eq("id", matchingLines[0].id);
  }

  // If this was the primary session, promote a sibling
  if (isPrimary && promotedSessionId) {
    await supabase
      .from("invoices")
      .update({ service_id: promotedSessionId })
      .eq("id", invoiceId);

    // Clear the HOURLY_DRAFT marker from the promoted session (it becomes primary via service_id)
    const { data: promotedSession } = await supabase
      .from("daycare_sessions")
      .select("id, notes")
      .eq("id", promotedSessionId)
      .single();

    if (promotedSession) {
      const { clearHourlyDraftFromNotes } = await import("@/lib/daycareSessionMeta");
      const newNotes = clearHourlyDraftFromNotes(promotedSession.notes, invoiceId);
      await supabase
        .from("daycare_sessions")
        .update({ notes: newNotes })
        .eq("id", promotedSessionId);
    }
  }

  // Clear the HOURLY_DRAFT marker from the cancelled session's notes
  const { data: cancelledSession } = await supabase
    .from("daycare_sessions")
    .select("id, notes")
    .eq("id", cancelledSessionId)
    .single();

  if (cancelledSession) {
    const { clearHourlyDraftFromNotes } = await import("@/lib/daycareSessionMeta");
    const newNotes = clearHourlyDraftFromNotes(cancelledSession.notes, invoiceId);
    await supabase
      .from("daycare_sessions")
      .update({ notes: newNotes })
      .eq("id", cancelledSessionId);
  }

  await recalculateInvoiceTotals(invoiceId);
}
