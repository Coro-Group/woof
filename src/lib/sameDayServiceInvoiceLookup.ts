import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  headerServiceTypeForMerge,
  isSameDayMergeableService,
  OPEN_SAME_DAY_INVOICE_STATUSES,
  pickOpenSameDayInvoice,
  type SameDayInvoiceCandidate,
} from "@/lib/sameDayServiceInvoice";

type Client = SupabaseClient<Database>;

export type OpenSameDayInvoice = SameDayInvoiceCandidate;

export async function findOpenSameDayServiceInvoice(
  db: Client,
  ownerId: string,
  serviceDate: string,
): Promise<OpenSameDayInvoice | null> {
  const { data, error } = await db
    .from("invoices")
    .select("id, status, amount_paid, service_type, due_date, booking_id, receipt_only, created_at")
    .eq("owner_id", ownerId)
    .eq("due_date", serviceDate)
    .in("status", [...OPEN_SAME_DAY_INVOICE_STATUSES])
    .eq("amount_paid", 0)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw error;
  return pickOpenSameDayInvoice(data ?? [], serviceDate);
}

export async function syncMergedInvoiceServiceType(
  db: Client,
  invoiceId: string,
  currentServiceType: string | null,
  incomingServiceType: string,
): Promise<void> {
  if (!isSameDayMergeableService(incomingServiceType)) return;
  const next = headerServiceTypeForMerge(currentServiceType, incomingServiceType);
  if (next === currentServiceType) return;
  const { error } = await db.from("invoices").update({ service_type: next }).eq("id", invoiceId);
  if (error) throw error;
}
