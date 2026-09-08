import { roundAed } from "@/lib/money";
import type { StatementRow } from "@/hooks/useStatement";

/** Collectable open invoice statuses (woof Phase 2 model). */
export const OPEN_INVOICE_STATUSES = [
  "outstanding",
  "overdue",
  "partially_paid",
] as const;

export type LedgerRowLike = {
  amount: number;
  balance_after: number;
  is_opening_balance?: boolean;
  /** When false, row affects balance but is omitted from credit/debit summaries (wallet payments). */
  is_visible?: boolean;
};

export function isOpenInvoiceStatus(status: string): boolean {
  return (OPEN_INVOICE_STATUSES as readonly string[]).includes(status);
}

/** Last ledger row balance_after — positive = credit ahead, negative = owes. */
export function closingKFromLedger(rows: LedgerRowLike[]): number {
  if (rows.length === 0) return 0;
  const last = rows[rows.length - 1];
  return roundAed(last.balance_after);
}

/** Spendable wallet credit from SOA K. */
export function spendableWalletFromK(k: number): number {
  return roundAed(Math.max(0, k));
}

/** Debt when K is negative. */
export function outstandingDebtFromK(k: number): number {
  return roundAed(Math.max(0, -k));
}

export function invoiceRemainingTotal(invoices: StatementRow[]): number {
  return roundAed(
    invoices
      .filter((inv) => isOpenInvoiceStatus(inv.status))
      .reduce((sum, inv) => sum + Math.max(0, inv.total), 0),
  );
}

/** True when raw wallet cash can cover all open invoice remainders (MSH-style). */
export function canPayAllFromWalletBalance(
  walletBalance: number,
  invoiceRemaining: number,
): boolean {
  if (invoiceRemaining <= 0) return false;
  return roundAed(Math.max(0, walletBalance)) >= invoiceRemaining;
}

/** @deprecated Prefer canPayAllFromWalletBalance — K is no longer the headline balance. */
export function canPayAllFromWallet(k: number, invoiceRemaining: number): boolean {
  return canPayAllFromWalletBalance(spendableWalletFromK(k), invoiceRemaining);
}

export type OwnerBalanceSnapshot = {
  /**
   * MSH-style net position: owners.wallet_balance − open invoice remainders.
   * Positive = credit ahead; negative = owes. Not ledger closing K.
   */
  netPosition: number;
  /** Spendable cash from owners.wallet_balance (max 0). */
  wallet: number;
  /** max(0, −netPosition) — shortfall when open invoices exceed wallet. */
  outstandingDebt: number;
  /** Alias for outstandingDebt (admin-essentials naming). */
  outstanding: number;
  /** Alias for wallet — used by pay-from-wallet eligibility UI. */
  combinedWallet: number;
  invoiceRemainingTotal: number;
  canPayAll: boolean;
};

/**
 * Headline balances for profile / statement / pay eligibility.
 * Uses owners.wallet_balance and open-invoice remainders (same formula as
 * getAccountBalance / MSH Net Position) — not get_ledger_statement closing K.
 */
export function deriveOwnerBalances(
  walletBalance: number,
  openInvoices: StatementRow[],
): OwnerBalanceSnapshot {
  const invoiceRemaining = invoiceRemainingTotal(openInvoices);
  const wallet = roundAed(Math.max(0, walletBalance));
  const netPosition = roundAed(walletBalance - invoiceRemaining);
  /** Net shortfall when wallet cannot cover open invoices (matches |net| when net < 0). */
  const outstandingDebt = roundAed(Math.max(0, -netPosition));
  return {
    netPosition,
    wallet,
    outstandingDebt,
    outstanding: outstandingDebt,
    combinedWallet: wallet,
    invoiceRemainingTotal: invoiceRemaining,
    canPayAll: canPayAllFromWalletBalance(walletBalance, invoiceRemaining),
  };
}

export type PeriodTotals = {
  opening: number;
  credits: number;
  debits: number;
  netMovement: number;
  closing: number;
};

/** Period stats: visible credits/debits; net movement always reconciles to closing K. */
export function computePeriodTotals(rows: LedgerRowLike[]): PeriodTotals {
  const openingRow = rows.find((r) => r.is_opening_balance);
  const opening = roundAed(openingRow?.balance_after ?? 0);
  const movementRows = rows.filter((r) => !r.is_opening_balance);

  let credits = 0;
  let debits = 0;
  for (const row of movementRows) {
    if (row.is_visible === false) continue;
    if (row.amount > 0) credits += row.amount;
    else if (row.amount < 0) debits += Math.abs(row.amount);
  }

  credits = roundAed(credits);
  debits = roundAed(debits);
  const closing =
    movementRows.length > 0
      ? roundAed(movementRows[movementRows.length - 1].balance_after)
      : opening;

  return {
    opening,
    credits,
    debits,
    netMovement: roundAed(closing - opening),
    closing,
  };
}
