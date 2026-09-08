import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { format, parseISO } from "date-fns";
import { useNavigate } from "react-router-dom";
import TopBar from "@/components/dashboard/TopBar";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { PricingTab } from "@/pages/billing/pricing/PricingTab";
import { BillingWorkspaceTabs } from "@/pages/billing/BillingWorkspaceTabs";
import { useOwners, useOwner } from "@/hooks/useOwners";
import {
  useWalletTransactions,
  useTopUpWallet,
  useDeductWallet,
  type WalletTransaction,
} from "@/hooks/useWallet";
import { useCurrentStaffName } from "@/hooks/useCurrentStaffName";
import {
  useInvoicesForOwner,
  useCreateInvoice,
  useCollectPayment,
  useProcessPayment,
  useVoidInvoice,
  useCalculateCancellationRefund,
  useOwnerBalances,
  usePricing,
  formatAed,
  type InvoiceStatus,
  type InvoiceWithItems,
  type PaymentMethod as BillingPaymentMethod,
  type ServiceType,
} from "@/hooks/useBilling";
import { invoiceDiscountPercent, invoiceDisplayTotals, vatLineLabel } from "@/lib/vatConfig";
import { formatWalletAed } from "@/lib/money";
import {
  INVOICE_PAYMENT_METHOD_OPTIONS,
  WALLET_TOPUP_PAYMENT_METHOD_OPTIONS,
} from "@/lib/paymentMethod";
import { StaffNameSelect } from "@/components/staff/StaffNameSelect";
import { ConsolidateInvoicesDialog } from "@/components/billing/ConsolidateInvoicesDialog";
import { WalletBalanceDisplay, OutstandingAmountBadge } from "@/components/billing/WalletBalanceDisplay";
import { PaymentSplitDialog } from "@/components/billing/PaymentSplitDialog";
import { WalletCreditExternalPaymentDialog } from "@/components/billing/WalletCreditExternalPaymentDialog";
import { DuplicatePaymentConfirmDialog } from "@/components/billing/DuplicatePaymentConfirmDialog";
import type { DuplicatePaymentInfo } from "@/lib/recordExternalInvoicePayment";
import { canConsolidateInvoiceStatus } from "@/lib/invoiceConsolidation";
import { ownerHasWalletCredit, ownerWalletCredit } from "@/lib/walletCredit";
import { canDeleteInvoiceLineItems, canEditInvoiceLineItems } from "@/lib/invoiceRecalc";
import {
  bulkWalletPayableTotal,
  filterBulkWalletPayableInvoices,
} from "@/lib/bulkWalletPayEligibility";
import { AddInvoiceLineItemDialog } from "@/components/billing/AddInvoiceLineItemDialog";
import { DeleteInvoiceLineItemDialog } from "@/components/billing/DeleteInvoiceLineItemDialog";
import { InvoiceDeletionLogPanel } from "@/components/billing/InvoiceDeletionLogPanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Search,
  ExternalLink,
  Loader2,
  X,
  FileText,
  CreditCard,
  Ban,
  CheckCircle2,
  Clock,
  Save,
  Printer,
  Eye,
  Plus,
  Trash2,
  Pencil,
  Check,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OwnerClientSearch } from "@/components/OwnerClientSearch";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type PaymentMethod = Database["public"]["Enums"]["payment_method"];
type TransactionType = Database["public"]["Enums"]["transaction_type"];

const LOW_BALANCE_THRESHOLD = 500;

