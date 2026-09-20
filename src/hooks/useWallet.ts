import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { invalidateOwnerStatementQueries } from "@/lib/statementQueryKeys";

type WalletTransaction = Database["public"]["Tables"]["wallet_transactions"]["Row"];
type TransactionType = Database["public"]["Enums"]["transaction_type"];
type PaymentMethod = Database["public"]["Enums"]["payment_method"];

export type { WalletTransaction };

export type WalletTopupResult = WalletTransaction & {
  /** wallet_topup_receipts.id — use this for /print/topup-receipt/:receiptId */
  receipt_id: string;
  receipt_number: string | null;
};

type CreditWalletTopupRpcResult = {
  success: boolean;
  wallet_transaction_id: string;
  receipt_id: string;
  receipt_number: string | null;
  balance_after: number;
  /** Amount of this top-up applied to open invoices (server-side). */
  auto_applied?: number;
  invoices_affected?: number;
};

// ── Query keys ────────────────────────────────────────────────────────────────

export const walletQueryKeys = {
  transactions: (ownerId: string) => ["wallet_transactions", ownerId] as const,
  topupReceipts: (ownerId: string) => ["wallet-topup-receipts", ownerId] as const,
  ownerBalance: (ownerId: string) => ["owners", ownerId, "balance"] as const,
};

export type WalletTopupReceipt =
  Database["public"]["Tables"]["wallet_topup_receipts"]["Row"];

// ── Shared mutation payload ───────────────────────────────────────────────────

export type WalletMutationPayload = {
  owner_id: string;
  /** Absolute value — sign is applied automatically per mutation type */
  amount: number;
  notes?: string | null;
  payment_method?: PaymentMethod | null;
  staff_id?: string | null;
  reference_id?: string | null;
  reference_type?: string | null;
  /** Staff name that issued a top-up; recorded on the wallet_topup_receipt. */
  issued_by?: string | null;
};

/** Atomic wallet credit via Postgres RPC — transaction, receipt, and balance update. */
async function creditWalletTopup(
  payload: WalletMutationPayload,
  transaction_type: "top_up" | "manual_topup",
): Promise<WalletTopupResult> {
  const performedBy = payload.issued_by?.trim() || "reception";
  const amount = Math.abs(payload.amount);

  const { data, error } = await supabase.rpc("credit_wallet_topup", {
    p_owner_id: payload.owner_id,
    p_amount: amount,
    p_transaction_type: transaction_type,
    p_performed_by: performedBy,
    p_payment_method: payload.payment_method ?? undefined,
    p_notes: payload.notes ?? undefined,
    p_staff_id: payload.staff_id ?? undefined,
  });

  if (error) throw error;

  const result = data as CreditWalletTopupRpcResult | null;
  if (!result?.wallet_transaction_id || !result?.receipt_id) {
    throw new Error("Wallet top-up failed");
  }

  return {
    id: result.wallet_transaction_id,
    owner_id: payload.owner_id,
    transaction_type,
    amount,
    // Post-auto-apply wallet balance (incoming top-up minus amounts applied to invoices).
    balance_after: result.balance_after,
    notes: payload.notes ?? null,
    payment_method: payload.payment_method ?? null,
    staff_id: payload.staff_id ?? null,
    performed_by: performedBy,
    reference_id: payload.reference_id ?? null,
    reference_type: payload.reference_type ?? null,
    invoice_id: null,
    service_type: null,
    created_at: new Date().toISOString(),
    receipt_id: result.receipt_id,
    receipt_number: result.receipt_number,
  };
}

function seedTopupReceiptCache(
  queryClient: ReturnType<typeof useQueryClient>,
  variables: WalletMutationPayload,
  result: WalletTopupResult,
) {
  const row: WalletTopupReceipt = {
    id: result.receipt_id,
    owner_id: variables.owner_id,
    wallet_transaction_id: result.id,
    amount: result.amount,
    issued_by: result.performed_by?.trim() || "reception",
    receipt_number: result.receipt_number,
    issued_at: result.created_at,
    notes: variables.notes ?? null,
  };
  queryClient.setQueryData<WalletTopupReceipt[]>(
    walletQueryKeys.topupReceipts(variables.owner_id),
    (old) => {
      if (!old) return [row];
      return [row, ...old.filter((r) => r.id !== row.id)];
    },
  );
}

function invalidateWalletQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  ownerId: string,
  options?: { includeOwnerWallet?: boolean },
) {
  queryClient.invalidateQueries({
    queryKey: walletQueryKeys.transactions(ownerId),
  });
  queryClient.invalidateQueries({
    queryKey: walletQueryKeys.topupReceipts(ownerId),
  });
  queryClient.invalidateQueries({ queryKey: ["owners"] });
  // Top-ups may auto-apply to open invoices — refresh invoice lists too.
  queryClient.invalidateQueries({ queryKey: ["invoices"] });
  invalidateOwnerStatementQueries(queryClient, ownerId);
  if (options?.includeOwnerWallet) {
    queryClient.invalidateQueries({ queryKey: ["owner_wallet", ownerId] });
  }
}

// ── Internal helper: fetch current balance, insert transaction, update owner ──

