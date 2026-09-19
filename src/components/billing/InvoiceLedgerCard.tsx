import { useMemo, useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, Lock, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StaffNameSelect } from "@/components/staff/StaffNameSelect";
import { formatAed, roundAed } from "@/lib/money";
import { invoiceBalanceDue } from "@/lib/invoiceStatus";
import {
  paymentMethodLabel,
  INVOICE_PAYMENT_METHOD_OPTIONS,
  type ExternalPaymentMethod,
} from "@/lib/paymentMethod";
import { voidInvoice } from "@/services/invoiceService";
import { useChangePaymentMethod } from "@/hooks/usePayments";
import { useInvoiceLedger, invoiceLedgerQueryKey } from "@/hooks/useInvoiceLedger";
import { useAccountBalance, accountBalanceQueryKey } from "@/hooks/useAccountBalance";

const EXTERNAL_METHOD_OPTIONS = INVOICE_PAYMENT_METHOD_OPTIONS.filter(
  (o) => o.value !== "wallet",
);

type EditablePayment = {
  id: string;
  amount: number;
  method: ExternalPaymentMethod;
  createdAt: string;
};

interface InvoiceLedgerCardProps {
  invoiceId: string;
  /** Called after a successful void so the parent page can refetch. */
  onChanged?: () => void;
}

const UNPAID_STATUSES = new Set(["outstanding", "overdue", "partially_paid"]);

