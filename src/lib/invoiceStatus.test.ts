import { describe, expect, it } from "vitest";
import {
  invoiceBalanceDue,
  isInactiveInvoiceStatus,
  isLedgerOrphanInvoiceDeduction,
  isLedgerVoidedWalletRefund,
  isSoaInvoiceStatus,
  withoutSupersededInvoices,
} from "@/lib/invoiceStatus";

describe("invoiceStatus", () => {
  it("treats consolidated as inactive", () => {
    expect(isInactiveInvoiceStatus("consolidated")).toBe(true);
  });

  it("excludes draft from SOA ledger statuses", () => {
    expect(isSoaInvoiceStatus("draft")).toBe(false);
    expect(isSoaInvoiceStatus("voided")).toBe(false);
    expect(isSoaInvoiceStatus("outstanding")).toBe(true);
    expect(isSoaInvoiceStatus("paid")).toBe(true);
  });

  it("does not keep a draft wallet deduction as ledger debt", () => {
    expect(isLedgerOrphanInvoiceDeduction("deduction", "inv-1", "draft")).toBe(false);
    expect(isLedgerOrphanInvoiceDeduction("deduction", "inv-1", "paid")).toBe(false);
    expect(isLedgerOrphanInvoiceDeduction("deduction", "inv-1", "voided")).toBe(true);
    expect(isLedgerOrphanInvoiceDeduction("deduction", "inv-1", "consolidated")).toBe(true);
    expect(isLedgerOrphanInvoiceDeduction("deduction", "inv-1", "cancelled")).toBe(true);
  });

  it("includes a refund only when it reverses a voided wallet deduction", () => {
    expect(isLedgerVoidedWalletRefund("refund", "inv-1", "voided", true)).toBe(true);
    expect(isLedgerVoidedWalletRefund("refund", "inv-1", "cancelled", true)).toBe(true);
    expect(isLedgerVoidedWalletRefund("refund", "inv-1", "consolidated", true)).toBe(true);
    expect(isLedgerVoidedWalletRefund("refund", "inv-1", "voided", false)).toBe(false);
    expect(isLedgerVoidedWalletRefund("refund", "inv-1", "paid", true)).toBe(false);
    expect(isLedgerVoidedWalletRefund("refund", null, "voided", true)).toBe(false);
    expect(isLedgerVoidedWalletRefund("deduction", "inv-1", "voided", true)).toBe(false);
  });

  it("returns zero balance for consolidated invoices", () => {
    expect(invoiceBalanceDue("consolidated", 500, 0)).toBe(0);
    expect(invoiceBalanceDue("consolidated", 500, 100)).toBe(0);
  });

  it("computes balance for open invoices", () => {
    expect(invoiceBalanceDue("outstanding", 500, 100)).toBe(400);
  });

  it("does not treat opening_balance / wallet snapshot as paid", () => {
    // INV-2026-08169-shaped: wallet snapshot must not zero out outstanding.
    expect(invoiceBalanceDue("outstanding", 63, 0)).toBe(63);
    // INV-2026-06763-shaped without a real payment row for the deposit:
    expect(invoiceBalanceDue("partially_paid", 5694.15, 2847.5)).toBe(2846.65);
  });

  it("chains superseded status filters", () => {
    const calls: string[] = [];
    const query = {
      not: (column: string, operator: string, value: string) => {
        calls.push(`${column}.${operator}.${value}`);
        return query;
      },
    };
    withoutSupersededInvoices(query);
    expect(calls).toEqual(["status.in.(voided,consolidated)"]);
  });
});