async function applyTransaction(
  payload: WalletMutationPayload,
  transaction_type: TransactionType,
  /** positive = credit, negative = debit */
  signed_amount: number
): Promise<WalletTransaction> {
  // 1. Read current balance
  const { data: owner, error: ownerErr } = await supabase
    .from("owners")
    .select("wallet_balance")
    .eq("id", payload.owner_id)
    .single();

  if (ownerErr) throw ownerErr;

  const current = owner.wallet_balance ?? 0;
  const balance_after = Math.round((current + signed_amount) * 100) / 100;

  // 2. Insert transaction row
  const { data: tx, error: txErr } = await supabase
    .from("wallet_transactions")
    .insert({
      owner_id: payload.owner_id,
      transaction_type,
      amount: signed_amount,
      balance_after,
      notes: payload.notes ?? null,
      payment_method: payload.payment_method ?? null,
      staff_id: payload.staff_id ?? null,
      reference_id: payload.reference_id ?? null,
      reference_type: payload.reference_type ?? null,
      performed_by: payload.issued_by?.trim() || null,
    })
    .select()
    .single();

  if (txErr) throw txErr;

  // 3. Update owner's wallet balance
  const { error: updateErr } = await supabase
    .from("owners")
    .update({ wallet_balance: balance_after })
    .eq("id", payload.owner_id);

  if (updateErr) throw updateErr;

  return tx as WalletTransaction;
}

// ── EnrichedWalletTransaction ─────────────────────────────────────────────────

/** A wallet transaction row augmented with joined invoice metadata. */
export type EnrichedWalletTransaction = WalletTransaction & {
  invoices: { invoice_number: string | null; service_type: string | null; issue_date: string | null } | null;
};

/** Transaction types that represent money credited to the wallet (positive flows). */
const CREDIT_TYPES: TransactionType[] = ["top_up", "manual_topup", "refund"];

export function isWalletCredit(tx: Pick<WalletTransaction, "transaction_type" | "amount">): boolean {
  return (CREDIT_TYPES as string[]).includes(tx.transaction_type) || tx.amount > 0;
}

// ── useStatementLedger ────────────────────────────────────────────────────────

export const statementLedgerQueryKey = (
  ownerId: string,
  from?: string,
  to?: string,
) => ["statement_ledger", ownerId, from ?? null, to ?? null] as const;

/**
 * Fetches wallet transactions enriched with invoice metadata for the
 * bank-statement style ledger view. Ordered newest-first.
 */
export function useStatementLedger(ownerId?: string, from?: string, to?: string) {
  return useQuery({
    queryKey: statementLedgerQueryKey(ownerId ?? "", from, to),
    enabled: !!ownerId,
    queryFn: async () => {
      let q = supabase
        .from("wallet_transactions")
        .select("*, invoices(invoice_number, service_type, issue_date)")
        .eq("owner_id", ownerId as string)
        .order("created_at", { ascending: false });

      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EnrichedWalletTransaction[];
    },
  });
}

// ── useWalletTransactions ─────────────────────────────────────────────────────

export function useWalletTransactions(ownerId: string) {
  return useQuery({
    queryKey: walletQueryKeys.transactions(ownerId),
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as WalletTransaction[];
    },
  });
}

// ── useWalletTopupReceipts ────────────────────────────────────────────────────

export function useWalletTopupReceipts(ownerId: string) {
  return useQuery({
    queryKey: walletQueryKeys.topupReceipts(ownerId),
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_topup_receipts")
        .select("*")
        .eq("owner_id", ownerId)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WalletTopupReceipt[];
    },
  });
}

// ── useTopUpWallet ────────────────────────────────────────────────────────────

/** Credits the wallet. `amount` must be a positive number. */
export function useTopUpWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: WalletMutationPayload) =>
      creditWalletTopup(payload, "top_up"),
    onSuccess: (data, variables) => {
      seedTopupReceiptCache(queryClient, variables, data);
      invalidateWalletQueries(queryClient, variables.owner_id);
    },
  });
}

// ── useDeductWallet ───────────────────────────────────────────────────────────

/** Debits the wallet. `amount` may be positive or negative — sign is forced negative. */
export function useDeductWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: WalletMutationPayload) =>
      applyTransaction(payload, "deduction", -Math.abs(payload.amount)),
    onSuccess: (_data, variables) => {
      invalidateWalletQueries(queryClient, variables.owner_id);
    },
  });
}

// ── useMembershipFee ──────────────────────────────────────────────────────────

/** Debits a membership fee. `amount` may be positive or negative — sign is forced negative. */
export function useMembershipFee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: WalletMutationPayload) =>
      applyTransaction(payload, "membership_fee", -Math.abs(payload.amount)),
    onSuccess: (_data, variables) => {
      invalidateWalletQueries(queryClient, variables.owner_id);
    },
  });
}

// ── useRefundWallet ───────────────────────────────────────────────────────────

/** Credits a refund. Exported for completeness — mirrors top_up but typed as refund. */
export function useRefundWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: WalletMutationPayload) =>
      applyTransaction(payload, "refund", Math.abs(payload.amount)),
    onSuccess: (_data, variables) => {
      invalidateWalletQueries(queryClient, variables.owner_id);
    },
  });
}

// ── useManualTopUpWallet ──────────────────────────────────────────────────────

/** Staff manual credit from customer profile (amount + reason/note). */
export function useManualTopUpWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: WalletMutationPayload) =>
      creditWalletTopup(payload, "manual_topup"),
    onSuccess: (data, variables) => {
      seedTopupReceiptCache(queryClient, variables, data);
      invalidateWalletQueries(queryClient, variables.owner_id, {
        includeOwnerWallet: true,
      });
    },
  });
}
