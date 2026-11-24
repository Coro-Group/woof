import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { invoiceDisplayTotals } from "@/lib/vatConfig";
import { invoiceMatchesServiceFilter, MULTIPLE_SERVICES_LABEL } from "@/lib/sameDayServiceInvoice";

type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];

export interface UseInvoicesFilters {
  ownerId?: string;
  /** Partial match on invoice_number (e.g. "04647" or "INV-2026-04647"). */
  invoiceNumber?: string;
  status?: InvoiceStatus[];
  from?: string;
  to?: string;
  serviceType?: string;
}

export interface InvoiceSummary {
  id: string;
  invoice_number: string | null;
  branch_code: string | null;
  owner_id: string;
  owner_name: string;
  owner_phone: string | null;
  service_type: string | null;
  status: InvoiceStatus;
  total: number;  // grand total incl. VAT for display
  amount_paid: number;
  due_date: string | null;
  created_at: string;
  days_overdue: number;
}

const UNPAID: InvoiceStatus[] = ["partially_paid", "outstanding", "overdue"];

function deriveBranchCodeFromInvoiceNumber(invoiceNumber: string | null): string | null {
  const normalized = invoiceNumber?.trim();
  if (!normalized) return null;
  const match = normalized.match(/^([A-Za-z]{2,8})[-/]/);
  return match ? match[1].toUpperCase() : null;
}

export function useInvoices(filters: UseInvoicesFilters = {}) {
  return useQuery({
    queryKey: ["invoices", "list", filters],
    queryFn: async () => {
      const invoiceSelect =
        "id, invoice_number, owner_id, service_type, status, total, vat_aed, amount_paid, due_date, created_at, owners(first_name, last_name, phone)";
      const serviceFilter = filters.serviceType && filters.serviceType !== "all" ? filters.serviceType : null;

      let q = supabase
        .from("invoices")
        .select(
          serviceFilter && serviceFilter !== MULTIPLE_SERVICES_LABEL
            ? `${invoiceSelect}, invoice_line_items(service_type)`
            : invoiceSelect,
        )
        // Wallet top-up receipts are receipt-only and never appear in invoice lists.
        .or("receipt_only.is.null,receipt_only.eq.false")
        .order("created_at", { ascending: false });
      if (filters.ownerId) q = q.eq("owner_id", filters.ownerId);
      const invoiceNumber = filters.invoiceNumber?.trim();
      if (invoiceNumber) {
        // Escape LIKE wildcards so staff can paste full numbers safely.
        const pattern = `%${invoiceNumber.replace(/([\\%_])/g, "\\$1")}%`;
        q = q.ilike("invoice_number", pattern);
      }
      if (filters.status?.length) q = q.in("status", filters.status);
      if (filters.from) q = q.gte("created_at", `${filters.from}T00:00:00`);
      if (filters.to) q = q.lte("created_at", `${filters.to}T23:59:59`);
      if (serviceFilter === MULTIPLE_SERVICES_LABEL) {
        q = q.eq("service_type", serviceFilter);
      } else if (serviceFilter) {
        q = q.or(`service_type.eq.${serviceFilter},service_type.eq."${MULTIPLE_SERVICES_LABEL}"`);
      }

      const { data, error } = await q;

      if (error) throw error;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      type InvoiceListRow = {
        id: string;
        invoice_number: string | null;
        owner_id: string;
        service_type: string | null;
        status: InvoiceStatus;
        total: number;
        vat_aed: number | null;
        amount_paid: number | null;
        due_date: string | null;
        created_at: string;
        owners: { first_name: string | null; last_name: string | null; phone: string | null } | null;
        invoice_line_items?: { service_type: string | null }[] | null;
      };

      return ((data ?? []) as InvoiceListRow[])
        .filter((row) =>
          serviceFilter
            ? invoiceMatchesServiceFilter(
                row.service_type,
                (row.invoice_line_items ?? []).map((line) => line.service_type),
                serviceFilter,
              )
            : true,
        )
        .map((row) => {
        const owner = row.owners;
        const dueDate = row.due_date ? new Date(`${row.due_date}T00:00:00`) : null;
        let daysOverdue = 0;
        if (dueDate && UNPAID.includes(row.status)) {
          const diffMs = today.getTime() - dueDate.getTime();
          daysOverdue = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
        }

        const grand = invoiceDisplayTotals({
          total: row.total,
          vat_aed: row.vat_aed,
          service_type: row.service_type,
        }).grandTotal;
        return {
          id: row.id,
          invoice_number: row.invoice_number,
          branch_code: deriveBranchCodeFromInvoiceNumber(row.invoice_number),
          owner_id: row.owner_id,
          owner_name: ownerDisplayName(owner?.first_name, owner?.last_name),
          owner_phone: owner?.phone ?? null,
          service_type: row.service_type,
          status: row.status,
          total: grand,
          amount_paid: Math.max(0, row.amount_paid ?? 0),
          due_date: row.due_date,
          created_at: row.created_at,
          days_overdue: daysOverdue,
        } satisfies InvoiceSummary;
      });
    },
  });
}

export function useInvoiceKpis(invoices: InvoiceSummary[]) {
  return useMemo(() => {
    const now = new Date();
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const in7Days = new Date(now);
    in7Days.setDate(now.getDate() + 7);

    const outstandingTotal = invoices
      .filter((i) => UNPAID.includes(i.status))
      .reduce((sum, i) => sum + Math.max(0, i.total - i.amount_paid), 0);

    const overdueCount = invoices.filter((i) => i.status === "overdue" || i.days_overdue > 0).length;

    const dueSoonCount = invoices.filter((i) => {
      if (!i.due_date) return false;
      if (!UNPAID.includes(i.status)) return false;
      const due = new Date(`${i.due_date}T00:00:00`);
      return due >= now && due <= in7Days;
    }).length;

    const collectedThisMonth = invoices
      .filter((i) => i.status === "paid" && new Date(i.created_at) >= startMonth)
      .reduce((sum, i) => sum + i.total, 0);

    return { outstandingTotal, overdueCount, dueSoonCount, collectedThisMonth };
  }, [invoices]);
}

export type InvoiceDeletionLogRow = Database["public"]["Tables"]["invoice_deletion_log"]["Row"];

export function useInvoiceDeletionLog() {
  return useQuery({
    queryKey: ["invoices", "deletion-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_deletion_log")
        .select("id, invoice_id, owner_name, total_amount, deleted_by, deleted_at, reason")
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Pick<
        InvoiceDeletionLogRow,
        "id" | "invoice_id" | "owner_name" | "total_amount" | "deleted_by" | "deleted_at" | "reason"
      >[];
    },
  });
}
