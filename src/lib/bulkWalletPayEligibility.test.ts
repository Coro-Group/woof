import { describe, expect, it } from "vitest";
import type { StatementRow } from "@/hooks/useStatement";
import {
  bulkWalletPayableTotal,
  filterBulkWalletPayableInvoices,
  isFutureBoardingInvoice,
} from "./bulkWalletPayEligibility";

function row(partial: Partial<StatementRow> & Pick<StatementRow, "invoice_id">): StatementRow {
  return {
    invoice_number: "INV-1",
    service_type: "daycare",
    status: "outstanding",
    total: 100,
    created_at: "2026-08-01T00:00:00Z",
    due_date: "2026-08-01",
    days_overdue: 0,
    ...partial,
  };
}

describe("isFutureBoardingInvoice", () => {
  it("excludes boarding with due_date after today", () => {
    expect(
      isFutureBoardingInvoice(
        { service_type: "boarding", due_date: "2026-09-01" },
        "2026-08-15",
      ),
    ).toBe(true);
  });

  it("includes boarding due today or in the past", () => {
    expect(
      isFutureBoardingInvoice(
        { service_type: "boarding", due_date: "2026-08-15" },
        "2026-08-15",
      ),
    ).toBe(false);
    expect(
      isFutureBoardingInvoice(
        { service_type: "boarding", due_date: "2026-08-01" },
        "2026-08-15",
      ),
    ).toBe(false);
  });

  it("never excludes non-boarding even with future due_date", () => {
    expect(
      isFutureBoardingInvoice(
        { service_type: "daycare", due_date: "2026-09-01" },
        "2026-08-15",
      ),
    ).toBe(false);
  });

  it("does not exclude boarding without due_date", () => {
    expect(
      isFutureBoardingInvoice({ service_type: "boarding", due_date: null }, "2026-08-15"),
    ).toBe(false);
  });
});

describe("filterBulkWalletPayableInvoices", () => {
  it("keeps past boarding and non-boarding; drops future boarding", () => {
    const invoices = [
      row({ invoice_id: "a", service_type: "boarding", due_date: "2026-08-01", total: 200 }),
      row({ invoice_id: "b", service_type: "boarding", due_date: "2026-09-01", total: 500 }),
      row({ invoice_id: "c", service_type: "grooming", due_date: "2026-09-01", total: 80 }),
    ];
    const filtered = filterBulkWalletPayableInvoices(invoices, "2026-08-15");
    expect(filtered.map((i) => i.invoice_id)).toEqual(["a", "c"]);
    expect(bulkWalletPayableTotal(filtered)).toBe(280);
  });
});
