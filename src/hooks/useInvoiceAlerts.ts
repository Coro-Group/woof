import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { ownerDisplayName } from "@/lib/bookingUtils";

type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];

const UNPAID_STATUSES: InvoiceStatus[] = ["outstanding", "partially_paid", "overdue"];

export interface InvoiceAlertRow {
  id: string;
  invoice_number: string | null;
  owner_id: string;
  owner_name: string;
  service_type: string | null;
  total: number;
  amount_paid: number;
  status: InvoiceStatus;
  due_date: string | null;
  created_at: string;
  days_overdue: number;
  deposit_bypass_reason: string | null;
}

export interface MultipleUnpaidOwner {
  owner_id: string;
  owner_name: string;
  count: number;
  total_outstanding: number;
}

export interface InvoiceAlerts {
  staleDrafts: InvoiceAlertRow[];
  overdue: InvoiceAlertRow[];
  depositBypassed: InvoiceAlertRow[];
  multipleUnpaid: MultipleUnpaidOwner[];
  /** status=paid + amount_paid=0 + no invoice_payments — needs manual settlement review. */
  paidWithoutSettlement: InvoiceAlertRow[];
}

type AlertQueryRow = {
  id: string;
  invoice_number: string | null;
  owner_id: string;
  service_type: string | null;
  total: number;
  amount_paid: number | null;
  status: InvoiceStatus;
  due_date: string | null;
  created_at: string;
  deposit_bypassed: boolean | null;
  deposit_bypass_reason: string | null;
  receipt_only: boolean | null;
  owners: { first_name: string | null; last_name: string | null } | null;
};

/**
 * Staff dashboard alert indicators for the new invoicing model:
 * - stale drafts (draft, open past today's end-of-business 18:00)
 * - overdue (unpaid + due_date in the past, or status overdue)
 * - deposit-bypassed bookings created today
 * - owners carrying 2+ unpaid invoices
 */
export function useInvoiceAlerts() {
  return useQuery({
    queryKey: ["invoice-alerts"],
    queryFn: async (): Promise<InvoiceAlerts> => {
      const [invoicesRes, paymentsRes] = await Promise.all([
        supabase
          .from("invoices")
          .select(
            "id, invoice_number, owner_id, service_type, total, amount_paid, status, due_date, created_at, deposit_bypassed, deposit_bypass_reason, receipt_only, owners(first_name, last_name)",
          )
          .order("created_at", { ascending: false }),
        supabase.from("invoice_payments").select("invoice_id"),
      ]);
      if (invoicesRes.error) throw invoicesRes.error;
      if (paymentsRes.error) throw paymentsRes.error;

      const invoicesWithPayments = new Set(
        (paymentsRes.data ?? []).map((p) => p.invoice_id),
      );

      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      const eobToday = new Date(startOfToday);
      eobToday.setHours(18, 0, 0, 0);

      const toRow = (r: AlertQueryRow): InvoiceAlertRow => {
        const due = r.due_date ? new Date(`${r.due_date}T00:00:00`) : null;
        const daysOverdue =
          due && due < startOfToday
            ? Math.floor((startOfToday.getTime() - due.getTime()) / 86_400_000)
            : 0;
        return {
          id: r.id,
          invoice_number: r.invoice_number,
          owner_id: r.owner_id,
          owner_name: ownerDisplayName(r.owners?.first_name, r.owners?.last_name),
          service_type: r.service_type,
          total: r.total,
          amount_paid: Math.max(0, r.amount_paid ?? 0),
          status: r.status,
          due_date: r.due_date,
          created_at: r.created_at,
          days_overdue: daysOverdue,
          deposit_bypass_reason: r.deposit_bypass_reason,
        };
      };

      const rows = ((invoicesRes.data ?? []) as AlertQueryRow[]).filter((r) => !r.receipt_only);

      const staleDrafts = rows
        .filter((r) => r.status === "draft" && new Date(r.created_at) < eobToday)
        .map(toRow);

      const overdue = rows
        .filter((r) => {
          if (r.status === "overdue") return true;
          if (!UNPAID_STATUSES.includes(r.status)) return false;
          if (!r.due_date) return false;
          return new Date(`${r.due_date}T00:00:00`) < startOfToday;
        })
        .map(toRow);

      const depositBypassed = rows
        .filter((r) => r.deposit_bypassed && new Date(r.created_at) >= startOfToday)
        .map(toRow);

      const paidWithoutSettlement = rows
        .filter(
          (r) =>
            r.status === "paid" &&
            Math.max(0, r.amount_paid ?? 0) === 0 &&
            (r.total ?? 0) > 0 &&
            !invoicesWithPayments.has(r.id),
        )
        .map(toRow);

      const byOwner = new Map<string, MultipleUnpaidOwner>();
      for (const r of rows) {
        if (!UNPAID_STATUSES.includes(r.status)) continue;
        const outstanding = Math.max(0, r.total - Math.max(0, r.amount_paid ?? 0));
        const existing = byOwner.get(r.owner_id);
        if (existing) {
          existing.count += 1;
          existing.total_outstanding += outstanding;
        } else {
          byOwner.set(r.owner_id, {
            owner_id: r.owner_id,
            owner_name: ownerDisplayName(r.owners?.first_name, r.owners?.last_name),
            count: 1,
            total_outstanding: outstanding,
          });
        }
      }
      const multipleUnpaid = [...byOwner.values()].filter((o) => o.count >= 2);

      return {
        staleDrafts,
        overdue,
        depositBypassed,
        multipleUnpaid,
        paidWithoutSettlement,
      };
    },
  });
}