export function InvoiceLedgerCard({ invoiceId, onChanged }: InvoiceLedgerCardProps) {
  const queryClient = useQueryClient();
  const { data: ledger, isLoading } = useInvoiceLedger(invoiceId);
  const { data: account } = useAccountBalance(ledger?.invoice.owner_id);

  const [showAmendments, setShowAmendments] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [voidedBy, setVoidedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const changeMethod = useChangePaymentMethod();
  const [editPayment, setEditPayment] = useState<EditablePayment | null>(null);
  const [newMethod, setNewMethod] = useState<ExternalPaymentMethod>("card");
  const [newDate, setNewDate] = useState("");
  const [changeStaff, setChangeStaff] = useState("");
  const [changeReason, setChangeReason] = useState("");

  const amendmentLock = useMemo(() => {
    const lockedAt = ledger?.invoice.amendment_locked_at;
    if (!lockedAt || ledger?.invoice.status !== "outstanding") return null;
    const lockMs = new Date(lockedAt).getTime();
    return { lockMs, locked: Date.now() >= lockMs, at: new Date(lockedAt) };
  }, [ledger]);

  if (isLoading || !ledger) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Loading ledger…
        </CardContent>
      </Card>
    );
  }

  const { invoice, lines, payments, amendments, charges, totalPaid } = ledger;
  const walletBalance = account?.walletBalance ?? 0;
  const accountBalance = account?.accountBalance ?? 0;
  const balanceDue = invoiceBalanceDue(invoice.status, charges, totalPaid);
  const invoiceSettled = balanceDue < 0.01;
  const canVoid =
    invoice.status !== "finalised" &&
    invoice.status !== "voided" &&
    invoice.status !== "consolidated";
  const hasPayments = payments.length > 0;

  // This invoice's contribution to outstanding debt, used to detect whether the
  // owner has *other* unpaid invoices on their account.
  const thisOutstanding =
    !invoice.receipt_only && UNPAID_STATUSES.has(invoice.status)
      ? balanceDue
      : 0;
  const otherOutstanding = Math.max(0, (account?.outstandingDebt ?? 0) - thisOutstanding);
  const hasOtherUnpaid = otherOutstanding > 0.01;
  // Account position before this invoice's unpaid portion is counted.
  const balanceBefore = roundAed(accountBalance + thisOutstanding);

  const handleVoid = async () => {
    if (!voidReason.trim()) {
      toast.error("A void reason is mandatory.");
      return;
    }
    setSubmitting(true);
    const res = await voidInvoice({
      invoiceId,
      voidedBy: voidedBy.trim() || "reception",
      reason: voidReason.trim(),
      refundNote: refundNote.trim() || undefined,
      refundAmount: refundAmount ? Number(refundAmount) : undefined,
    });
    setSubmitting(false);
    if (!res.success) {
      toast.error(res.error ?? "Could not void invoice.");
      return;
    }
    toast.success("Invoice voided successfully");
    setVoidOpen(false);
    setVoidReason("");
    setRefundNote("");
    setRefundAmount("");
    queryClient.invalidateQueries({ queryKey: invoiceLedgerQueryKey(invoiceId) });
    queryClient.invalidateQueries({ queryKey: accountBalanceQueryKey(invoice.owner_id) });
    onChanged?.();
  };

  return (
    <Card data-testid="invoice-ledger-card">
      <CardContent className="p-5 space-y-4">
        {/* Banners */}
        {invoice.deposit_bypassed ? (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2"
            data-testid="invoice-ledger-deposit-bypass-banner"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Deposit bypassed</p>
              {invoice.deposit_bypass_reason ? (
                <p className="text-amber-800">{invoice.deposit_bypass_reason}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {UNPAID_STATUSES.has(invoice.status) ? (
          <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900">
            This invoice is <strong>{invoice.status.replace(/_/g, " ")}</strong> and has an
            outstanding balance.
          </div>
        ) : null}

        {hasOtherUnpaid ? (
          <div
            className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900 flex items-start gap-2"
            data-testid="invoice-ledger-other-unpaid-banner"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              This owner has other unpaid invoices totalling{" "}
              <strong>{formatAed(otherOutstanding)}</strong> on their account.
            </span>
          </div>
        ) : null}

        {amendmentLock ? (
          <div
            className={`rounded-md border p-3 text-sm flex items-center gap-2 ${
              amendmentLock.locked
                ? "border-slate-300 bg-slate-50 text-slate-600"
                : "border-amber-300 bg-amber-50 text-amber-900"
            }`}
            data-testid="invoice-ledger-amendment-lock"
          >
            <Lock className="h-4 w-4 shrink-0" />
            {amendmentLock.locked ? (
              <span>Amendments locked since {format(amendmentLock.at, "d MMM yyyy, HH:mm")}.</span>
            ) : (
              <span>
                Editable for {formatDistanceToNowStrict(amendmentLock.at)} (until{" "}
                {format(amendmentLock.at, "d MMM, HH:mm")}). Amendments require a reason.
              </span>
            )}
          </div>
        ) : null}

        {/* Ledger body — account roll-forward: before → this invoice → after */}
        <div className="space-y-1 text-sm md:max-w-md">
          {/* ACCOUNT (before this invoice) */}
          <div>
            <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Account
            </p>
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Wallet balance</span>
              <span className="tabular-nums">{formatAed(walletBalance)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Other unpaid invoices</span>
              <span className="tabular-nums text-red-700">
                {otherOutstanding > 0 ? `- ${formatAed(otherOutstanding)}` : formatAed(0)}
              </span>
            </div>
            <div className="flex justify-between border-t mt-1 pt-1 font-medium">
              <span>Balance before this invoice</span>
              <span
                className={`tabular-nums ${balanceBefore >= 0 ? "text-emerald-700" : "text-red-700"}`}
                data-testid="invoice-ledger-balance-before"
              >
                {balanceBefore < 0 ? "- " : ""}
                {formatAed(Math.abs(balanceBefore))}
              </span>
            </div>
          </div>

          {/* THIS INVOICE */}
          <div className="pt-2 border-t">
            <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
              This invoice
            </p>
            {lines.length === 0 ? (
              <p className="text-muted-foreground py-1">No line items.</p>
            ) : (
              lines.map((l) => {
                const total = l.total_price ?? l.line_total ?? l.unit_price * l.quantity;
                return (
                  <div key={l.id} className="flex justify-between py-0.5">
                    <span>{l.description}</span>
                    <span className="tabular-nums text-red-700">- {formatAed(total)}</span>
                  </div>
                );
              })
            )}
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Charges</span>
              <span className="tabular-nums text-red-700">- {formatAed(charges)}</span>
            </div>
            {payments.length > 0
              ? payments.map((p) => {
                  const editable =
                    invoice.status !== "voided" && p.payment_method !== "wallet";
                  return (
                    <div key={p.id} className="flex justify-between py-0.5">
                      <span className="text-muted-foreground flex items-center gap-1">
                        Paid via {paymentMethodLabel(p.payment_method)} on{" "}
                        {format(new Date(p.created_at), "d MMM, HH:mm")}
                        {editable ? (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground"
                            title="Change payment method"
                            onClick={() => {
                              setEditPayment({
                                id: p.id,
                                amount: p.amount,
                                method: p.payment_method as ExternalPaymentMethod,
                                createdAt: p.created_at,
                              });
                              setNewMethod(p.payment_method as ExternalPaymentMethod);
                              setNewDate(format(new Date(p.created_at), "yyyy-MM-dd'T'HH:mm"));
                              setChangeStaff("");
                              setChangeReason("");
                            }}
                            data-testid="invoice-ledger-change-method-btn"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        ) : null}
                      </span>
                      <span className="tabular-nums text-emerald-700">+ {formatAed(p.amount)}</span>
                    </div>
                  );
                })
              : null}
            <div className="flex justify-between border-t mt-1 pt-1 font-medium">
              <span>Due on this invoice</span>
              <span
                className={`tabular-nums ${invoiceSettled ? "text-emerald-700" : "text-red-700"}`}
                data-testid="invoice-ledger-closing-balance"
              >
                {formatAed(balanceDue)}
              </span>
            </div>
          </div>

          {/* NEW ACCOUNT BALANCE (after this invoice) */}
          <div className="flex justify-between border-t-2 mt-2 pt-2 text-base font-semibold">
            <span>New account balance</span>
            <span
              className={`tabular-nums ${accountBalance >= 0 ? "text-emerald-700" : "text-red-700"}`}
              data-testid="invoice-ledger-account-balance"
            >
              {accountBalance < 0 ? "- " : "+ "}
              {formatAed(Math.abs(accountBalance))}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Whole-account position after this invoice (wallet minus all unpaid invoices).
            Negative means the owner owes; positive means account credit.
          </p>
        </div>

        {/* Amendment history */}
        {amendments.length > 0 ? (
          <div className="pt-2 border-t">
            <button
              type="button"
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowAmendments((v) => !v)}
              data-testid="invoice-ledger-amendments-toggle"
            >
              {showAmendments ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Amendment history ({amendments.length})
            </button>
            {showAmendments ? (
              <div className="mt-2 space-y-2">
                {amendments.map((a) => (
                  <div key={a.id} className="rounded-md border p-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{a.field_changed}</span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(a.amended_at), "d MMM yyyy, HH:mm")}
                      </span>
                    </div>
                    <p className="text-muted-foreground">
                      {a.old_value ?? "—"} → {a.new_value ?? "—"}
                    </p>
                    <p className="text-xs">
                      {a.reason} · {a.amended_by}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Void action (reception) */}
        {canVoid ? (
          <div className="pt-2 border-t">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                setRefundAmount(hasPayments ? String(totalPaid) : "");
                setVoidOpen(true);
              }}
              data-testid="invoice-ledger-void-btn"
            >
              Void invoice
            </Button>
          </div>
        ) : invoice.status === "voided" ? (
          <p className="text-sm text-muted-foreground pt-2 border-t">
            Voided{invoice.voided_by ? ` by ${invoice.voided_by}` : ""}
            {invoice.voided_at
              ? ` on ${format(new Date(invoice.voided_at), "d MMM yyyy, HH:mm")}`
              : ""}
            . {invoice.voided_reason ?? ""}
          </p>
        ) : invoice.status === "consolidated" ? (
          <p className="text-sm text-muted-foreground pt-2 border-t">
            This invoice was consolidated into another invoice. Balance due is zero; line items are
            read-only.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground pt-2 border-t">
            Finalised invoices cannot be voided.
          </p>
        )}
      </CardContent>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void invoice</DialogTitle>
            <DialogDescription>
              Voiding never deletes the invoice. A reason is mandatory and is logged with your name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <Label>Reason (required)</Label>
              <Textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Why is this invoice being voided?"
                data-testid="invoice-ledger-void-reason"
              />
            </div>
            {hasPayments ? (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3">
                <p className="text-amber-900 text-xs">
                  This invoice has recorded payments. Refunds are discretionary — log the amount and
                  a note if a refund is being granted.
                </p>
                <div className="space-y-1">
                  <Label>Discretionary refund amount (AED)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Refund note</Label>
                  <Textarea value={refundNote} onChange={(e) => setRefundNote(e.target.value)} />
                </div>
              </div>
            ) : null}
            <StaffNameSelect value={voidedBy} onChange={setVoidedBy} label="Voided by" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoid}
              disabled={submitting}
              data-testid="invoice-ledger-void-confirm"
            >
              {submitting ? "Voiding…" : "Void invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editPayment} onOpenChange={(o) => (!o ? setEditPayment(null) : undefined)}>
        <DialogContent data-testid="invoice-ledger-change-method-dialog">
          <DialogHeader>
            <DialogTitle>Edit payment</DialogTitle>
            <DialogDescription>
              Correct the method or date on this payment without reverting it. Changes are
              logged with your name.
            </DialogDescription>
          </DialogHeader>
          {editPayment ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border p-3 flex justify-between">
                <span className="text-muted-foreground">
                  {paymentMethodLabel(editPayment.method)} ·{" "}
                  {format(new Date(editPayment.createdAt), "d MMM yyyy, HH:mm")}
                </span>
                <span className="tabular-nums font-medium">{formatAed(editPayment.amount)}</span>
              </div>
              <div className="space-y-1">
                <Label>Payment method</Label>
                <Select
                  value={newMethod}
                  onValueChange={(v) => setNewMethod(v as ExternalPaymentMethod)}
                >
                  <SelectTrigger data-testid="invoice-ledger-change-method-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXTERNAL_METHOD_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Payment date &amp; time</Label>
                <Input
                  type="datetime-local"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  data-testid="invoice-ledger-change-date-input"
                />
              </div>
              <div className="space-y-1">
                <Label>Reason (optional)</Label>
                <Textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="e.g. recorded as card by mistake, was a bank transfer"
                />
              </div>
              <StaffNameSelect value={changeStaff} onChange={setChangeStaff} label="Changed by" />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPayment(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!editPayment) return;
                if (!changeStaff.trim()) {
                  toast.error("Staff name is required.");
                  return;
                }
                const methodUnchanged = newMethod === editPayment.method;
                const newDateIso = newDate ? new Date(newDate).toISOString() : null;
                const dateUnchanged =
                  !newDateIso ||
                  newDateIso === new Date(editPayment.createdAt).toISOString();
                if (methodUnchanged && dateUnchanged) {
                  setEditPayment(null);
                  return;
                }
                try {
                  await changeMethod.mutateAsync({
                    paymentId: editPayment.id,
                    newMethod,
                    newDate: newDateIso ?? undefined,
                    performedBy: changeStaff.trim(),
                    reason: changeReason.trim() || undefined,
                    invoiceId,
                  });
                  toast.success("Payment updated.");
                  setEditPayment(null);
                  onChanged?.();
                } catch (e: unknown) {
                  toast.error(
                    e instanceof Error ? e.message : "Could not update payment.",
                  );
                }
              }}
              disabled={changeMethod.isPending}
              data-testid="invoice-ledger-change-method-confirm"
            >
              {changeMethod.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
