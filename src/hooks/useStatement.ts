import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isInactiveInvoiceStatus, isSoaInvoiceStatus } from "@/lib/invoiceStatus";
import { isOpenInvoiceStatus } from "@/lib/ownerBalances";
import { invoiceDisplayTotals } from "@/lib/vatConfig";
import { loadLedgerStatementClient } from "@/lib/ledgerStatementClient";
import {
  orphanWalletDeductions,
  syntheticWalletPaymentsFromDeductions,
} from "@/lib/walletDeductionPayments";
import { roundAed } from "@/lib/money";

export type StatementRow = {
  invoice_id: string;
  invoice_number: string | null;
  service_type: string | null;
  status: string;
  /** Remaining balance due (from RPC). */
  total: number;
  amount_paid?: number;
  created_at: string;
  due_date: string | null;
  days_overdue: number;
};

export type LedgerStatementRow = {
  row_id: string;
  created_at: string;
  amount: number;
  balance_after: number;
  is_opening_balance: boolean;
  is_visible: boolean;
  transaction_type: string;
  invoice_id: string | null;
  invoice_number: string | null;
  service_type: string | null;
  due_date: string | null;
  payment_method: string | null;
  notes: string | null;
};

function daysOverdueFor(dueDate: string | null, status: string): number {
  if (!dueDate) return 0;
  if (isInactiveInvoiceStatus(status)) return 0;
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due >= today) return 0;
  return Math.floor((today.getTime() - due.getTime()) / 86_400_000);
}

async function loadStatementDirect(ownerId: string): Promise<StatementRow[]> {
  const [invoicesRes, paymentsRes, deductionsRes] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, invoice_number, status, total, amount_paid, vat_aed, service_type, notes, created_at, due_date, receipt_only",
      )
      .eq("owner_id", ownerId)
      .or("receipt_only.is.null,receipt_only.eq.false")
      .order("created_at", { ascending: false }),
    supabase
      .from("invoice_payments")
      .select("invoice_id, amount, payment_method, created_at, wallet_transaction_id")
      .eq("owner_id", ownerId),
    supabase
      .from("wallet_transactions")
      .select("id, invoice_id, amount, created_at, notes, payment_method, transaction_type")
      .eq("owner_id", ownerId)
      .eq("transaction_type", "deduction")
      .not("invoice_id", "is", null),
  ]);
  if (invoicesRes.error) throw invoicesRes.error;
  if (paymentsRes.error) throw paymentsRes.error;
  if (deductionsRes.error) throw deductionsRes.error;

  const paymentRows = paymentsRes.data ?? [];
  const orphanDeductions = orphanWalletDeductions(
    paymentRows,
    deductionsRes.data ?? [],
  );
  const allPayments = [
    ...paymentRows,
    ...syntheticWalletPaymentsFromDeductions(orphanDeductions),
  ];

  const paidByInvoice = new Map<string, number>();
  for (const p of allPayments) {
    paidByInvoice.set(
      p.invoice_id,
      roundAed((paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount)),
    );
  }

  return (invoicesRes.data ?? [])
    .filter((r) => isSoaInvoiceStatus(r.status))
    .map((r) => {
      const gross = invoiceDisplayTotals({
        total: r.total,
        vat_aed: r.vat_aed,
        service_type: r.service_type,
        notes: r.notes,
      }).grandTotal;
      const fromPayments = paidByInvoice.get(r.id) ?? 0;
      const paid = roundAed(Math.max(fromPayments, Number(r.amount_paid ?? 0)));
      const remaining = Math.max(0, gross - paid);
      const status =
        remaining <= 0 && gross > 0
          ? "paid"
          : paid > 0 && remaining > 0
            ? "partially_paid"
            : r.status;
      return {
        invoice_id: r.id,
        invoice_number: r.invoice_number,
        service_type: r.service_type,
        status,
        total: remaining,
        amount_paid: paid,
        created_at: r.created_at,
        due_date: r.due_date,
        days_overdue: daysOverdueFor(r.due_date, status),
      };
    })
    .filter((r) => isOpenInvoiceStatus(r.status) && r.total > 0);
}

export const statementQueryKey = (ownerId?: string) => ["statement", ownerId] as const;

export const ledgerStatementQueryKey = (
  ownerId?: string,
  fromIso?: string,
  toIso?: string,
) => ["ledger_statement", ownerId, fromIso ?? null, toIso ?? null] as const;

export function useStatementOfAccount(ownerId?: string) {
  return useQuery({
    queryKey: statementQueryKey(ownerId),
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_statement_of_account", {
        p_owner_id: ownerId as string,
      });
      if (error) {
        return loadStatementDirect(ownerId as string);
      }
      return (data ?? []) as StatementRow[];
    },
  });
}

export function useLedgerStatement(ownerId?: string, fromIso?: string, toIso?: string) {
  return useQuery({
    queryKey: ledgerStatementQueryKey(ownerId, fromIso, toIso),
    enabled: !!ownerId && !!fromIso && !!toIso,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ledger_statement", {
        p_owner_id: ownerId as string,
        p_from: fromIso as string,
        p_to: toIso as string,
      });
      if (error) {
        return loadLedgerStatementClient(
          supabase,
          ownerId as string,
          fromIso as string,
          toIso as string,
        );
      }
      return (data ?? []) as LedgerStatementRow[];
    },
  });
}