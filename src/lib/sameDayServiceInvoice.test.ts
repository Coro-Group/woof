import { describe, expect, it } from "vitest";
import {
  headerServiceTypeForMerge,
  isOpenSameDayMergeTarget,
  isSameDayMergeableService,
  MULTIPLE_SERVICES_LABEL,
  pickInvoiceLineForService,
  pickOpenSameDayInvoice,
} from "@/lib/sameDayServiceInvoice";

const serviceDate = "2026-11-24";

function invoice(overrides: Partial<Parameters<typeof isOpenSameDayMergeTarget>[0]> = {}) {
  return {
    id: "inv-1",
    status: "draft",
    amount_paid: 0,
    service_type: "daycare",
    due_date: serviceDate,
    booking_id: null,
    receipt_only: false,
    ...overrides,
  };
}

describe("same-day service invoice merge", () => {
  it("joins an open daycare invoice and leaves a paid one alone", () => {
    expect(isOpenSameDayMergeTarget(invoice(), serviceDate)).toBe(true);
    expect(isOpenSameDayMergeTarget(invoice({ status: "outstanding" }), serviceDate)).toBe(true);
    expect(isOpenSameDayMergeTarget(invoice({ status: "paid" }), serviceDate)).toBe(false);
    expect(isOpenSameDayMergeTarget(invoice({ status: "partially_paid" }), serviceDate)).toBe(false);
    expect(isOpenSameDayMergeTarget(invoice({ amount_paid: 40 }), serviceDate)).toBe(false);
    expect(isOpenSameDayMergeTarget(invoice({ status: "voided" }), serviceDate)).toBe(false);
    expect(isOpenSameDayMergeTarget(invoice({ status: "consolidated" }), serviceDate)).toBe(false);
  });

  it("does not merge boarding or package invoices", () => {
    expect(isSameDayMergeableService("daycare")).toBe(true);
    expect(isSameDayMergeableService("grooming")).toBe(true);
    expect(isSameDayMergeableService("retail")).toBe(true);
    expect(isSameDayMergeableService("transport")).toBe(true);
    expect(isSameDayMergeableService("boarding")).toBe(false);
    expect(isSameDayMergeableService("package")).toBe(false);
    expect(isSameDayMergeableService("daycare_package")).toBe(false);
    expect(isSameDayMergeableService("grooming_package")).toBe(false);
    expect(isOpenSameDayMergeTarget(invoice({ service_type: "boarding" }), serviceDate)).toBe(false);
    expect(isOpenSameDayMergeTarget(invoice({ service_type: "package" }), serviceDate)).toBe(false);
    expect(isOpenSameDayMergeTarget(invoice({ booking_id: "booking-1" }), serviceDate)).toBe(false);
    expect(isOpenSameDayMergeTarget(invoice({ due_date: "2026-11-25" }), serviceDate)).toBe(false);
  });

  it("picks the earliest open same-day invoice", () => {
    const paid = invoice({ id: "paid", status: "paid" });
    const open = invoice({ id: "open" });
    const later = invoice({ id: "later", status: "outstanding" });
    expect(pickOpenSameDayInvoice([paid, open, later], serviceDate)?.id).toBe("open");
    expect(pickOpenSameDayInvoice([paid], serviceDate)).toBeNull();
  });

  it("labels the header only when the services differ", () => {
    expect(headerServiceTypeForMerge("daycare", "grooming")).toBe(MULTIPLE_SERVICES_LABEL);
    expect(headerServiceTypeForMerge("daycare", "daycare")).toBe("daycare");
    expect(headerServiceTypeForMerge("daycare", "daycare_hourly_placeholder")).toBe("daycare");
    expect(headerServiceTypeForMerge(MULTIPLE_SERVICES_LABEL, "retail")).toBe(MULTIPLE_SERVICES_LABEL);
    expect(headerServiceTypeForMerge("grooming", "transport")).toBe(MULTIPLE_SERVICES_LABEL);
  });

  it("updates the grooming line on a combined invoice", () => {
    const lines = [
      { service_type: "daycare", description: "Daycare — Charlie — 24 Nov 2026" },
      { service_type: "grooming", description: "Full groom — Charlie — 24 Nov 2026" },
    ];
    expect(pickInvoiceLineForService(lines, "grooming", "Full groom — Charlie — 24 Nov 2026")?.service_type).toBe(
      "grooming",
    );
    expect(pickInvoiceLineForService(lines, "grooming", "different wording")?.description).toBe(
      "Full groom — Charlie — 24 Nov 2026",
    );
  });
});
