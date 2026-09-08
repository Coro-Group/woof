import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { invalidateServiceRatesQueries } from "@/lib/billingQueryKeys";
import {
  useRefundWallet,
  walletQueryKeys,
  type WalletMutationPayload,
} from "@/hooks/useWallet";
import {
  invoicePaymentMethodToTransactionType,
} from "@/lib/paymentMethod";
import { invoiceDueDateToday } from "@/lib/invoiceDueDate";
import {
  invoiceAmountDue,
  invoiceDisplayTotals,
  netFromGrossInclusive,
  vatAmountFromGrossInclusive,
} from "@/lib/vatConfig";
import { formatAed, roundAed, AED_DECIMAL_DIGITS } from "@/lib/money";
import { payInvoiceFromWallet } from "@/lib/walletInvoicePayment";
import { invalidateOwnerStatementQueries } from "@/lib/statementQueryKeys";
import { deriveOwnerBalances } from "@/lib/ownerBalances";
import { useStatementOfAccount } from "@/hooks/useStatement";
import {
  recordExternalInvoicePayment,
  type DuplicatePaymentInfo,
} from "@/lib/recordExternalInvoicePayment";

// ── Types ────────────────────────────────────────────────────────────────────

export type InvoiceStatus =
  | "draft"
  | "finalised"
  | "issued"
  | "paid"
  | "partially_paid"
  | "outstanding"
  | "overdue"
  | "voided"
  | "consolidated"
  | "cancelled";

export type PaymentMethod = import("@/lib/paymentMethod").PaymentMethod;

export type ServiceType =
  | "boarding"
  | "grooming"
  | "daycare"
  | "transport"
  | "membership"
  | "package"
  | "adjustment";

export type AdjustmentType =
  | "price_override"
  | "refund_override"
  | "discount_override"
  | "fee_waived"
  | "goodwill_credit"
  | "cancellation_refund";

