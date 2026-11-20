import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { PaymentSplitDialog } from "@/components/billing/PaymentSplitDialog";
import { createServiceInvoice, removeUnpaidServiceInvoice } from "@/lib/bookingUtils";
import { invoiceDueDateAtCheckIn, invoiceDueDateToday } from "@/lib/invoiceDueDate";
import {
  composeNotesWithHourlyInvoiced,
  parseHourlyDraftId,
  upgradeHourlyDraftToInvoiced,
} from "@/lib/daycareSessionMeta";
import { HOURLY_PLACEHOLDER_SERVICE_TYPE } from "@/lib/daycareHourlyDraftInvoice";
import { recalculateInvoiceTotals } from "@/lib/invoiceRecalc";
import { invoiceWalletBalanceDue } from "@/lib/invoiceWalletCharge";
import {
  buildPriceMap,
  daycareHourlyInvoiceLineUnits,
  daycareHourlyPetSubtotal,
  DAYCARE_HOURLY_UNIT_KEY,
} from "@/lib/servicePricing";
import { formatAed, parseBoundedDecimalInput, roundAed } from "@/lib/money";
import {
  netFromGrossInclusive,
  vatAmountFromGrossInclusive,
  vatLineLabel,
} from "@/lib/vatConfig";
import { toast } from "sonner";

export type HourlyBillingSession = {
  id: string;
  petId: string;
  petName: string;
  notes?: string | null;
};

type CompleteHourlyBillingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  ownerName: string;
  sessions: HourlyBillingSession[];
  onSuccess?: () => void;
};

function formatHourLabel(hours: number): string {
  return Number.isInteger(hours)
    ? String(hours)
    : hours.toLocaleString("en-AE", { minimumFractionDigits: 1, maximumFractionDigits: 3 });
}

