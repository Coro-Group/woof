import { describe, expect, it } from "vitest";
import {
  computePeriodTotals,
  deriveOwnerBalances,
  canPayAllFromWalletBalance,
} from "@/lib/ownerBalances";
import type { StatementRow } from "@/hooks/useStatement";

function openInv(total: number, status = "outstanding"): StatementRow {
  return {
    invoice_id: "x",
    invoice_number: "INV",
    service_type: "boarding",
    status,
    total,
    created_at: "2026-01-01",
    due_date: "2026-01-01",
    days_overdue: 0,
  };
}

describe("deriveOwnerBalances (MSH-style net)", () => {
  it("nets wallet_balance minus open invoice remainders", () => {
    const b = deriveOwnerBalances(1814.9, [openInv(588)]);
    expect(b.netPosition).toBe(1226.9);
    expect(b.invoiceRemainingTotal).toBe(588);
    expect(b.outstandingDebt).toBe(0);
    expect(b.combinedWallet).toBe(1814.9);
    expect(b.canPayAll).toBe(true);
  });

  it("shows negative net when open invoices exceed wallet", () => {
    const b = deriveOwnerBalances(100, [openInv(588)]);
    expect(b.netPosition).toBe(-488);
    expect(b.outstandingDebt).toBe(488);
    expect(b.invoiceRemainingTotal).toBe(588);
    expect(b.canPayAll).toBe(false);
    expect(b.combinedWallet).toBe(100);
  });

  it("ignores paid statuses in the open-invoice sum", () => {
    const b = deriveOwnerBalances(500, [
      openInv(200, "paid"),
      openInv(50, "outstanding"),
    ]);
    expect(b.invoiceRemainingTotal).toBe(50);
    expect(b.netPosition).toBe(450);
  });
});

describe("canPayAllFromWalletBalance", () => {
  it("requires wallet cash to cover open remainders", () => {
    expect(canPayAllFromWalletBalance(588, 588)).toBe(true);
    expect(canPayAllFromWalletBalance(587.99, 588)).toBe(false);
    expect(canPayAllFromWalletBalance(1000, 0)).toBe(false);
  });
});

describe("computePeriodTotals", () => {
  it("chains balances over visible rows so debits reconcile with net movement", () => {
    const rows = [
      {
        row_id: "opening",
        amount: 0,
        balance_after: 287,
        is_opening_balance: true,
        is_visible: true,
      },
      {
        row_id: "inv:1",
        amount: -105,
        balance_after: 182,
        is_opening_balance: false,
        is_visible: true,
      },
      {
        row_id: "inv:2",
        amount: -126,
        balance_after: 56,
        is_opening_balance: false,
        is_visible: true,
      },
    ];

    const totals = computePeriodTotals(rows);
    expect(totals.opening).toBe(287);
    expect(totals.closing).toBe(56);
    expect(totals.credits).toBe(0);
    expect(totals.debits).toBe(231);
    expect(totals.netMovement).toBe(-231);
    expect(totals.netMovement).toBe(totals.credits - totals.debits);
  });

  it("skips stale hidden wallet-payment rows from credit/debit summaries", () => {
    const rows = [
      {
        row_id: "opening",
        amount: 0,
        balance_after: 500,
        is_opening_balance: true,
        is_visible: true,
      },
      {
        row_id: "inv:1",
        amount: -63,
        balance_after: 437,
        is_opening_balance: false,
        is_visible: true,
      },
      {
        // Wallet payments no longer reach the ledger; guard against stale rows.
        row_id: "pay:hidden-wallet",
        amount: 63,
        balance_after: 437,
        is_opening_balance: false,
        is_visible: false,
      },
    ];

    const totals = computePeriodTotals(rows);
    expect(totals.credits).toBe(0);
    expect(totals.debits).toBe(63);
    expect(totals.closing).toBe(437);
    expect(totals.netMovement).toBe(-63);
  });
});