export interface LineItem {
  pricingKey: string;
  label: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface BillingBreakdown {
  lineItems: LineItem[];
  subtotal: number;
  discountPct: number;
  discountAed: number;
  total: number;
  memberType: string;
}

export interface LineItemRow {
  id: string;
  pricing_key: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  /** Mapped from total_price — the DB column is total_price */
  line_total: number;
  sort_order: number;
}

export interface InvoiceWithItems {
  id: string;
  invoice_number: string | null;
  branch_code: string | null;
  owner_id: string;
  service_type: string | null;
  service_id: string | null;
  status: InvoiceStatus;
  subtotal: number;
  discount_pct: number;
  discount_amount: number;
  /** Stored total is gross incl. VAT for package/daycare; see vatConfig for display/charge rules. */
  total: number;
  vat_aed: number | null;
  // TODO: deprecate after invoice_payments migration
  payment_method: PaymentMethod | null;
  /** Effective method: most recent invoice_payments row, else invoices.payment_method. */
  paymentMethod: PaymentMethod | null;
  // TODO: deprecate after invoice_payments migration
  amount_paid?: number;
  paid_at: string | null;
  due_date: string | null;
  notes: string | null;
  voided_at: string | null;
  voided_reason: string | null;
  created_at: string;
  line_items: LineItemRow[];
  booking_ref: string | null;
  booking_check_in: string | null;
  booking_check_out: string | null;
}

export interface StatementRow {
  invoice_id: string;
  invoice_number: string | null;
  service_type: string | null;
  status: string;
  total: number;
  amount_paid?: number;
  created_at: string;
  due_date: string | null;
  days_overdue: number;
}

export interface BillingAdjustment {
  id: string;
  owner_id: string;
  booking_id: string | null;
  invoice_id: string | null;
  adjustment_type: string;
  original_amount: number | null;
  adjusted_amount: number | null;
  reason: string;
  approved_by: string;
  created_at: string;
}

export interface CancellationRefund {
  hoursNotice: number;
  refundPct: number;
  refundAed: number;
  overrideActive: boolean;
  policyLabel: string;
}

// ── Formatting helper ────────────────────────────────────────────────────────

export { formatAed, roundAed, AED_DECIMAL_DIGITS };

function deriveBranchCodeFromInvoiceNumber(invoiceNumber: string | null): string | null {
  const normalized = invoiceNumber?.trim();
  if (!normalized) return null;
  const match = normalized.match(/^([A-Za-z]{2,8})[-/]/);
  return match ? match[1].toUpperCase() : null;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const billingKeys = {
  pricing: () => ["pricing"] as const,
  invoices: (ownerId: string, filters?: Record<string, string>) =>
    ["invoices", ownerId, filters ?? {}] as const,
  statement: (ownerId: string) => ["statement", ownerId] as const,
  adjustments: (ownerId?: string) =>
    ["billing_adjustments", ownerId ?? "all"] as const,
  cancellationRefund: (
    ownerId: string | null,
    invoiceId: string | null,
    serviceStart: string | null,
  ) => ["cancellation_refund", ownerId, invoiceId, serviceStart] as const,
};

function invalidateAfterInvoicePayment(
  queryClient: ReturnType<typeof useQueryClient>,
  ownerId?: string,
) {
  queryClient.invalidateQueries({ queryKey: ["invoices"] });
  queryClient.invalidateQueries({ queryKey: ["wallet_transactions"] });
  queryClient.invalidateQueries({ queryKey: ["owners"] });
  if (!ownerId) return;
  invalidateOwnerStatementQueries(queryClient, ownerId);
  queryClient.invalidateQueries({ queryKey: billingKeys.statement(ownerId) });
  queryClient.invalidateQueries({ queryKey: billingKeys.invoices(ownerId) });
  queryClient.invalidateQueries({ queryKey: ["owners", ownerId] });
}

export { invalidateOwnerStatementQueries };

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 1: usePricing
// ═══════════════════════════════════════════════════════════════════════════════

interface PricingRow {
  id: string;
  key: string;
  amount_aed: number;
  /** Display name for the rate (DB column `label`; UI calls this "Item name"). */
  label: string;
  category: string;
  updated_at: string;
}

export type PricingItemInput = {
  key: string;
  label: string;
  category: string;
  amount_aed: number;
};

function pricingRowPayload(item: PricingItemInput) {
  const key = item.key.trim();
  const [serviceCode, petSizeRaw, coatTypeRaw, seasonRaw] = key.split(":");
  return {
    service_code: serviceCode,
    pet_size: petSizeRaw && petSizeRaw !== "*" ? petSizeRaw : null,
    coat_type: coatTypeRaw && coatTypeRaw !== "*" ? coatTypeRaw : null,
    season: seasonRaw && seasonRaw !== "*" ? seasonRaw : null,
    amount_aed: item.amount_aed,
    updated_at: new Date().toISOString(),
    is_active: true,
  };
}

function throwPricingError(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message?.trim() || fallback);
}

export function usePricing() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: billingKeys.pricing(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_rates")
        .select(
          "id, service_code, amount_aed, pet_size, coat_type, season, updated_at, service_code_meta!inner(display_name)",
        )
        .eq("is_active", true)
        .order("service_code");
      if (error) throw error;
      return (data ?? []).map((r) => {
        const category = r.service_code.startsWith("boarding") || r.service_code === "board_and_train_night"
          ? "boarding"
          : r.service_code.startsWith("daycare")
            ? "daycare"
            : r.service_code.startsWith("grooming") || r.service_code.startsWith("cat_grooming")
              ? "grooming"
              : r.service_code.startsWith("addon")
                ? "addon"
                : r.service_code.startsWith("treadmill")
                  ? "treadmill"
                  : r.service_code.startsWith("assessment")
                    ? "assessment"
                    : "service";
        const key = `${r.service_code}:${r.pet_size ?? "*"}:${r.coat_type ?? "*"}:${r.season ?? "*"}`;
        return {
          id: r.id,
          key,
          amount_aed: r.amount_aed,
          label: r.service_code_meta?.display_name ?? r.service_code,
          category,
          updated_at: r.updated_at,
        } satisfies PricingRow;
      });
    },
  });

  const prices = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of query.data ?? []) map[r.key] = r.amount_aed;
    return map;
  }, [query.data]);

  const getPrice = (key: string): number => prices[key] ?? 0;

  const updatePrice = async (key: string, amount: number) => {
    const existing = (query.data ?? []).find((r) => r.key === key);
    if (!existing) throw new Error(`Rate not found for ${key}`);
    const { error } = await supabase
      .from("service_rates")
      .update({ amount_aed: amount, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw error;
    invalidateServiceRatesQueries(queryClient);
  };

  /** Update price, or insert the row when the key is not in the database yet. */
  const upsertPricingPrice = async (item: PricingItemInput) => {
    const [serviceCode] = item.key.trim().split(":");
    if (!serviceCode) throw new Error("Service code is required");
    const { error: metaError } = await supabase
      .from("service_code_meta")
      .upsert({
        service_code: serviceCode,
        display_name: item.label.trim() || serviceCode,
        unit: "each",
        applicable_species: ["dog"],
      } as never);
    if (metaError) throwPricingError(metaError, "Failed to save service code metadata");

    const { error } = await supabase
      .from("service_rates")
      .upsert(pricingRowPayload(item) as never, {
        onConflict: "service_code,pet_size,coat_type,season",
      });
    if (error) throwPricingError(error, "Failed to save pricing item");
    invalidateServiceRatesQueries(queryClient);
  };

  const updatePrices = async (updates: Record<string, number>) => {
    for (const [key, amount_aed] of Object.entries(updates)) {
      await updatePrice(key, amount_aed);
    }
    invalidateServiceRatesQueries(queryClient);
    toast.success("Pricing saved");
  };

  const createPricingItem = async (item: PricingItemInput) => {
    await upsertPricingPrice(item);
    toast.success("Pricing item added");
  };

  const deletePricingItem = async (key: string) => {
    const existing = (query.data ?? []).find((r) => r.key === key);
    if (!existing) return;
    const { error } = await supabase.from("service_rates").delete().eq("id", existing.id);
    if (error) throwPricingError(error, "Failed to delete pricing item");
    invalidateServiceRatesQueries(queryClient);
    toast.success("Pricing item deleted");
  };

  return {
    prices,
    allRows: query.data ?? [],
    getPrice,
    updatePrice,
    upsertPricingPrice,
    updatePrices,
    createPricingItem,
    deletePricingItem,
    isLoading: query.isLoading,
    error: query.error,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 1b: useServiceRates — aggregated view of all service rate tables
// ═══════════════════════════════════════════════════════════════════════════════

export interface GroomingRateRow { id: string; service: string; label: string; price_aed: number; duration_minutes: number | null; is_active: boolean }
export interface DaycarePackageTypeRow { id: string; name: string; total_days: number; num_dogs: number; base_price_aed: number; is_active: boolean; sort_order: number }
export interface AddonRateRow { id: string; addon_type: string; label: string; price_aed: number; unit: string; applicable_services: string[]; is_active: boolean }

export function useServiceRates() {
  const daycareQuery = useQuery({
    queryKey: ["package_definitions", "rates_view"],
    queryFn: async () => {
      const [{ data: defs, error: defsErr }, { data: pricing, error: pricingErr }] = await Promise.all([
        supabase
          .from("package_definitions")
          .select("id, display_name, validity_months, sort_order, is_active, category")
          .eq("category", "daycare")
          .order("sort_order"),
        supabase
          .from("package_pricing")
          .select("package_def_id, amount_aed")
          .eq("is_active", true),
      ]);
      if (defsErr) throw defsErr;
      if (pricingErr) throw pricingErr;

      return (defs ?? []).map((row) => {
        const packagePrices = (pricing ?? []).filter((p) => p.package_def_id === row.id).map((p) => p.amount_aed);
        const minPrice = packagePrices.length ? Math.min(...packagePrices) : 0;
        return {
          id: row.id,
          name: row.display_name,
          total_days: 0,
          num_dogs: 1,
          base_price_aed: minPrice,
          is_active: row.is_active,
          sort_order: row.sort_order,
        };
      }) as DaycarePackageTypeRow[];
    },
  });

  const addonQuery = useQuery({
    queryKey: ["addon_rates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_rates")
        .select("id, service_code, amount_aed, is_active, service_code_meta!inner(display_name)")
        .like("service_code", "addon_%")
        .eq("is_active", true)
        .order("service_code");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        addon_type: r.service_code,
        label: r.service_code_meta?.display_name ?? r.service_code,
        price_aed: r.amount_aed,
        unit: "each",
        applicable_services: ["grooming", "boarding"],
        is_active: r.is_active,
      })) as AddonRateRow[];
    },
  });

  const queryClient = useQueryClient();

  const updateAddonRate = async (id: string, price_aed: number) => {
    const { error } = await supabase
      .from("service_rates")
      .update({ amount_aed: price_aed, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    invalidateServiceRatesQueries(queryClient);
  };

  return {
    daycarePackageTypes: daycareQuery.data ?? [],
    addonRates: addonQuery.data ?? [],
    updateAddonRate,
    isLoading: daycareQuery.isLoading || addonQuery.isLoading,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 2: useCreateInvoice
// ═══════════════════════════════════════════════════════════════════════════════

interface CreateInvoiceInput {
  ownerId: string;
  serviceType: ServiceType;
  serviceId?: string;
  breakdown: BillingBreakdown;
  notes?: string;
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateInvoiceInput) => {
      const normalizedItems: LineItem[] = [];
      for (const li of input.breakdown.lineItems) {
        const qty = Math.max(1, li.quantity);
        const unitPrice = li.unitPrice;
        normalizedItems.push({
          ...li,
          quantity: qty,
          unitPrice,
          total: unitPrice * qty,
        });
      }

      const normalizedSubtotal = normalizedItems.reduce((sum, li) => sum + li.total, 0);
      const normalizedDiscountAed = 0;
      const normalizedDiscountPct = 0;
      const normalizedTotal = normalizedSubtotal;

      const grossTotal = Math.max(0, normalizedTotal);
      const vatAed = vatAmountFromGrossInclusive(grossTotal);
      const netExVat = netFromGrossInclusive(grossTotal);

      const dueDate = invoiceDueDateToday();

      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .insert({
          owner_id: input.ownerId,
          booking_id: input.serviceId ?? null,
          service_type: input.serviceType,
          status: "draft" as const,
          subtotal: normalizedSubtotal,
          
          discount_pct: normalizedDiscountPct,
          
          discount_amount: normalizedDiscountAed,
          total: grossTotal,
          vat_aed: vatAed,
          due_date: dueDate,
          notes: input.notes ?? null,
        })
        .select("id, invoice_number")
        .single();

      if (invErr) throw invErr;

      const lineRows = normalizedItems.map((li, i) => ({
        invoice_id: inv.id,
        description: li.label,
        quantity: li.quantity,
        unit_price: li.unitPrice,
        total_price: li.total,
        pricing_key: li.pricingKey ?? null,
        service_type: input.serviceType,
        sort_order: i,
      }));

      if (lineRows.length > 0) {
        const { error: liErr } = await supabase
          .from("invoice_line_items")
          .insert(lineRows);
        if (liErr) throw liErr;
      }

      return {
        invoiceId: inv.id as string,
        invoiceNumber: inv.invoice_number as string | null,
        total: grossTotal,
      };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["invoices", variables.ownerId],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create invoice");
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 4: useCollectPayment
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Replaces the old "Finalise" action. Zero-value invoices close directly to
 * `paid`; invoices with a balance are a no-op here — the caller opens
 * PaymentSplitDialog, which records payment and the DB trigger updates status.
 * `finalised` is never set by this path.
 */
export function useCollectPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      invoiceId,
      total,
      ownerId: _ownerId,
    }: {
      invoiceId: string;
      total: number;
      ownerId: string;
    }) => {
      if (total === 0) {
        const { data, error } = await supabase
          .from("invoices")
          .update({ status: "paid" as const, paid_at: new Date().toISOString() })
          .eq("id", invoiceId)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      // Balance owed — no status change here; PaymentSplitDialog handles payment.
      const { data, error } = await supabase
        .from("invoices")
        .select()
        .eq("id", invoiceId)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 5: useProcessPayment
// ═══════════════════════════════════════════════════════════════════════════════

interface ProcessPaymentInput {
  invoiceId: string;
  method: PaymentMethod;
  staffName: string;
  amountAed?: number;
  confirmDuplicate?: boolean;
}

interface ProcessPaymentResult {
  success: boolean;
  method: PaymentMethod;
  amountCharged: number;
  ownerId?: string;
  newWalletBalance?: number;
  error?: string;
  shortfall?: number;
  /** Set when a recent same-amount payment exists and was not confirmed. */
  duplicate?: DuplicatePaymentInfo;
}

export function useProcessPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: ProcessPaymentInput,
    ): Promise<ProcessPaymentResult> => {
      if (input.method === "wallet") {
        const result = await payInvoiceFromWallet(supabase, {
          invoiceId: input.invoiceId,
          performedBy: input.staffName,
        });

        if (result.success) {
          if (result.partial) {
            toast.success(
              `${formatAed(result.amountCharged)} deducted from wallet — ${formatAed(result.shortfall ?? 0)} still outstanding`,
            );
          } else {
            toast.success(`${formatAed(result.amountCharged)} deducted from wallet`);
          }
        } else {
          toast.error(
            result.error ??
              (result.shortfall
                ? `Insufficient balance — shortfall of ${formatAed(result.shortfall)}`
                : "Wallet payment failed"),
          );
        }

        return {
          success: result.success,
          method: "wallet",
          amountCharged: result.amountCharged,
          ownerId: result.ownerId,
          newWalletBalance: result.newWalletBalance,
          error: result.error,
          shortfall: result.shortfall,
        };
      }

      // External payment (card, cash, bank transfer, payment link)
      const result = await recordExternalInvoicePayment(supabase, {
        invoiceId: input.invoiceId,
        method: input.method,
        performedBy: input.staffName,
        amountAed: input.amountAed,
        confirmDuplicate: input.confirmDuplicate,
      });

      // Likely duplicate — let the caller confirm before retrying. Not an error.
      if (result.duplicate && !input.confirmDuplicate) {
        return {
          success: false,
          method: input.method,
          amountCharged: 0,
          duplicate: result.duplicate,
        };
      }

      if (!result.success) {
        toast.error(result.error ?? "Payment failed");
        return {
          success: false,
          method: input.method,
          amountCharged: 0,
          error: result.error,
        };
      }

      toast.success(
        result.partial
          ? `${formatAed(result.amountRecorded ?? 0)} recorded — balance still outstanding`
          : `${formatAed(result.amountRecorded ?? 0)} recorded — paid by ${input.method}`,
      );

      return {
        success: true,
        method: input.method,
        amountCharged: result.amountRecorded ?? 0,
        ownerId: result.ownerId,
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        invalidateAfterInvoicePayment(queryClient, result.ownerId);
      }
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 6: useVoidInvoice
// ═══════════════════════════════════════════════════════════════════════════════

interface VoidInvoiceInput {
  invoiceId: string;
  reason: string;
  refundAmount: number;
  staffName: string;
}

export function useVoidInvoice() {
  const queryClient = useQueryClient();
  const refundWallet = useRefundWallet();

  return useMutation({
    mutationFn: async (
      input: VoidInvoiceInput,
    ): Promise<{ success: boolean; refundAed: number }> => {
      const { data: invoice, error: fetchErr } = await supabase
        .from("invoices")
        .select("owner_id, total, vat_aed, service_type, notes")
        .eq("id", input.invoiceId)
        .single();
      if (fetchErr) throw fetchErr;

      const { error: voidErr } = await supabase
        .from("invoices")
        .update({
          status: "cancelled" as const,
          notes: input.reason,
        })
        .eq("id", input.invoiceId);
      if (voidErr) throw voidErr;

      if (input.refundAmount > 0) {
        const payload: WalletMutationPayload = {
          owner_id: invoice.owner_id,
          amount: input.refundAmount,
          notes: input.reason,
          reference_id: input.invoiceId,
          reference_type: "invoice_void",
        };
        await refundWallet.mutateAsync(payload);
      }

      await supabase.from("billing_adjustments").insert({
        owner_id: invoice.owner_id,
        invoice_id: input.invoiceId,
        adjustment_type: "cancellation_refund",
        original_amount: invoiceAmountDue({
          total: invoice.total,
          vat_aed: invoice.vat_aed,
          service_type: invoice.service_type,
          notes: invoice.notes,
        }),
        adjusted_amount: input.refundAmount,
        reason: input.reason,
        approved_by: input.staffName,
      });

      if (input.refundAmount > 0) {
        toast.success(
          `Invoice voided. ${formatAed(input.refundAmount)} refunded to wallet.`,
        );
      } else {
        toast.success("Invoice voided. No refund applied.");
      }

      return { success: true, refundAed: input.refundAmount };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["owners"] });
      queryClient.invalidateQueries({ queryKey: ["wallet_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["billing_adjustments"] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 7: useCalculateCancellationRefund
// ═══════════════════════════════════════════════════════════════════════════════

export function useCalculateCancellationRefund(
  ownerId: string | null,
  invoiceId: string | null,
  serviceStart: string | null,
): { data: CancellationRefund | null; isLoading: boolean } {
  const query = useQuery({
    queryKey: billingKeys.cancellationRefund(ownerId, invoiceId, serviceStart),
    enabled: !!ownerId && !!invoiceId && !!serviceStart,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "calculate_cancellation_refund",
        {
          p_owner_id: ownerId!,
          p_invoice_id: invoiceId!,
          p_service_start: serviceStart!,
        },
      );
      if (error) throw error;

      const row = (data as {
        hours_notice: number;
        refund_pct: number;
        refund_aed: number;
        override_active: boolean;
        policy_label: string;
      }[])?.[0];

      if (!row) return null;

      return {
        hoursNotice: row.hours_notice,
        refundPct: row.refund_pct,
        refundAed: row.refund_aed,
        overrideActive: row.override_active,
        policyLabel: row.policy_label,
      } satisfies CancellationRefund;
    },
  });

  return { data: query.data ?? null, isLoading: query.isLoading };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 8: useWalletTopUp — re-export from useWallet.ts
// ═══════════════════════════════════════════════════════════════════════════════

export { useTopUpWallet as useWalletTopUp } from "@/hooks/useWallet";

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 9: useOwnerBalances + useOwnerStatement
// ═══════════════════════════════════════════════════════════════════════════════

export function useOwnerBalances(ownerId: string) {
  const queryClient = useQueryClient();
  const statementQuery = useStatementOfAccount(ownerId);
  const ownerWalletQuery = useQuery({
    queryKey: ["owner_wallet", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owners")
        .select("wallet_balance")
        .eq("id", ownerId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const invoices = statementQuery.data ?? [];
  const walletBalance = ownerWalletQuery.data?.wallet_balance ?? 0;
  // MSH-style net: wallet_balance − open invoice remainders (not ledger K).
  const balances = deriveOwnerBalances(walletBalance, invoices);

  const payAllOutstanding = async (
    performedBy = "bulk_payment",
    options?: { invoiceIds?: string[] },
  ) => {
    let unpaid = [...invoices].sort((a, b) =>
      (a.due_date || a.created_at).localeCompare(b.due_date || b.created_at),
    );

    if (options?.invoiceIds) {
      const allow = new Set(options.invoiceIds);
      unpaid = unpaid.filter((inv) => allow.has(inv.invoice_id));
    }

    let cleared = 0;
    let totalDeducted = 0;

    for (const inv of unpaid) {
      const result = await payInvoiceFromWallet(supabase, {
        invoiceId: inv.invoice_id,
        performedBy,
      });

      if (!result.success) {
        toast.error(`Payment stopped: ${result.error ?? "Insufficient funds"}`);
        break;
      }

      cleared++;
      totalDeducted += result.amountCharged ?? 0;

      if (result.partial) {
        toast.message(
          `Partial payment applied — ${formatAed(result.amountCharged ?? 0)} deducted; wallet exhausted.`,
        );
        break;
      }
    }

    if (cleared > 0) {
      toast.success(
        `${cleared} invoice${cleared !== 1 ? "s" : ""} cleared — ${formatAed(totalDeducted)} deducted`,
      );
    }

    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    invalidateOwnerStatementQueries(queryClient, ownerId);
  };

  return {
    ...balances,
    balances,
    invoices,
    payAllOutstanding,
    isLoading: statementQuery.isLoading || ownerWalletQuery.isLoading,
    error: statementQuery.error || ownerWalletQuery.error,
  };
}

/** @deprecated Prefer useOwnerBalances — kept for existing call sites. */
export function useOwnerStatement(ownerId: string) {
  const result = useOwnerBalances(ownerId);
  return {
    invoices: result.invoices,
    walletBalance: result.combinedWallet,
    totalOutstanding: result.invoiceRemainingTotal,
    netPosition: result.netPosition,
    payAllOutstanding: result.payAllOutstanding,
    isLoading: result.isLoading,
    error: result.error,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 10: useBillingAdjustments
// ═══════════════════════════════════════════════════════════════════════════════

interface CreateAdjustmentInput {
  ownerId: string;
  bookingId?: string;
  invoiceId?: string;
  type: AdjustmentType;
  originalAmount?: number;
  adjustedAmount?: number;
  reason: string;
  approvedBy: string;
}

export function useBillingAdjustments(ownerId?: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: billingKeys.adjustments(ownerId),
    queryFn: async () => {
      let q = supabase
        .from("billing_adjustments")
        .select("*")
        .order("created_at", { ascending: false });

      if (ownerId) q = q.eq("owner_id", ownerId);
      else q = q.limit(100);

      const { data, error } = await q;
      if (error) throw error;
      return data as BillingAdjustment[];
    },
  });

  const createAdjustment = useMutation({
    mutationFn: async (input: CreateAdjustmentInput) => {
      const { data, error } = await supabase
        .from("billing_adjustments")
        .insert({
          owner_id: input.ownerId,
          booking_id: input.bookingId ?? null,
          invoice_id: input.invoiceId ?? null,
          adjustment_type: input.type,
          original_amount: input.originalAmount ?? null,
          adjusted_amount: input.adjustedAmount ?? null,
          reason: input.reason,
          approved_by: input.approvedBy,
        })
        .select()
        .single();
      if (error) throw error;
      return data as BillingAdjustment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing_adjustments"] });
    },
  });

  return {
    adjustments: query.data ?? [],
    createAdjustment,
    isLoading: query.isLoading,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 11: useInvoicesForOwner
// ═══════════════════════════════════════════════════════════════════════════════

export function useInvoicesForOwner(
  ownerId: string,
  filters?: { status?: InvoiceStatus; serviceType?: ServiceType },
) {
  return useQuery({
    queryKey: billingKeys.invoices(ownerId, filters as Record<string, string>),
    enabled: !!ownerId,
    queryFn: async () => {
      const invoiceSelect =
        "*, line_items:invoice_line_items(*), bookings(booking_ref, check_in_date, check_out_date), invoice_payments(payment_method, created_at)";
      let q = supabase
        .from("invoices")
        .select(invoiceSelect)
        .eq("owner_id", ownerId)
        // Exclude wallet top-up receipts; they live in their own history tab.
        .or("receipt_only.is.null,receipt_only.eq.false")
        .order("created_at", { ascending: false });

      if (filters?.status) q = q.eq("status", filters.status);

      const { data, error } = await q;
      if (error) throw error;

      type RawLineItem = { id: string; description: string; quantity: number; unit_price: number; total_price: number; service_type: string | null };
      type RawBooking = { booking_ref: string | null; check_in_date: string; check_out_date: string } | null;

      return (data ?? []).map((inv) => {
        const raw = inv as Record<string, unknown>;
        const lineItems = (raw.line_items as RawLineItem[] | null) ?? [];
        const booking = raw.bookings as RawBooking;
        const payments =
          (raw.invoice_payments as
            | Array<{ payment_method: PaymentMethod | null; created_at: string }>
            | null) ?? [];
        const latestPayment = payments
          .slice()
          .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
        // TODO: deprecate invoices.payment_method
        const derivedPaymentMethod =
          latestPayment?.payment_method ?? (inv.payment_method as PaymentMethod | null);

        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          branch_code: deriveBranchCodeFromInvoiceNumber(inv.invoice_number),
          owner_id: inv.owner_id,
          service_type: inv.service_type ?? null,
          service_id: inv.booking_id,
          status: inv.status as InvoiceStatus,
          subtotal: inv.subtotal ?? 0,
          discount_pct: inv.discount_pct,
          discount_amount: inv.discount_amount ?? 0,
          total: inv.total ?? 0,
          vat_aed: inv.vat_aed ?? null,
          payment_method: inv.payment_method as PaymentMethod | null,
          paymentMethod: derivedPaymentMethod,
          // TODO: deprecate after invoice_payments migration
          amount_paid: Number((inv as Record<string, unknown>).amount_paid ?? 0),
          paid_at: inv.paid_at ?? (inv.status === "paid" ? inv.updated_at : null),
          due_date: inv.due_date,
          notes: inv.notes,
          voided_at: inv.voided_at ?? (inv.status === "cancelled" ? inv.updated_at : null),
          voided_reason: inv.voided_reason ?? (inv.status === "cancelled" ? inv.notes : null),
          created_at: inv.created_at,
          line_items: lineItems.map((li, idx) => ({
            id: li.id,
            pricing_key: (li as Record<string, unknown>).pricing_key as string | null ?? null,
            description: li.description,
            quantity: li.quantity,
            unit_price: li.unit_price,
            line_total: li.total_price,
            sort_order: (li as Record<string, unknown>).sort_order as number ?? idx,
          })),
          booking_ref: booking?.booking_ref ?? null,
          booking_check_in: booking?.check_in_date ?? null,
          booking_check_out: booking?.check_out_date ?? null,
        };
      }) as InvoiceWithItems[];
    },
  });
}