export function CompleteHourlyBillingDialog({
  open,
  onOpenChange,
  ownerId,
  ownerName,
  sessions,
  onSuccess,
}: CompleteHourlyBillingDialogProps) {
  const [hoursByPetId, setHoursByPetId] = useState<Record<string, string>>({});
  const [skipInvoiceDiscount, setSkipInvoiceDiscount] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHoursByPetId((prev) => {
      const next: Record<string, string> = {};
      for (const session of sessions) {
        next[session.petId] = prev[session.petId] ?? "1";
      }
      return next;
    });
    setSkipInvoiceDiscount(false);
  }, [open, sessions]);

  const { data: pricingRows = [] } = useQuery<{ key: string; amount_aed: number }[]>({
    queryKey: ["pricing", "daycare_hourly_complete"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("resolve_woof_service_rate", {
        p_service_code: "daycare_hourly",
      });
      if (error) throw error;
      const hourlyAmount = (data as { amount_aed: number }[] | null)?.[0]?.amount_aed ?? 0;
      return [{ key: DAYCARE_HOURLY_UNIT_KEY, amount_aed: hourlyAmount }];
    },
  });

  const priceMap = useMemo(() => buildPriceMap(pricingRows), [pricingRows]);

  const rowPreviews = useMemo(() => {
    return sessions.map((session) => {
      const rawHours = parseBoundedDecimalInput(hoursByPetId[session.petId] ?? "1", 1, {
        min: 0.5,
        max: 48,
      });
      const subtotal = daycareHourlyPetSubtotal(rawHours, priceMap);
      return { session, rawHours, subtotal };
    });
  }, [sessions, hoursByPetId, priceMap]);

  const invoiceSubtotal = rowPreviews.reduce((sum, row) => sum + row.subtotal.total, 0);

  const { data: discountPreview, isLoading: discountPreviewLoading } = useQuery<{
    discount_pct: number;
    discount_aed: number;
    final_aed: number;
  }>({
    queryKey: [
      "daycare",
      "hourly-complete-discount",
      ownerId,
      invoiceSubtotal,
      skipInvoiceDiscount,
    ],
    enabled: open && invoiceSubtotal > 0 && !skipInvoiceDiscount,
    queryFn: async () => {
      const { data: ownerRow } = await supabase
        .from("owners")
        .select("extra_discount_pct")
        .eq("id", ownerId)
        .single();
      const pct = ownerRow?.extra_discount_pct ?? 0;
      const discountAed = roundAed(invoiceSubtotal * pct / 100);
      return {
        discount_pct: pct,
        discount_aed: discountAed,
        final_aed: invoiceSubtotal - discountAed,
      };
    },
  });

  const invoiceNetExVat = useMemo(() => {
    if (invoiceSubtotal <= 0) return null;
    if (skipInvoiceDiscount) return invoiceSubtotal;
    if (discountPreviewLoading) return invoiceSubtotal;
    return discountPreview?.final_aed ?? invoiceSubtotal;
  }, [invoiceSubtotal, skipInvoiceDiscount, discountPreviewLoading, discountPreview?.final_aed]);

  const canSubmit = rowPreviews.every((row) => row.subtotal.roundedHours > 0);

  const [payOpen, setPayOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState<{ id: string; total: number } | null>(null);

  // After the invoice is generated as `outstanding`, open the wallet-first
  // payment modal. The DB trigger flips it to finalised once fully paid.
  const openPaymentForInvoice = async (invoiceId: string) => {
    const { data: inv } = await supabase
      .from("invoices")
      .select("total, subtotal, discount_amount, amount_paid")
      .eq("id", invoiceId)
      .maybeSingle();
    const remaining = inv
      ? invoiceWalletBalanceDue({
          total: inv.total ?? 0,
          subtotal: inv.subtotal ?? 0,
          discountAmount: inv.discount_amount ?? 0,
          amountPaid: inv.amount_paid ?? 0,
        })
      : 0;
    if (remaining > 0) {
      setPayInvoice({ id: invoiceId, total: remaining });
      setPayOpen(true);
    } else {
      onOpenChange(false);
      onSuccess?.();
    }
  };

  const handleGenerateInvoice = async () => {
    if (!canSubmit || sessions.length === 0) {
      toast.error("Enter billable hours for each dog");
      return;
    }

    // Resolve the owner's profile discount once for use in both paths below.
    let ownerDiscountPct = 0;
    if (!skipInvoiceDiscount) {
      const { data: ownerRow } = await supabase
        .from("owners")
        .select("extra_discount_pct")
        .eq("id", ownerId)
        .single();
      ownerDiscountPct = ownerRow?.extra_discount_pct ?? 0;
    }

    const hourLineItems = rowPreviews
      .filter((row) => row.subtotal.total > 0)
      .map((row) => {
        const lineUnits = daycareHourlyInvoiceLineUnits(
          row.subtotal.roundedHours,
          row.subtotal.unitRate,
        );
        return {
          description: `Daycare hourly — ${row.session.petName} (${formatHourLabel(lineUnits.roundedHours)} hr)`,
          quantity: lineUnits.quantity,
          unitPrice: lineUnits.unitPrice,
          pricingKey: row.subtotal.pricingKey,
          serviceType: "daycare" as const,
        };
      });

    if (hourLineItems.length === 0) {
      toast.error("Enter billable hours for each dog");
      return;
    }

    setIsSubmitting(true);

    const { data: sessionDateRows, error: sessionDateErr } = await supabase
      .from("daycare_sessions")
      .select("session_date")
      .in(
        "id",
        sessions.map((s) => s.id),
      );
    if (sessionDateErr) {
      toast.error(sessionDateErr.message);
      setIsSubmitting(false);
      return;
    }
    const checkInDate =
      (sessionDateRows ?? [])
        .map((row) => row.session_date)
        .sort()[0] ?? invoiceDueDateToday();

    // Detect whether a draft invoice already exists for these sessions.
    const draftInvoiceId = parseHourlyDraftId(sessions[0].notes ?? null);

    if (draftInvoiceId) {
      // ── Update-draft path ────────────────────────────────────────────────
      try {
        // 1. Remove placeholder lines (auto-generated at check-in).
        const { error: delErr } = await supabase
          .from("invoice_line_items")
          .delete()
          .eq("invoice_id", draftInvoiceId)
          .eq("service_type", HOURLY_PLACEHOLDER_SERVICE_TYPE);
        if (delErr) throw delErr;

        // 2. Determine sort_order for new lines (append after existing kept lines).
        const { data: existingLines } = await supabase
          .from("invoice_line_items")
          .select("sort_order")
          .eq("invoice_id", draftInvoiceId)
          .order("sort_order", { ascending: false })
          .limit(1);
        const maxSort = existingLines?.[0]?.sort_order ?? -1;

        // 3. Insert real hour-based lines.
        const insertRows = hourLineItems.map((li, i) => ({
          invoice_id: draftInvoiceId,
          description: li.description,
          quantity: li.quantity,
          unit_price: li.unitPrice,
          total_price: li.unitPrice * li.quantity,
          line_total: li.unitPrice * li.quantity,
          pricing_key: li.pricingKey ?? null,
          service_type: li.serviceType,
          sort_order: (maxSort ?? -1) + 1 + i,
        }));

        if (insertRows.length > 0) {
          const { error: insErr } = await supabase.from("invoice_line_items").insert(insertRows);
          if (insErr) throw insErr;
        }

        // 4. Apply owner discount to the invoice header.
        //    The draft was created with discount_aed = 0 (fixed going forward in
        //    createServiceInvoice, but existing drafts still need it set here).
        if (ownerDiscountPct > 0) {
          const { data: currentLines } = await supabase
            .from("invoice_line_items")
            .select("quantity, unit_price")
            .eq("invoice_id", draftInvoiceId);
          const linesSubtotal = (currentLines ?? []).reduce(
            (s, li) => s + li.unit_price * Math.max(1, li.quantity),
            0,
          );
          const discountAed = roundAed(linesSubtotal * ownerDiscountPct / 100);
          if (discountAed > 0) {
            const { error: discErr } = await supabase
              .from("invoices")
              .update({
                discount_pct: ownerDiscountPct,
                
                discount_amount: discountAed,
              })
              .eq("id", draftInvoiceId);
            if (discErr) throw discErr;
          }
        }

        // 5. Recalculate totals (picks up discount_aed set above), then flip the
        //    draft to outstanding so payment can be collected via the split modal.
        await recalculateInvoiceTotals(draftInvoiceId);
        const { error: finaliseErr } = await supabase
          .from("invoices")
          .update({
            status: "outstanding",
            due_date: invoiceDueDateAtCheckIn(checkInDate),
          })
          .eq("id", draftInvoiceId);
        if (finaliseErr) throw finaliseErr;

        // 6. Upgrade HOURLY_DRAFT → HOURLY_INVOICED on all sessions.
        const updateResults = await Promise.all(
          sessions.map(async (session) => {
            const { error } = await supabase
              .from("daycare_sessions")
              .update({
                notes: upgradeHourlyDraftToInvoiced(session.notes ?? null, draftInvoiceId),
              })
              .eq("id", session.id);
            return { sessionId: session.id, error };
          }),
        );

        // Link sessions to the invoice for traceability (new FK column).
        await supabase
          .from("daycare_sessions")
          .update({ invoice_id: draftInvoiceId })
          .in("id", sessions.map((s) => s.id));

        const failed = updateResults.filter((r) => r.error);
        if (failed.length > 0) {
          toast.error(
            "Invoice generated but some sessions could not be marked as billed. Check the invoice and re-run if needed.",
          );
        } else {
          toast.success("Hourly daycare invoice ready for payment");
        }

        await openPaymentForInvoice(draftInvoiceId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not generate invoice";
        toast.error(message);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // ── Legacy create path (no draft exists) ────────────────────────────────
    let invoiceId: string | null = null;
    try {
      invoiceId = await createServiceInvoice({
        ownerId,
        serviceType: "daycare",
        referenceId: sessions[0].id,
        lineItems: hourLineItems,
        invoiceStatus: "outstanding",
        skipMemberDiscount: skipInvoiceDiscount,
        checkInDate,
      });

      const updateResults = await Promise.all(
        sessions.map(async (session) => {
          const { error } = await supabase
            .from("daycare_sessions")
            .update({
              notes: composeNotesWithHourlyInvoiced(session.notes ?? null, invoiceId!),
            })
            .eq("id", session.id);
          return { sessionId: session.id, error };
        }),
      );

      const failed = updateResults.filter((r) => r.error);
      if (failed.length > 0) {
        if (invoiceId) {
          try {
            await removeUnpaidServiceInvoice(invoiceId);
          } catch {
            toast.error(
              "Sessions were not marked as billed and the invoice could not be rolled back. Check Billing before retrying.",
            );
            onOpenChange(false);
            onSuccess?.();
            return;
          }
        }
        throw new Error(
          "Could not mark all dogs as billed. No invoice was saved — you can try again.",
        );
      }

      await supabase
        .from("daycare_sessions")
        .update({ invoice_id: invoiceId })
        .in("id", sessions.map((s) => s.id));

      toast.success("Hourly daycare invoice ready for payment");
      await openPaymentForInvoice(invoiceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not generate invoice";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{ownerName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {rowPreviews.map(({ session, subtotal }) => (
            <div
              key={session.id}
              className="flex flex-wrap items-end justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="space-y-1.5 min-w-[8rem] flex-1">
                <p className="text-sm font-medium">{session.petName}</p>
                <div className="space-y-1">
                  <Label htmlFor={`hourly_hours_${session.petId}`} className="text-xs text-muted-foreground">
                    Hours
                  </Label>
                  <Input
                    id={`hourly_hours_${session.petId}`}
                    type="number"
                    min={0.5}
                    max={48}
                    step={0.5}
                    inputMode="decimal"
                    className="h-8 max-w-[7rem]"
                    value={hoursByPetId[session.petId] ?? "1"}
                    onChange={(e) =>
                      setHoursByPetId((prev) => ({ ...prev, [session.petId]: e.target.value }))
                    }
                    data-testid={`daycare-hourly-hours-${session.petId}`}
                  />
                </div>
              </div>
              <div className="text-right text-sm">
                <p className="text-xs text-muted-foreground">Subtotal</p>
                <p className="font-medium tabular-nums">{formatAed(subtotal.total)}</p>
                {subtotal.roundedHours > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {formatAed(subtotal.unitRate)} × {formatHourLabel(subtotal.roundedHours)} hr
                  </p>
                )}
              </div>
            </div>
          ))}

          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Auto pricing preview</p>
            {invoiceSubtotal <= 0 ? (
              <p className="text-sm text-muted-foreground">Enter hours to preview the invoice.</p>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatAed(invoiceSubtotal)}</span>
                </div>
                <div className="flex flex-col gap-2 rounded-md border bg-background/80 p-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="hourly_skip_discount"
                      checked={skipInvoiceDiscount}
                      onCheckedChange={setSkipInvoiceDiscount}
                    />
                    <Label htmlFor="hourly_skip_discount" className="text-sm font-normal cursor-pointer">
                      Bill without member discount
                    </Label>
                  </div>
                  {skipInvoiceDiscount && (
                    <span className="text-xs text-muted-foreground sm:text-right">
                      Profile discount will not be applied to this invoice.
                    </span>
                  )}
                </div>
                {!skipInvoiceDiscount && (
                  <div className="flex items-center justify-between text-sm text-emerald-700">
                    <span>
                      Auto discount
                      {discountPreview?.discount_pct
                        ? ` (${discountPreview.discount_pct.toFixed(2)}%)`
                        : ""}
                    </span>
                    <span>- {formatAed(discountPreview?.discount_aed ?? 0)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span>Net (ex VAT)</span>
                  <span className="tabular-nums">
                    {invoiceNetExVat != null ? formatAed(netFromGrossInclusive(invoiceNetExVat)) : "—"}
                  </span>
                </div>
                {invoiceNetExVat != null ? (
                  <div className="flex items-center justify-between text-sm">
                    <span>{vatLineLabel()}</span>
                    <span className="tabular-nums">
                      {formatAed(vatAmountFromGrossInclusive(invoiceNetExVat))}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between font-semibold">
                  <span>Total incl. VAT</span>
                  <span className="tabular-nums">
                    {invoiceNetExVat != null ? formatAed(Math.max(0, invoiceNetExVat)) : "—"}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button
            type="button"
            onClick={() => void handleGenerateInvoice()}
            disabled={isSubmitting || !canSubmit}
            data-testid="daycare-hourly-generate-invoice-btn"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generate Invoice
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-muted-foreground"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>

      {payInvoice ? (
        <PaymentSplitDialog
          open={payOpen}
          onOpenChange={(v) => {
            setPayOpen(v);
            if (!v) {
              onOpenChange(false);
              onSuccess?.();
            }
          }}
          invoiceId={payInvoice.id}
          ownerId={ownerId}
          invoiceTotal={payInvoice.total}
          title="Collect daycare payment"
          onSuccess={() => onSuccess?.()}
        />
      ) : null}
    </Dialog>
  );
}
