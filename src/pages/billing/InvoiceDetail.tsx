import { useCallback, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import TopBar from "@/components/dashboard/TopBar";
import { supabase } from "@/integrations/supabase/client";
import { useInvoiceDetail } from "@/hooks/useInvoiceDetail";
import { useLinkedDaycareSessionsForInvoice } from "@/hooks/useDaycare";
import { useProcessWalletPayment, useRecordExternalPayment, useRevertInvoicePayment } from "@/hooks/usePayments";
import { VoidInvoiceDialog } from "@/components/billing/VoidInvoiceDialog";
import { VoidedInvoiceBanner } from "@/components/billing/VoidedInvoiceBanner";
import { StaffNameSelect } from "@/components/staff/StaffNameSelect";
import { paymentMethodLabel, type ExternalPaymentMethod } from "@/lib/paymentMethod";
import { CreditCard, Printer, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { invoiceLineDisplayAmounts, invoiceResolvedAmounts, roundMoney2, vatLineLabel } from "@/lib/vatConfig";
import { InvoiceAdjustmentAmountInput } from "@/components/billing/InvoiceAdjustmentAmountInput";
import { PaymentSplitDialog } from "@/components/billing/PaymentSplitDialog";
import {
  describeApprovedDiscountLines,
  discountReasonWithMode,
  type InvoiceDiscountMode,
  isPercentDiscountAdjustmentType,
  resolveAdjustmentDiscountAmount,
} from "@/lib/invoiceAdjustmentDiscount";
import { applyInvoiceDiscountAdjustment, isDiscountAdjustmentType } from "@/lib/invoiceRecalc";
import { DeleteInvoiceDialog } from "@/components/billing/DeleteInvoiceDialog";
import { InvoiceLedgerCard } from "@/components/billing/InvoiceLedgerCard";
import { DuplicatePaymentConfirmDialog } from "@/components/billing/DuplicatePaymentConfirmDialog";
import type { DuplicatePaymentInfo } from "@/lib/recordExternalInvoicePayment";
import { AddInvoiceLineItemDialog } from "@/components/billing/AddInvoiceLineItemDialog";
import { DeleteInvoiceLineItemDialog } from "@/components/billing/DeleteInvoiceLineItemDialog";
import {
  DeleteInvoiceAdjustmentDialog,
  type DeleteInvoiceAdjustmentTarget,
} from "@/components/billing/DeleteInvoiceAdjustmentDialog";
import { WalletCreditExternalPaymentDialog } from "@/components/billing/WalletCreditExternalPaymentDialog";
import {
  canDeleteInvoiceAdjustments,
  canDeleteInvoiceLineItems,
  canEditInvoiceLineItems,
} from "@/lib/invoiceRecalc";
import { ownerHasWalletCredit, ownerWalletCredit } from "@/lib/walletCredit";
import { HOURLY_PLACEHOLDER_SERVICE_TYPE } from "@/lib/daycareHourlyDraftInvoice";
import { canRevertInvoicePayment, walletRefundFromPayments } from "@/lib/revertInvoicePayment";
import { markInvoiceOutstanding } from "@/lib/markInvoiceOutstanding";

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-300",
  finalised: "bg-emerald-50 text-emerald-700 border-emerald-300",
  outstanding: "bg-amber-50 text-amber-700 border-amber-300",
  partially_paid: "bg-blue-50 text-blue-700 border-blue-300",
  overdue: "bg-red-50 text-red-700 border-red-300",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-300",
  voided: "bg-slate-100 text-slate-500 border-slate-300 line-through",
  consolidated: "bg-indigo-50 text-indigo-700 border-indigo-300",
};

function aed(v: number) {
  return `AED ${v.toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function InvoiceDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id } = useParams<{ id: string }>();
  const returnTo = searchParams.get("returnTo");
  const backHref = returnTo?.startsWith("/") ? returnTo : "/billing/invoices";
  const backLabel = backHref.startsWith("/customers/") ? "Back to customer profile" : "Back to invoices";
  const { data, isLoading, refetch } = useInvoiceDetail(id);
  const walletPay = useProcessWalletPayment();
  const externalPay = useRecordExternalPayment();
  const revertPayment = useRevertInvoicePayment();

  const [walletOpen, setWalletOpen] = useState(false);
  const [externalPayOpen, setExternalPayOpen] = useState<ExternalPaymentMethod | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [duplicatePayment, setDuplicatePayment] = useState<DuplicatePaymentInfo | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [revertReason, setRevertReason] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [performedBy, setPerformedBy] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustType, setAdjustType] = useState("discount_override");
  const [adjustDiscountMode, setAdjustDiscountMode] = useState<InvoiceDiscountMode>("percent");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustApprover, setAdjustApprover] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [collectPaymentOpen, setCollectPaymentOpen] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [deleteLineTarget, setDeleteLineTarget] = useState<{ id: string; description: string } | null>(null);
  const [deleteAdjustmentTarget, setDeleteAdjustmentTarget] =
    useState<DeleteInvoiceAdjustmentTarget | null>(null);
  const [walletCreditPromptMethod, setWalletCreditPromptMethod] =
    useState<ExternalPaymentMethod | null>(null);
  const [markDueOpen, setMarkDueOpen] = useState(false);
  const [markDueReason, setMarkDueReason] = useState("");
  const [markDueBusy, setMarkDueBusy] = useState(false);
  /** Sync guard — isPending alone loses to double-clicks before re-render. */
  const externalPayBusyRef = useRef(false);
  const [externalPayBusy, setExternalPayBusy] = useState(false);

  const handlePrint = useCallback(() => {
    if (!id) return;
    window.open(`/print/invoice/${id}`, "_blank", "noopener,noreferrer");
  }, [id]);

  const isDaycareInvoice = data?.invoice?.service_type === "daycare";
  const { data: linkedDaycareSessions = [] } = useLinkedDaycareSessionsForInvoice(
    isDaycareInvoice ? data?.invoice?.id : undefined,
    isDaycareInvoice ? data?.invoice?.service_id ?? undefined : undefined,
  );

  const approvedDiscountLines = useMemo(
    () => describeApprovedDiscountLines(data?.adjustments ?? []),
    [data?.adjustments],
  );

  const computed = useMemo(() => {
    const lines = data?.lines ?? [];
    const adjustments = data?.adjustments ?? [];
    const invoice = data?.invoice;
    const lineSubtotal = lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
    const lineTotal = lines.reduce((sum, l) => sum + (l.total_price ?? l.line_total ?? 0), 0);
    const lineDiscount = Math.max(0, lineSubtotal - lineTotal);
    const resolved = invoice
      ? invoiceResolvedAmounts({
          subtotal: lineSubtotal,
          discount_amount: invoice.discount_amount ?? 0,
          total: invoice.total,
          vat_aed: invoice.vat_aed,
          service_type: invoice.service_type,
          notes: invoice.notes,
          lineDiscount,
          adjustments,
        })
      : {
          totalDiscount: 0,
          grossTotal: 0,
          display: { netExVat: 0, vat: 0, grandTotal: 0 },
        };
    // invoice.amount_paid is maintained by both wallet and cash/card payment flows.
    // Summing wallet_transactions directly doesn't work because wallet deductions
    // are stored as negative amounts (Math.max(0, amount) would skip them).
    // Do not subtract invoices.opening_balance — it is a wallet snapshot at issue,
    // not a deposit applied to this invoice.
    const amountPaid = roundMoney2(Math.max(0, invoice?.amount_paid ?? 0));
    const outstanding = Math.max(0, resolved.display.grandTotal - amountPaid);
    return {
      lineSubtotal,
      totalDiscount: resolved.totalDiscount,
      netExVat: resolved.display.netExVat,
      vat: resolved.display.vat,
      grandTotal: resolved.display.grandTotal,
      amountPaid,
      outstanding,
    };
  }, [data]);

  const showRevertPayment = useMemo(() => {
    if (!data?.invoice) return false;
    return canRevertInvoicePayment(data.invoice, data.payments);
  }, [data]);

  const walletRevertAmount = useMemo(() => {
    if (!data?.payments) return 0;
    return walletRefundFromPayments(data.payments);
  }, [data?.payments]);

  if (isLoading) {
    return (
      <>
        <TopBar title="Invoice Detail" />
        <main className="flex-1 overflow-auto p-8 space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-72 w-full" />
        </main>
      </>
    );
  }

  if (!data?.invoice) {
    return (
      <>
        <TopBar title="Invoice Detail" />
        <main className="flex-1 overflow-auto p-8">
          <p className="text-muted-foreground">Invoice not found.</p>
        </main>
      </>
    );
  }

  const inv = data.invoice;
  const ownerName = `${inv.owners?.first_name ?? ""} ${inv.owners?.last_name ?? ""}`.trim() || "—";
  const status = inv.status;
  const walletBalance = ownerWalletCredit(inv.owners?.wallet_balance);

  const beginExternalPay = (method: ExternalPaymentMethod) => {
    setExternalPayOpen(method);
    setPayAmount(computed.outstanding.toFixed(2));
  };

  const openExternalPay = (method: ExternalPaymentMethod) => {
    if (ownerHasWalletCredit(inv.owners?.wallet_balance)) {
      setWalletCreditPromptMethod(method);
      return;
    }
    beginExternalPay(method);
  };

  const doCollectPayment = async () => {
    if ((inv.total ?? 0) === 0) {
      // Zero-value — close directly to paid (never finalised).
      const { error } = await supabase
        .from("invoices")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", inv.id);
      if (error) return toast.error(error.message);
      toast.success("Invoice closed", { description: "No charge invoice marked as paid." });
      refetch();
    } else {
      setCollectPaymentOpen(true);
    }
  };

  const doMarkAsDue = async () => {
    if (!performedBy.trim()) return toast.error("Staff name is required.");
    if (!markDueReason.trim()) return toast.error("A reason is required.");
    setMarkDueBusy(true);
    try {
      const result = await markInvoiceOutstanding(supabase, {
        invoiceId: inv.id,
        performedBy: performedBy.trim(),
        reason: markDueReason.trim(),
      });
      if (!result.success) throw new Error(result.error || "Could not mark invoice as due.");
      toast.success("Invoice marked as due");
      setMarkDueOpen(false);
      setMarkDueReason("");
      setPerformedBy("");
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not mark invoice as due.");
    } finally {
      setMarkDueBusy(false);
    }
  };

  const submitExternal = async (confirmDuplicate: boolean) => {
    if (externalPayBusyRef.current) return;
    if (!externalPayOpen) return;
    if (!performedBy.trim()) return toast.error("Staff name is required.");
    const amount = parseFloat(payAmount || "0");
    if (!amount || Number.isNaN(amount)) return toast.error("Enter a valid payment amount.");
    externalPayBusyRef.current = true;
    setExternalPayBusy(true);
    try {
      const result = await externalPay.mutateAsync({
        invoiceId: inv.id,
        method: externalPayOpen,
        performedBy: performedBy.trim(),
        amountAed: amount,
        note: refundNote.trim() || undefined,
        confirmDuplicate,
      });
      if (result.duplicate && !confirmDuplicate) {
        setDuplicatePayment(result.duplicate);
        return;
      }
      toast.success(
        result.partial
          ? `Partial ${paymentMethodLabel(externalPayOpen)} payment recorded.`
          : `Recorded ${paymentMethodLabel(externalPayOpen)} payment.`,
      );
      setExternalPayOpen(null);
      setRefundNote("");
      setPayAmount("");
      setDuplicatePayment(null);
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not record payment.");
    } finally {
      externalPayBusyRef.current = false;
      setExternalPayBusy(false);
    }
  };

  const doRecordExternal = () => submitExternal(false);
  const externalPaySubmitting = externalPayBusy || externalPay.isPending;

  const doWalletPay = async () => {
    if (!performedBy.trim()) return toast.error("Staff name is required.");
    try {
      const result = await walletPay.mutateAsync({ invoiceId: inv.id, performedBy: performedBy.trim() });
      if ((result.amount_charged ?? 0) <= 0) {
        toast.success("Invoice already matches the discounted total. Nothing more was charged.");
      } else if (result.partial) {
        toast.success(`Partial wallet payment recorded — AED ${result.amount_charged?.toFixed(2)} deducted.`);
      } else {
        toast.success("Wallet payment completed.");
      }
      setWalletOpen(false);
      setPerformedBy("");
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Wallet payment failed.");
    }
  };

  const doAddAdjustment = async () => {
    if (!adjustAmount || !adjustReason.trim() || !adjustApprover.trim()) {
      return toast.error("Fill amount, reason, and approver.");
    }
    const entered = Math.abs(parseFloat(adjustAmount));
    if (!entered || Number.isNaN(entered)) return toast.error("Invalid adjustment amount.");
    if (isPercentDiscountAdjustmentType(adjustType) && adjustDiscountMode === "percent" && entered > 100) {
      return toast.error("Discount percentage cannot exceed 100%.");
    }
    const subtotal = computed.lineSubtotal;
    const amount = resolveAdjustmentDiscountAmount(
      isPercentDiscountAdjustmentType(adjustType) ? adjustDiscountMode : "flat",
      entered,
      subtotal,
    );
    if (!amount) return toast.error("Discount must be greater than zero.");
    const reason = discountReasonWithMode(
      adjustReason.trim(),
      isPercentDiscountAdjustmentType(adjustType) ? adjustDiscountMode : "flat",
      entered,
    );
    const { error } = await supabase.from("billing_adjustments").insert({
      owner_id: inv.owner_id,
      invoice_id: inv.id,
      adjustment_type: adjustType,
      original_amount: inv.total ?? inv.total,
      adjusted_amount: amount,
      reason,
      approved_by: adjustApprover.trim(),
    });
    if (error) return toast.error(error.message);
    if (isDiscountAdjustmentType(adjustType)) {
      try {
        await applyInvoiceDiscountAdjustment(inv.id, amount);
      } catch (syncErr) {
        return toast.error(
          syncErr instanceof Error ? syncErr.message : "Adjustment saved but invoice totals failed to update.",
        );
      }
    }
    toast.success("Adjustment added.");
    setAdjustOpen(false);
    setAdjustAmount("");
    setAdjustDiscountMode("percent");
    setAdjustReason("");
    setAdjustApprover("");
    refetch();
  };

  const doRevertPayment = async () => {
    if (!performedBy.trim()) return toast.error("Staff name is required.");
    try {
      const result = await revertPayment.mutateAsync({
        invoiceId: inv.id,
        performedBy: performedBy.trim(),
        reason: revertReason.trim() || undefined,
      });
      if (result.walletRefunded && result.walletRefunded > 0) {
        toast.success(`Payment reverted — AED ${result.walletRefunded.toFixed(2)} returned to wallet.`);
      } else {
        toast.success("Payment reverted.");
      }
      setRevertOpen(false);
      setRevertReason("");
      setPerformedBy("");
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not revert payment.");
    }
  };

  return (
    <>
      <TopBar title="Invoice Detail" />
      <main className="flex-1 overflow-auto p-8 space-y-6">
        <Button variant="ghost" onClick={() => navigate(backHref)}>{backLabel}</Button>

        <Card>
          <CardContent className="p-5 grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Invoice</p>
              <p className="font-mono text-sm">{inv.invoice_number ?? inv.id}</p>
              <Badge variant="outline" className={STATUS_COLOR[status] ?? STATUS_COLOR.draft}>{status.replace(/_/g, " ")}</Badge>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Owner</p>
              <Link to={`/customers/${inv.owner_id}`} className="font-medium text-primary hover:underline">{ownerName}</Link>
              <p className="text-sm text-muted-foreground capitalize">{inv.service_type?.replace(/_/g, " ") ?? "—"}</p>
              <p className="text-xs text-muted-foreground">
                Created {format(new Date(inv.created_at), "d MMM yyyy")} · Due {inv.due_date ? format(new Date(`${inv.due_date}T00:00:00`), "d MMM yyyy") : "—"}
              </p>
            </div>
          </CardContent>
        </Card>

        {status === "voided" ? (
          <VoidedInvoiceBanner
            invoiceId={inv.id}
            voidedBy={inv.voided_by}
            voidedAt={inv.voided_at}
            voidedReason={inv.voided_reason}
          />
        ) : null}

        <InvoiceLedgerCard invoiceId={inv.id} onChanged={() => void refetch()} />

        {inv.notes?.trim() ? (
          <Card>
            <CardContent className="p-5 space-y-1">
              <h3 className="font-semibold text-sm">Notes</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{inv.notes}</p>
            </CardContent>
          </Card>
        ) : null}

        {isDaycareInvoice && linkedDaycareSessions.length > 0 && (
          <Card>
            <CardContent className="p-5 space-y-2">
              <h3 className="font-semibold text-sm">Linked daycare check-ins</h3>
              <p className="text-xs text-muted-foreground">
                Dogs on this invoice (including hourly family billing marked on each session).
              </p>
              <ul className="text-sm space-y-1">
                {linkedDaycareSessions.map((session) => (
                  <li key={session.id}>
                    <Link
                      to="/daycare?tab=operations"
                      className="text-primary hover:underline"
                    >
                      {session.pet_name}
                    </Link>
                    {" — "}
                    {format(parseISO(session.session_date), "d MMM yyyy")}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {status === "draft" && inv.service_type === "daycare" &&
          data.lines.some((l) => l.service_type === HOURLY_PLACEHOLDER_SERVICE_TYPE) && (
          <Card className="border-amber-200 bg-amber-50/40">
            <CardContent className="p-4 text-sm text-amber-900">
              This draft invoice has placeholder hourly lines. Use <strong>Complete Hourly Billing</strong> in Daycare Operations to enter hours and finalise, or add line items manually and click <strong>Collect Payment</strong>.
            </CardContent>
          </Card>
        )}

        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="bg-muted/40"><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit</TableHead><TableHead className="text-right">Discount</TableHead><TableHead className="text-right">Line Total</TableHead>{canDeleteInvoiceLineItems(status) && <TableHead className="w-12" />}</TableRow></TableHeader>
            <TableBody>
              {data.lines.length === 0 ? (
                <TableRow><TableCell colSpan={canDeleteInvoiceLineItems(status) ? 6 : 5} className="h-16 text-center text-muted-foreground">No line items.</TableCell></TableRow>
              ) : data.lines.map((l) => {
                const { lineDiscount, lineTotal } = invoiceLineDisplayAmounts(l);
                return (
                  <TableRow key={l.id}>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{aed(l.unit_price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{aed(lineDiscount)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{aed(lineTotal)}</TableCell>
                    {canDeleteInvoiceLineItems(status) && (
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          data-testid="invoice-detail-delete-line-btn"
                          aria-label={`Remove ${l.description}`}
                          onClick={() => setDeleteLineTarget({ id: l.id, description: l.description })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent></Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Adjustments</h3>
              <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}>Add adjustment</Button>
            </div>
            {data.adjustments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No adjustments.</p>
            ) : (
              <div className="space-y-2">
                {data.adjustments.map((a) => (
                  <div key={a.id} className="rounded-md border p-3 text-sm">
                    <div className="flex justify-between gap-3 items-start">
                      <div className="min-w-0 flex-1">
                        <span className="capitalize">{a.adjustment_type.replace(/_/g, " ")}</span>
                        {a.reason ? (
                          <p className="text-muted-foreground mt-0.5">{a.reason}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold tabular-nums">
                          {aed(Math.abs(a.adjusted_amount ?? 0))}
                        </span>
                        {canDeleteInvoiceAdjustments(status) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            data-testid="invoice-detail-delete-adjustment-btn"
                            aria-label={`Remove ${a.adjustment_type.replace(/_/g, " ")}`}
                            onClick={() =>
                              setDeleteAdjustmentTarget({
                                id: a.id,
                                adjustment_type: a.adjustment_type,
                                reason: a.reason,
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 grid gap-1 text-sm md:max-w-md ml-auto">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{aed(computed.lineSubtotal)}</span></div>
            {approvedDiscountLines.map((line) => (
              <div key={line.key} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{line.label}</span>
                <span className="tabular-nums">−{aed(line.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between"><span className="text-muted-foreground">Total discount</span><span>{aed(computed.totalDiscount)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal (ex VAT)</span><span>{aed(computed.netExVat)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{vatLineLabel()}</span><span>{aed(computed.vat)}</span></div>
            <div className="flex justify-between font-semibold text-base pt-2 border-t"><span>Grand total (incl. VAT)</span><span>{aed(computed.grandTotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Amount paid</span><span>{aed(computed.amountPaid)}</span></div>
            <div className="flex justify-between font-semibold"><span>Balance outstanding</span><span>{aed(computed.outstanding)}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex flex-wrap gap-2">
            {status !== "voided" && status !== "consolidated" && status !== "cancelled" && (
              <Button variant="outline" onClick={handlePrint} data-testid="invoice-detail-print-btn">
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Button>
            )}
            {canEditInvoiceLineItems(status) && (
              <Button
                variant="outline"
                onClick={() => setAddLineOpen(true)}
                data-testid="invoice-detail-add-line-btn"
              >
                Add line item
              </Button>
            )}
            {status === "draft" && (
              <>
                <Button onClick={doCollectPayment}>
                  <CreditCard className="mr-2 h-4 w-4" /> Collect Payment
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setMarkDueReason("");
                    setMarkDueOpen(true);
                  }}
                  data-testid="invoice-detail-mark-due-btn"
                >
                  Mark as due
                </Button>
                <PaymentSplitDialog
                  open={collectPaymentOpen}
                  onOpenChange={setCollectPaymentOpen}
                  invoiceId={inv.id}
                  ownerId={inv.owner_id}
                  invoiceTotal={computed.outstanding}
                  ensureOutstanding={status === "draft"}
                  onSuccess={() => {
                    setCollectPaymentOpen(false);
                    refetch();
                  }}
                />
              </>
            )}
            {["finalised", "outstanding", "overdue", "issued", "partially_paid"].includes(status) && (
              <>
                <Button onClick={() => { setPayAmount(computed.outstanding.toFixed(2)); setWalletOpen(true); }}>
                  {status === "partially_paid" ? `Pay remainder (${aed(computed.outstanding)})` : "Pay with wallet"}
                </Button>
                <Button variant="outline" onClick={() => openExternalPay("cash")}>Record cash</Button>
                <Button variant="outline" onClick={() => openExternalPay("card")}>Record card</Button>
                <Button variant="outline" onClick={() => openExternalPay("bank_transfer")}>Bank transfer</Button>
                <Button variant="outline" onClick={() => openExternalPay("payment_link")}>Payment link</Button>
              </>
            )}
            {(status === "paid" || status === "partially_paid") && showRevertPayment && (
              <Button
                type="button"
                variant="outline"
                className="border-amber-300 text-amber-800 hover:bg-amber-50"
                data-testid="invoice-detail-revert-payment-btn"
                onClick={() => {
                  setRevertReason("");
                  setRevertOpen(true);
                }}
              >
                Revert payment
              </Button>
            )}
            {status !== "voided" && status !== "cancelled" && status !== "consolidated" && (
              <Button
                variant="destructive"
                onClick={() => setVoidOpen(true)}
                data-testid="invoice-detail-void-btn"
              >
                Void invoice
              </Button>
            )}
            {status === "consolidated" && (
              <p className="text-sm text-muted-foreground">
                Consolidated invoice is read-only. Its balance was moved to a merged invoice.
              </p>
            )}
            <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete invoice
            </Button>
          </CardContent>
        </Card>
      </main>

      <Dialog open={markDueOpen} onOpenChange={setMarkDueOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark invoice as due</DialogTitle>
            <DialogDescription>
              Override the draft status and make this invoice collectable. This is audit-logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <Label>Reason</Label>
            <Textarea
              value={markDueReason}
              onChange={(e) => setMarkDueReason(e.target.value)}
              placeholder="e.g. early checkout, owner requested invoice now"
            />
            <StaffNameSelect value={performedBy} onChange={setPerformedBy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkDueOpen(false)} disabled={markDueBusy}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={doMarkAsDue}
              disabled={markDueBusy}
              data-testid="invoice-detail-mark-due-confirm"
            >
              {markDueBusy ? "Saving..." : "Mark as due"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={walletOpen} onOpenChange={setWalletOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Wallet payment</DialogTitle><DialogDescription>Current wallet {aed(inv.owners?.wallet_balance ?? 0)}</DialogDescription></DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="rounded-md border p-3 space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal (before VAT)</span><span>{aed(computed.netExVat)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{vatLineLabel()}</span><span>{aed(computed.vat)}</span></div>
              <div className="flex justify-between font-semibold border-t pt-1"><span>Grand total</span><span>{aed(computed.grandTotal)}</span></div>
            </div>
            <p>Outstanding: <strong>{aed(computed.outstanding)}</strong></p>
            <StaffNameSelect value={performedBy} onChange={setPerformedBy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalletOpen(false)}>Cancel</Button>
            <Button type="button" onClick={doWalletPay} disabled={walletPay.isPending}>{walletPay.isPending ? "Processing..." : "Confirm payment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!externalPayOpen} onOpenChange={() => setExternalPayOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record {externalPayOpen ? paymentMethodLabel(externalPayOpen) : "payment"}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="rounded-md border p-3 space-y-1">
              <div className="flex justify-between font-semibold border-t pt-1"><span>Balance outstanding</span><span>{aed(computed.outstanding)}</span></div>
            </div>
            <div className="space-y-2">
              <Label>Amount (AED)</Label>
              <Input type="number" min="0.01" step="0.01" max={computed.outstanding} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </div>
            <Label>Reference note (optional)</Label>
            <Textarea value={refundNote} onChange={(e) => setRefundNote(e.target.value)} />
            <StaffNameSelect value={performedBy} onChange={setPerformedBy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExternalPayOpen(null)}>Cancel</Button>
            <Button onClick={doRecordExternal} disabled={externalPaySubmitting}>{externalPaySubmitting ? "Saving..." : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DuplicatePaymentConfirmDialog
        open={!!duplicatePayment}
        duplicate={duplicatePayment}
        submitting={externalPaySubmitting}
        onConfirm={() => submitExternal(true)}
        onCancel={() => setDuplicatePayment(null)}
      />

      <VoidInvoiceDialog
        open={voidOpen}
        invoiceId={inv.id}
        onOpenChange={setVoidOpen}
        onCompleted={() => void refetch()}
      />

      <Dialog open={revertOpen} onOpenChange={setRevertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revert payment</DialogTitle>
            <DialogDescription>
              This marks the invoice unpaid again and credits the owner wallet when the payment came from wallet.
              Original payment rows stay on the invoice for audit. Only available within the last 2 weeks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="rounded-md border p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount paid</span>
                <span>{aed(computed.amountPaid)}</span>
              </div>
              {walletRevertAmount > 0 && (
                <p className="text-xs text-muted-foreground pt-1">
                  Wallet balance will be credited by {aed(walletRevertAmount)}.
                </p>
              )}
            </div>
            <Label>Reason (optional)</Label>
            <Textarea
              value={revertReason}
              onChange={(e) => setRevertReason(e.target.value)}
              placeholder="e.g. recorded against wrong invoice"
            />
            <StaffNameSelect value={performedBy} onChange={setPerformedBy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevertOpen(false)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={doRevertPayment}
              disabled={revertPayment.isPending}
              data-testid="invoice-detail-revert-payment-confirm"
            >
              {revertPayment.isPending ? "Reverting..." : "Revert payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteInvoiceDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        invoiceUuid={inv.id}
        invoiceNumberDisplay={inv.invoice_number?.trim() || inv.id.slice(0, 8)}
        ownerName={ownerName}
        totalAmount={computed.grandTotal}
        onDeleted={() => navigate(backHref)}
      />

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add adjustment</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Type</Label>
            <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={adjustType} onChange={(e) => setAdjustType(e.target.value)}>
              <option value="discount_override">Discount</option>
              <option value="goodwill_credit">Goodwill credit</option>
              <option value="fee_waived">Fee waived</option>
              <option value="adjustment">Adjustment</option>
            </select>
            <InvoiceAdjustmentAmountInput
              adjustmentType={adjustType}
              subtotal={computed.lineSubtotal}
              mode={adjustDiscountMode}
              onModeChange={setAdjustDiscountMode}
              value={adjustAmount}
              onValueChange={setAdjustAmount}
            />
            <Label>Reason</Label>
            <Textarea value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
            <Label>Approved by</Label>
            <Input value={adjustApprover} onChange={(e) => setAdjustApprover(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button onClick={doAddAdjustment}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {inv && inv.owner_id && (
        <AddInvoiceLineItemDialog
          open={addLineOpen}
          onOpenChange={setAddLineOpen}
          invoiceId={inv.id}
          ownerId={inv.owner_id}
          serviceType={inv.service_type}
          invoiceLabel={inv.invoice_number ?? undefined}
          onAdded={() => void refetch()}
        />
      )}

      {inv?.owner_id && (
        <DeleteInvoiceLineItemDialog
          open={!!deleteLineTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteLineTarget(null);
          }}
          lineItem={deleteLineTarget}
          invoiceId={inv.id}
          ownerId={inv.owner_id}
          onDeleted={() => void refetch()}
        />
      )}

      {inv?.owner_id && (
        <DeleteInvoiceAdjustmentDialog
          open={!!deleteAdjustmentTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteAdjustmentTarget(null);
          }}
          adjustment={deleteAdjustmentTarget}
          invoiceId={inv.id}
          ownerId={inv.owner_id}
          onDeleted={() => void refetch()}
        />
      )}

      <WalletCreditExternalPaymentDialog
        open={!!walletCreditPromptMethod}
        onOpenChange={(open) => {
          if (!open) setWalletCreditPromptMethod(null);
        }}
        walletBalance={walletBalance}
        outstanding={computed.outstanding}
        externalMethod={walletCreditPromptMethod}
        onUseWallet={() => {
          const method = walletCreditPromptMethod;
          setWalletCreditPromptMethod(null);
          if (method) setExternalPayOpen(null);
          setPayAmount(computed.outstanding.toFixed(2));
          setWalletOpen(true);
        }}
        onContinueExternal={() => {
          if (!walletCreditPromptMethod) return;
          const method = walletCreditPromptMethod;
          setWalletCreditPromptMethod(null);
          beginExternalPay(method);
        }}
      />
    </>
  );
}