const TX_BADGE: Record<string, { label: string; className: string }> = {
  top_up: { label: "Top Up", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  manual_topup: { label: "Manual Top-up", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  deduction: { label: "Deduction", className: "bg-red-50 text-red-700 border-red-200" },
  membership_fee: { label: "Membership Fee", className: "bg-purple-50 text-purple-700 border-purple-200" },
  refund: { label: "Refund", className: "bg-sky-50 text-sky-700 border-sky-200" },
  adjustment: { label: "Adjustment", className: "bg-gray-100 text-gray-600 border-gray-200" },
  card_payment: { label: "Card Payment", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  cash_payment: { label: "Cash Payment", className: "bg-teal-50 text-teal-700 border-teal-200" },
  bank_transfer_payment: { label: "Bank Transfer", className: "bg-amber-50 text-amber-800 border-amber-200" },
};

const INVOICE_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600 border-slate-200" },
  issued: { label: "Issued", className: "bg-blue-50 text-blue-700 border-blue-200" },
  finalised: { label: "Finalised", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  paid: { label: "Paid", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  partially_paid: { label: "Partial", className: "bg-amber-50 text-amber-700 border-amber-200" },
  outstanding: { label: "Outstanding", className: "bg-orange-50 text-orange-700 border-orange-200" },
  overdue: { label: "Overdue", className: "bg-red-50 text-red-700 border-red-200" },
  voided: { label: "Voided", className: "bg-gray-100 text-gray-500 border-gray-200" },
  consolidated: { label: "Consolidated", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-500 border-gray-200" },
};


// ── WalletModal ──────────────────────────────────────────────────────────────

type ModalMode = "topup" | "deduct";

interface WalletModalProps {
  open: boolean;
  mode: ModalMode;
  ownerId: string;
  onClose: () => void;
}

function WalletModal({ open, mode, ownerId, onClose }: WalletModalProps) {
  const topUp = useTopUpWallet();
  const deduct = useDeductWallet();
  const { staffName } = useCurrentStaffName();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState("");
  const isPending = topUp.isPending || deduct.isPending;

  const reset = () => { setAmount(""); setMethod("cash"); setNotes(""); };
  const handleClose = () => { if (!isPending) { reset(); onClose(); } };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) { toast.error("Enter a valid amount"); return; }
    const payload = {
      owner_id: ownerId,
      amount: numAmount,
      payment_method: method,
      notes: notes.trim() || null,
      issued_by: staffName.trim() || "reception",
    };
    const mutation = mode === "topup" ? topUp : deduct;
    const successMsg = mode === "topup"
      ? `AED ${numAmount.toFixed(2)} added to wallet`
      : `AED ${numAmount.toFixed(2)} deducted from wallet`;
    mutation.mutate(payload, {
      onSuccess: (data) => {
        if (mode === "topup" && data?.id) {
          toast.success(successMsg, {
            action: {
              label: "Print receipt",
              onClick: () =>
                window.open(
                  `/print/topup-receipt/${data.id}`,
                  "_blank",
                  "noopener,noreferrer",
                ),
            },
          });
        } else {
          toast.success(successMsg);
        }
        handleClose();
      },
      onError: (err) => toast.error(err.message || "Transaction failed"),
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "topup"
              ? <><ArrowUpCircle className="h-5 w-5 text-emerald-600" /> Top Up Wallet</>
              : <><ArrowDownCircle className="h-5 w-5 text-red-500" /> Deduct from Wallet</>}
          </DialogTitle>
          <DialogDescription>
            {mode === "topup" ? "Add funds to the owner's wallet." : "Remove funds from the owner's wallet."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="tx_amount">Amount (AED) <span className="text-destructive">*</span></Label>
            <Input id="tx_amount" type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tx_method">Payment method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="tx_method"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WALLET_TOPUP_PAYMENT_METHOD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tx_notes">Notes (optional)</Label>
            <Textarea id="tx_notes" rows={2} placeholder="e.g. monthly top-up" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending} className={mode === "topup" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-destructive hover:bg-destructive/90"}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "topup" ? "Add Funds" : "Deduct"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── PaymentDialog ────────────────────────────────────────────────────────────

function PaymentDialog({ open, invoice, onClose }: { open: boolean; invoice: InvoiceWithItems | null; onClose: () => void }) {
  const processPayment = useProcessPayment();
  const { data: owner } = useOwner(invoice?.owner_id ?? "");
  const [method, setMethod] = useState<BillingPaymentMethod>("wallet");
  const [staffName, setStaffName] = useState("");
  const [amountAed, setAmountAed] = useState("");
  const [walletCreditPromptOpen, setWalletCreditPromptOpen] = useState(false);
  const [duplicatePayment, setDuplicatePayment] = useState<DuplicatePaymentInfo | null>(null);
  const [pendingMethod, setPendingMethod] = useState<BillingPaymentMethod | null>(null);

  useEffect(() => {
    if (!open || !invoice) return;
    setMethod("wallet");
    setAmountAed("");
    setWalletCreditPromptOpen(false);
    setDuplicatePayment(null);
    setPendingMethod(null);
  }, [open, invoice?.id]);

  if (!invoice) return null;

  const walletBalance = ownerWalletCredit(owner?.wallet_balance);

  const pay = invoiceDisplayTotals({
    total: invoice.total,
    vat_aed: invoice.vat_aed,
    service_type: invoice.service_type,
    notes: invoice.notes,
  });
  const outstanding = Math.max(0, pay.grandTotal - (invoice.amount_paid ?? 0));

  const submitPayment = async (
    paymentMethod: BillingPaymentMethod = method,
    confirmDuplicate = false,
  ) => {
    if (!staffName.trim()) { toast.error("Enter staff name"); return; }
    const parsedAmount =
      paymentMethod === "wallet" ? undefined : parseFloat(amountAed || String(outstanding));
    try {
      const result = await processPayment.mutateAsync({
        invoiceId: invoice.id,
        method: paymentMethod,
        staffName: staffName.trim(),
        amountAed: parsedAmount,
        confirmDuplicate,
      });
      if (result.duplicate && !confirmDuplicate) {
        setPendingMethod(paymentMethod);
        setDuplicatePayment(result.duplicate);
        return;
      }
      setDuplicatePayment(null);
      setPendingMethod(null);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed.");
    }
  };

  const handlePay = () => {
    if (!staffName.trim()) { toast.error("Enter staff name"); return; }
    if (method !== "wallet" && ownerHasWalletCredit(owner?.wallet_balance)) {
      setWalletCreditPromptOpen(true);
      return;
    }
    void submitPayment();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Process Payment
          </DialogTitle>
          <DialogDescription>
            Invoice {invoice.invoice_number ?? invoice.id.slice(0, 8)} — outstanding {formatAed(outstanding)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Grand total</span><span>{formatAed(pay.grandTotal)}</span></div>
            <div className="flex justify-between font-semibold border-t pt-1"><span>Outstanding</span><span>{formatAed(outstanding)}</span></div>
          </div>
          <div className="space-y-2">
            <Label>Payment method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as BillingPaymentMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INVOICE_PAYMENT_METHOD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {method !== "wallet" && (
            <div className="space-y-2">
              <Label>Amount (AED)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                max={outstanding}
                value={amountAed || outstanding.toFixed(2)}
                onChange={(e) => setAmountAed(e.target.value)}
              />
            </div>
          )}
          {method !== "wallet" && ownerHasWalletCredit(owner?.wallet_balance) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Owner has {formatAed(walletBalance)} wallet credit — prefer wallet unless they paid externally.
            </div>
          )}
          <StaffNameSelect value={staffName} onChange={setStaffName} label="Staff name" />
        </div>
        <DialogFooter className="gap-2 pt-4">
          <Button variant="outline" onClick={onClose} disabled={processPayment.isPending}>Cancel</Button>
          <Button type="button" className="bg-emerald-600 hover:bg-emerald-700" disabled={processPayment.isPending} onClick={handlePay}>
            {processPayment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {method === "wallet" ? `Pay ${formatAed(outstanding)}` : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <WalletCreditExternalPaymentDialog
      open={walletCreditPromptOpen}
      onOpenChange={setWalletCreditPromptOpen}
      walletBalance={walletBalance}
      outstanding={outstanding}
      externalMethod={method === "wallet" ? null : method}
      onUseWallet={() => {
        setWalletCreditPromptOpen(false);
        setMethod("wallet");
      }}
      onContinueExternal={() => {
        setWalletCreditPromptOpen(false);
        void submitPayment(method);
      }}
    />

    <DuplicatePaymentConfirmDialog
      open={!!duplicatePayment}
      duplicate={duplicatePayment}
      submitting={processPayment.isPending}
      onConfirm={() => void submitPayment(pendingMethod ?? method, true)}
      onCancel={() => {
        setDuplicatePayment(null);
        setPendingMethod(null);
      }}
    />
    </>
  );
}

// ── VoidDialog ───────────────────────────────────────────────────────────────

function VoidDialog({ open, invoice, ownerId, onClose }: { open: boolean; invoice: InvoiceWithItems | null; ownerId: string; onClose: () => void }) {
  const voidInvoice = useVoidInvoice();
  const [reason, setReason] = useState("");
  const [staffName, setStaffName] = useState("");
  const [refundAmount, setRefundAmount] = useState("0");

  const { data: refundCalc } = useCalculateCancellationRefund(
    ownerId,
    invoice?.id ?? null,
    invoice?.created_at ?? null,
  );

  useEffect(() => {
    if (refundCalc) setRefundAmount(refundCalc.refundAed.toFixed(2));
  }, [refundCalc]);

  if (!invoice) return null;

  const handleVoid = async () => {
    if (!reason.trim()) { toast.error("Enter a reason"); return; }
    if (!staffName.trim()) { toast.error("Enter staff name"); return; }
    await voidInvoice.mutateAsync({
      invoiceId: invoice.id,
      reason: reason.trim(),
      refundAmount: parseFloat(refundAmount) || 0,
      staffName: staffName.trim(),
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Ban className="h-5 w-5" /> Void Invoice
          </DialogTitle>
          <DialogDescription>
            Invoice {invoice.invoice_number ?? invoice.id.slice(0, 8)} —{" "}
            {formatAed(
              invoiceDisplayTotals({
                total: invoice.total,
                vat_aed: invoice.vat_aed,
                service_type: invoice.service_type,
                notes: invoice.notes,
              }).grandTotal,
            )}{" "}
            incl. VAT
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {refundCalc && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm space-y-1">
              <p className="font-medium text-amber-900">{refundCalc.policyLabel}</p>
              <p className="text-amber-700">
                {refundCalc.hoursNotice.toFixed(0)}h notice — {refundCalc.refundPct}% refund = {formatAed(refundCalc.refundAed)}
              </p>
              {refundCalc.overrideActive && (
                <p className="text-amber-800 font-medium">Full refund override active for this owner</p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label>Refund amount (AED)</Label>
            <Input type="number" min="0" step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea rows={2} placeholder="Why is this invoice being voided?" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Approved by <span className="text-destructive">*</span></Label>
            <Input placeholder="Staff name" value={staffName} onChange={(e) => setStaffName(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2 pt-4">
          <Button variant="outline" onClick={onClose} disabled={voidInvoice.isPending}>Cancel</Button>
          <Button variant="destructive" disabled={voidInvoice.isPending} onClick={handleVoid}>
            {voidInvoice.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Void Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── InvoiceDetailDialog ──────────────────────────────────────────────────────

function InvoiceDetailDialog({
  open,
  invoice,
  ownerName,
  ownerId,
  onClose,
  onInvoiceUpdated,
}: {
  open: boolean;
  invoice: InvoiceWithItems | null;
  ownerName: string;
  ownerId?: string;
  onClose: () => void;
  onInvoiceUpdated?: () => void;
}) {
  const navigate = useNavigate();
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [deleteLineTarget, setDeleteLineTarget] = useState<{ id: string; description: string } | null>(null);
  const handlePrint = useCallback(() => {
    if (!invoice) return;
    window.open(
      `/print/invoice/${invoice.id}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [invoice]);

  if (!invoice) return null;

  const view = invoiceDisplayTotals({
    total: invoice.total,
    vat_aed: invoice.vat_aed,
    service_type: invoice.service_type,
    notes: invoice.notes,
  });

  const sb = INVOICE_STATUS_BADGE[invoice.status] ?? INVOICE_STATUS_BADGE.draft;
  const lineItems = invoice.line_items ?? [];
  const canDeleteLines = canDeleteInvoiceLineItems(invoice.status);

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Invoice {invoice.invoice_number ?? invoice.id.slice(0, 8)}
          </DialogTitle>
          <DialogDescription>
            Created {format(parseISO(invoice.created_at), "d MMM yyyy")}
          </DialogDescription>
        </DialogHeader>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>INVOICE</div>
              <p style={{ color: "#666", marginTop: 4 }}>{invoice.invoice_number ?? invoice.id.slice(0, 8)}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontWeight: 600 }}>{ownerName}</p>
              <p style={{ color: "#666", fontSize: 13 }}>{format(parseISO(invoice.created_at), "d MMMM yyyy")}</p>
              {invoice.due_date && <p style={{ color: "#666", fontSize: 13 }}>Due: {invoice.due_date}</p>}
              <span style={{ display: "inline-block", marginTop: 4, padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, textTransform: "uppercase" as const, border: "1px solid #ccc", background: "#f5f5f5" }}>
                {sb.label}
              </span>
            </div>
          </div>

          {invoice.service_type && (
            <p style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
              Service: <span style={{ textTransform: "capitalize" as const }}>{invoice.service_type.replace(/_/g, " ")}</span>
            </p>
          )}

          <hr style={{ border: "none", borderTop: "1px solid #e5e5e5", margin: "12px 0" }} />

          {lineItems.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8f8f8" }}>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 12, color: "#666", borderBottom: "2px solid #e5e5e5" }}>Description</th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 12, color: "#666", borderBottom: "2px solid #e5e5e5" }}>Qty</th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 12, color: "#666", borderBottom: "2px solid #e5e5e5" }}>Unit Price</th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 12, color: "#666", borderBottom: "2px solid #e5e5e5" }}>Total</th>
                  {canDeleteLines && (
                    <th style={{ width: 40, padding: "8px 4px", borderBottom: "2px solid #e5e5e5" }} aria-label="Remove line" />
                  )}
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li) => (
                  <tr key={li.id}>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>{li.description ?? li.pricing_key ?? "—"}</td>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #eee", textAlign: "right" }}>{li.quantity}</td>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #eee", textAlign: "right" }}>{formatAed(li.unit_price)}</td>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #eee", textAlign: "right", fontWeight: 600 }}>{formatAed(li.line_total)}</td>
                    {canDeleteLines && ownerId && (
                      <td style={{ padding: "4px", borderBottom: "1px solid #eee", textAlign: "right" }}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          data-testid="billing-delete-line-btn"
                          aria-label={`Remove ${li.description ?? li.pricing_key ?? "line item"}`}
                          onClick={() =>
                            setDeleteLineTarget({
                              id: li.id,
                              description: li.description ?? li.pricing_key ?? "Line item",
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: "#999", padding: "16px 0" }}>No line items</p>
          )}

          <hr style={{ border: "none", borderTop: "1px solid #e5e5e5", margin: "12px 0" }} />

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: 240 }}>
              <span style={{ color: "#666" }}>Subtotal</span>
              <span>{formatAed(invoice.subtotal)}</span>
            </div>
            {invoice.discount_amount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", width: 240 }}>
                <span style={{ color: "#666" }}>
                  Discount ({invoiceDiscountPercent({
                    subtotal: invoice.subtotal,
                    discount_amount: invoice.discount_amount,
                  })}%)
                </span>
                <span style={{ color: "#16a34a" }}>-{formatAed(invoice.discount_amount)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", width: 240 }}>
              <span style={{ color: "#666" }}>Subtotal (ex VAT)</span>
              <span>{formatAed(view.netExVat)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", width: 240 }}>
              <span style={{ color: "#666" }}>{vatLineLabel()}</span>
              <span>{formatAed(view.vat)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", width: 240, fontWeight: 700, fontSize: 18, borderTop: "2px solid #111", paddingTop: 8, marginTop: 4 }}>
              <span>Grand total (incl. VAT)</span>
              <span>{formatAed(view.grandTotal)}</span>
            </div>
          </div>

          {invoice.paid_at && (
            <p style={{ marginTop: 16, fontSize: 13, color: "#16a34a" }}>
              Paid on {format(parseISO(invoice.paid_at), "d MMM yyyy")} via {invoice.paymentMethod ?? "—"}
            </p>
          )}
          {invoice.voided_at && (
            <p style={{ marginTop: 16, fontSize: 13, color: "#dc2626" }}>
              Voided on {format(parseISO(invoice.voided_at), "d MMM yyyy")}
              {invoice.voided_reason ? ` — ${invoice.voided_reason}` : ""}
            </p>
          )}
          {invoice.notes && (
            <p style={{ marginTop: 12, fontSize: 13, color: "#666" }}>Notes: {invoice.notes}</p>
          )}
        </div>

        <DialogFooter className="gap-2 pt-4 flex-wrap">
          {ownerId && invoice && canEditInvoiceLineItems(invoice.status) && (
            <Button variant="secondary" onClick={() => setAddLineOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add line item
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!invoice) return;
              navigate(`/billing/invoices/${invoice.id}`);
            }}
          >
            Open full view
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {ownerId && invoice && (
      <AddInvoiceLineItemDialog
        open={addLineOpen}
        onOpenChange={setAddLineOpen}
        invoiceId={invoice.id}
        ownerId={ownerId}
        serviceType={invoice.service_type}
        invoiceLabel={invoice.invoice_number ?? undefined}
        onAdded={onInvoiceUpdated}
      />
    )}
    {ownerId && invoice && (
      <DeleteInvoiceLineItemDialog
        open={!!deleteLineTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteLineTarget(null);
        }}
        lineItem={deleteLineTarget}
        invoiceId={invoice.id}
        ownerId={ownerId}
        onDeleted={onInvoiceUpdated}
      />
    )}
    </>
  );
}

// ── TransactionRow ───────────────────────────────────────────────────────────

function TransactionRow({ tx }: { tx: WalletTransaction }) {
  const isCredit = tx.amount > 0;
  const badge = TX_BADGE[tx.transaction_type] ?? TX_BADGE.adjustment;
  return (
    <TableRow>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {format(parseISO(tx.created_at), "d MMM yyyy, HH:mm")}
      </TableCell>
      <TableCell><Badge variant="outline" className={badge.className}>{badge.label}</Badge></TableCell>
      <TableCell className="text-sm max-w-[200px] truncate" title={tx.notes ?? ""}>{tx.notes || <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className={`text-sm font-semibold tabular-nums text-right whitespace-nowrap ${isCredit ? "text-emerald-600" : "text-red-500"}`}>
        {isCredit ? "+" : ""}{tx.amount.toFixed(2)}
      </TableCell>
      <TableCell className="text-sm tabular-nums text-right whitespace-nowrap text-muted-foreground">AED {tx.balance_after.toFixed(2)}</TableCell>
    </TableRow>
  );
}

// ── OwnerSearchBar ───────────────────────────────────────────────────────────

interface OwnerSearchBarProps {
  onSelect: (id: string, label: string) => void;
  selectedLabel: string | null;
  selectedOwnerId: string | null;
  onClear: () => void;
}

function OwnerSearchBar({ onSelect, selectedLabel, selectedOwnerId, onClear }: OwnerSearchBarProps) {
  const navigate = useNavigate();

  if (selectedLabel && selectedOwnerId) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2.5 max-w-lg">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <button type="button" className="flex-1 min-w-0 text-left text-sm font-medium hover:underline truncate" onClick={() => navigate(`/customers/${selectedOwnerId}`)}>
          {selectedLabel}
        </button>
        <button type="button" onClick={onClear} className="rounded-full p-0.5 hover:bg-muted transition-colors shrink-0" aria-label="Clear selection">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <OwnerClientSearch
      className="max-w-lg"
      minChars={1}
      inputTestId="billing-owner-search"
      selectedId={null}
      selectedLabel={null}
      onSelect={onSelect}
      onClear={onClear}
    />
  );
}

// ── WalletTab ────────────────────────────────────────────────────────────────

function WalletTab({ ownerId, owner }: { ownerId: string; owner: { first_name: string; last_name: string; phone: string; wallet_balance: number; id: string } }) {
  const navigate = useNavigate();
  const { data: transactions, isLoading: txLoading } = useWalletTransactions(ownerId);
  const createInvoice = useCreateInvoice();
  const { getPrice } = usePricing();
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const balance = owner.wallet_balance;
  const isLowBalance = balance < LOW_BALANCE_THRESHOLD;
  const registrationFee = getPrice("registration_member");

  const chargeRegistrationFee = () => {
    const amount = registrationFee;
    if (!amount || amount <= 0) {
      toast.error("Registration fee is not configured in pricing.");
      return;
    }
    createInvoice.mutate({
      ownerId,
      serviceType: "membership",
      breakdown: {
        lineItems: [{
          pricingKey: "registration_member",
          label: "Member registration fee",
          quantity: 1,
          unitPrice: amount,
          total: amount,
        }],
        subtotal: amount,
        discountPct: 0,
        discountAed: 0,
        total: amount,
        memberType: "none",
      },
      notes: "Registration fee",
    }, {
      onSuccess: () => toast.success("Registration fee draft invoice created."),
      onError: (err) => toast.error(err.message || "Failed to create registration fee invoice."),
    });
  };

  return (
    <>
      {isLowBalance && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Low wallet balance — <strong>{formatAed(balance)}</strong>. Consider topping up.</span>
        </div>
      )}
      <Card>
        <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div role="button" tabIndex={0} className="space-y-1.5 cursor-pointer rounded-lg p-1 -m-1 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => navigate(`/customers/${owner.id}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/customers/${owner.id}`); } }}>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-semibold">{ownerDisplayName(owner.first_name, owner.last_name)}</h2>
              <Badge variant="outline">Woof</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{owner.phone}</p>
          </div>
          <div className="flex flex-col items-start gap-4 sm:items-end">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Wallet className="h-3.5 w-3.5" /> Wallet Balance</p>
              <p className={`mt-1 text-4xl font-bold tabular-nums ${isLowBalance ? "text-amber-600" : ""}`}>{formatAed(balance)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setModalMode("topup")}>
                <ArrowUpCircle className="mr-1.5 h-4 w-4" /> Top Up
              </Button>
              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setModalMode("deduct")}>
                <ArrowDownCircle className="mr-1.5 h-4 w-4" /> Deduct
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={chargeRegistrationFee}
                disabled={createInvoice.isPending}
                title="Create membership registration invoice"
              >
                {createInvoice.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Charge registration
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Legacy `boarding_*` pricing rows may still exist in the database for backwards compatibility.
        Current boarding billing resolves by room `pricing_category` / `room_type` keys (for example `royal_single`, `family_family`).
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Transaction History</CardTitle></CardHeader>
        <CardContent className="p-0">
          {txLoading ? (
            <div className="p-6 space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : !transactions || transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <Wallet className="h-8 w-8 mb-2 opacity-40" /><p className="text-sm">No transactions yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="min-w-[160px]">Date</TableHead>
                  <TableHead className="min-w-[140px]">Type</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right min-w-[100px]">Amount</TableHead>
                  <TableHead className="text-right min-w-[130px]">Balance After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{transactions.map((tx) => <TransactionRow key={tx.id} tx={tx} />)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {modalMode && <WalletModal open={!!modalMode} mode={modalMode} ownerId={ownerId} onClose={() => setModalMode(null)} />}
    </>
  );
}

// ── InvoicesTab ──────────────────────────────────────────────────────────────

function InvoicesTab({ ownerId, ownerName }: { ownerId: string; ownerName: string }) {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const collectPayment = useCollectPayment();
  const [collectPaymentInvoice, setCollectPaymentInvoice] = useState<
    { id: string; total: number; ownerId: string } | null
  >(null);
  const [payInvoice, setPayInvoice] = useState<InvoiceWithItems | null>(null);
  const [voidInvoice, setVoidInvoice] = useState<InvoiceWithItems | null>(null);
  const [viewInvoice, setViewInvoice] = useState<InvoiceWithItems | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [consolidateOpen, setConsolidateOpen] = useState(false);

  const filters = statusFilter !== "all" ? { status: statusFilter as InvoiceStatus } : undefined;
  const { data: invoices = [], isLoading, refetch: refetchInvoices } = useInvoicesForOwner(ownerId, filters);

  const ownerBalances = useOwnerBalances(ownerId);
  const [payAllPending, setPayAllPending] = useState(false);
  const [payAllConfirmOpen, setPayAllConfirmOpen] = useState(false);

  const bulkPayableInvoices = useMemo(
    () => filterBulkWalletPayableInvoices(ownerBalances.invoices),
    [ownerBalances.invoices],
  );
  const bulkPayableTotal = useMemo(
    () => bulkWalletPayableTotal(bulkPayableInvoices),
    [bulkPayableInvoices],
  );
  const skippedFutureBoardingCount = Math.max(
    0,
    ownerBalances.invoices.length - bulkPayableInvoices.length,
  );

  const consolidatableCount = useMemo(
    () => invoices.filter((inv) => canConsolidateInvoiceStatus(inv.status)).length,
    [invoices],
  );

  const handleCollectPayment = (inv: InvoiceWithItems) => {
    if ((inv.total ?? 0) === 0) {
      // Zero-value invoice — close directly to paid, no dialog.
      collectPayment.mutate(
        { invoiceId: inv.id, total: 0, ownerId: inv.owner_id },
        {
          onSuccess: () => toast.success(`Invoice ${inv.invoice_number ?? ""} closed`),
          onError: (err) => toast.error(err.message),
        },
      );
      return;
    }
    setCollectPaymentInvoice({
      id: inv.id,
      total: (inv.total ?? 0) - (inv.amount_paid ?? 0),
      ownerId: inv.owner_id,
    });
  };

  return (
    <>
      {!ownerBalances.isLoading && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <p className="text-xs uppercase text-muted-foreground">Account balance (SOA)</p>
            <WalletBalanceDisplay
              accountBalance={ownerBalances.netPosition}
              size="compact"
              amountClassName={
                ownerBalances.netPosition < 0 ? "text-red-600 dark:text-red-400" : undefined
              }
            />
            {ownerBalances.invoiceRemainingTotal > 0 && ownerBalances.netPosition >= 0 && (
              <OutstandingAmountBadge amount={ownerBalances.invoiceRemainingTotal} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Filter + actions bar */}
      {consolidatableCount >= 2 && selectedIds.length === 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {consolidatableCount} open invoices — tick the checkboxes below, then click{" "}
          <span className="font-medium">Consolidate selected</span>.
        </div>
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="finalised">Finalised</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="partially_paid">Partial</SelectItem>
            <SelectItem value="outstanding">Outstanding</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="voided">Voided</SelectItem>
            <SelectItem value="consolidated">Consolidated</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        {selectedIds.length >= 2 && (
          <Button
            size="sm"
            variant="secondary"
            data-testid="billing-owner-consolidate-btn"
            onClick={() => setConsolidateOpen(true)}
          >
            Consolidate selected ({selectedIds.length})
          </Button>
        )}

        {bulkPayableTotal > 0 && ownerBalances.combinedWallet > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={payAllPending}
            data-testid="billing-pay-all-outstanding-btn"
            onClick={() => setPayAllConfirmOpen(true)}
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            Pay all outstanding ({formatWalletAed(bulkPayableTotal)})
          </Button>
        )}
      </div>

      <AlertDialog open={payAllConfirmOpen} onOpenChange={setPayAllConfirmOpen}>
        <AlertDialogContent data-testid="billing-pay-all-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Pay outstanding from wallet?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Apply wallet credit toward{" "}
                  <span className="font-medium text-foreground">
                    {bulkPayableInvoices.length} invoice
                    {bulkPayableInvoices.length !== 1 ? "s" : ""}
                  </span>{" "}
                  totaling{" "}
                  <span className="font-medium text-foreground">
                    {formatWalletAed(bulkPayableTotal)}
                  </span>
                  ? Invoices are paid oldest due date first.
                </p>
                {skippedFutureBoardingCount > 0 && (
                  <p>
                    {skippedFutureBoardingCount} future-dated boarding invoice
                    {skippedFutureBoardingCount !== 1 ? "s are" : " is"} skipped — pay
                    those individually if needed.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={payAllPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={payAllPending || bulkPayableInvoices.length === 0}
              data-testid="billing-pay-all-confirm-btn"
              onClick={(e) => {
                e.preventDefault();
                setPayAllPending(true);
                void ownerBalances
                  .payAllOutstanding("bulk_payment", {
                    invoiceIds: bulkPayableInvoices.map((inv) => inv.invoice_id),
                  })
                  .finally(() => {
                    setPayAllPending(false);
                    setPayAllConfirmOpen(false);
                  });
              }}
            >
              {payAllPending ? "Processing…" : "Confirm payment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invoice list */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <FileText className="h-8 w-8 mb-2 opacity-40" /><p className="text-sm">No invoices yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-10" />
                  <TableHead className="min-w-[120px]">Invoice #</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="min-w-[100px]">Date</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right min-w-[100px]">Total</TableHead>
                  <TableHead className="text-right min-w-[200px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => {
                  const sb = INVOICE_STATUS_BADGE[inv.status] ?? INVOICE_STATUS_BADGE.draft;
                  const canFinalise = inv.status === "draft";
                  const canPay = ["finalised", "issued", "outstanding", "overdue", "partially_paid"].includes(inv.status);
                  const canVoid = !["cancelled", "voided", "consolidated", "paid"].includes(inv.status);
                  const canSelect = canConsolidateInvoiceStatus(inv.status);
                  return (
                    <TableRow key={inv.id}>
                      <TableCell>
                        {canSelect ? (
                          <Checkbox
                            checked={selectedIds.includes(inv.id)}
                            onCheckedChange={(checked) => {
                              setSelectedIds((prev) =>
                                checked
                                  ? [...prev, inv.id]
                                  : prev.filter((id) => id !== inv.id),
                              );
                            }}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setViewInvoice(inv)}>
                          {inv.invoice_number ?? inv.id.slice(0, 8)}
                        </button>
                      </TableCell>
                      <TableCell>
                        {inv.branch_code ? (
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {inv.branch_code}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(parseISO(inv.created_at), "d MMM yyyy")}</TableCell>
                      <TableCell className="text-sm capitalize">{inv.service_type?.replace(/_/g, " ") ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={sb.className}>{sb.label}</Badge></TableCell>
                      <TableCell className="text-sm font-semibold tabular-nums text-right">
                        {formatAed(
                          invoiceDisplayTotals({
                            total: inv.total,
                            vat_aed: inv.vat_aed,
                            service_type: inv.service_type,
                            notes: inv.notes,
                          }).grandTotal,
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setViewInvoice(inv)} title="View invoice">
                            <Eye className="mr-1 h-3.5 w-3.5" /> View
                          </Button>
                          {canFinalise && (
                            <Button size="sm" variant="outline" disabled={collectPayment.isPending} onClick={() => handleCollectPayment(inv)}>
                              <CreditCard className="mr-1 h-3.5 w-3.5" /> Collect Payment
                            </Button>
                          )}
                          {canPay && (
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setPayInvoice(inv)}>
                              <CreditCard className="mr-1 h-3.5 w-3.5" /> Pay
                            </Button>
                          )}
                          {canVoid && (
                            <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => setVoidInvoice(inv)}>
                              <Ban className="mr-1 h-3.5 w-3.5" /> Void
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PaymentDialog open={!!payInvoice} invoice={payInvoice} onClose={() => setPayInvoice(null)} />
      <VoidDialog open={!!voidInvoice} invoice={voidInvoice} ownerId={ownerId} onClose={() => setVoidInvoice(null)} />
      <InvoiceDetailDialog
        open={!!viewInvoice}
        invoice={viewInvoice}
        ownerName={ownerName}
        ownerId={ownerId}
        onClose={() => setViewInvoice(null)}
        onInvoiceUpdated={() => {
          void refetchInvoices().then(({ data }) => {
            if (!viewInvoice) return;
            const fresh = data?.find((i) => i.id === viewInvoice.id);
            if (fresh) setViewInvoice(fresh);
          });
        }}
      />

      <ConsolidateInvoicesDialog
        open={consolidateOpen}
        onOpenChange={setConsolidateOpen}
        ownerId={ownerId}
        invoiceIds={selectedIds}
        onSuccess={() => {
          setSelectedIds([]);
          refetchInvoices();
        }}
      />

      {collectPaymentInvoice && (
        <PaymentSplitDialog
          open={!!collectPaymentInvoice}
          onOpenChange={(o) => {
            if (!o) setCollectPaymentInvoice(null);
          }}
          invoiceId={collectPaymentInvoice.id}
          ownerId={collectPaymentInvoice.ownerId}
          invoiceTotal={collectPaymentInvoice.total}
          onSuccess={() => setCollectPaymentInvoice(null)}
        />
      )}
    </>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

const BillingPage = () => {
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"wallet" | "invoices" | "pricing" | "deletion-log">("wallet");

  const { data: owner, isLoading: ownerLoading } = useOwner(selectedOwnerId ?? "");

  const handleSelect = (id: string, label: string) => {
    setSelectedOwnerId(id);
    setSelectedLabel(label);
    setActiveTab("invoices");
  };
  const handleClear = () => { setSelectedOwnerId(null); setSelectedLabel(null); };

  return (
    <>
      <TopBar title="Billing & Wallets" />
      <main className="flex-1 overflow-auto p-8 space-y-6">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Select Owner</p>
          <OwnerSearchBar onSelect={handleSelect} selectedLabel={selectedLabel} selectedOwnerId={selectedOwnerId} onClear={handleClear} />
        </div>

        {!selectedOwnerId ? (
          <BillingWorkspaceTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            showInvoicesTab={false}
            walletContent={
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <Wallet className="h-12 w-12 text-muted-foreground/40 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">Search for an owner above to view their wallet</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Type a name or phone number to get started</p>
              </div>
            }
            pricingContent={<PricingTab />}
            deletionLogContent={<InvoiceDeletionLogPanel />}
          />
        ) : ownerLoading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : owner ? (
          <BillingWorkspaceTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            showInvoicesTab
            invoicesListLabel="Browse all invoices"
            walletContent={<WalletTab ownerId={selectedOwnerId} owner={owner} />}
            invoicesContent={
              <InvoicesTab
                ownerId={selectedOwnerId}
                ownerName={ownerDisplayName(owner.first_name, owner.last_name)}
              />
            }
            pricingContent={<PricingTab />}
            deletionLogContent={<InvoiceDeletionLogPanel />}
          />
        ) : (
          <p className="text-muted-foreground">Owner not found.</p>
        )}
      </main>
    </>
  );
};

export default BillingPage;
