import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StaffNameSelect } from "@/components/staff/StaffNameSelect";
import { supabase } from "@/integrations/supabase/client";
import { formatAed } from "@/hooks/useBilling";
import { useAccountBalance, accountBalanceQueryKey } from "@/hooks/useAccountBalance";
import { invoiceLedgerQueryKey } from "@/hooks/useInvoiceLedger";
import { seedInvoicePaymentSplit } from "@/lib/accountBalance";
import { payInvoiceFromWallet } from "@/lib/walletInvoicePayment";
import {
  recordExternalInvoicePayment,
  findRecentDuplicateExternalPayment,
  type DuplicatePaymentInfo,
} from "@/lib/recordExternalInvoicePayment";
import { DuplicatePaymentConfirmDialog } from "@/components/billing/DuplicatePaymentConfirmDialog";
import { roundAed } from "@/lib/money";
import { WALLET_TOPUP_PAYMENT_METHOD_OPTIONS } from "@/lib/paymentMethod";
import type { ExternalPaymentMethod } from "@/lib/paymentMethod";

export interface PaymentSplitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  ownerId: string;
  invoiceTotal: number;
  /** Flip a draft invoice to `outstanding` before recording payment. */
  ensureOutstanding?: boolean;
  defaultStaffName?: string;
  title?: string;
  onSuccess?: () => void;
}

/**
 * Wallet-first payment confirmation. Staff edit wallet and card/cash amounts;
 * any uncollected balance stays outstanding on the invoice.
 */
export function PaymentSplitDialog({
  open,
  onOpenChange,
  invoiceId,
  ownerId,
  invoiceTotal,
  ensureOutstanding,
  defaultStaffName,
  title = "Confirm payment",
  onSuccess,
}: PaymentSplitDialogProps) {
  const queryClient = useQueryClient();
  const { data: account, isLoading: accountLoading } = useAccountBalance(
    open ? ownerId : undefined,
  );
  const walletBalance = account?.walletBalance ?? 0;

  const [walletAmount, setWalletAmount] = useState("");
  const [cardAmount, setCardAmount] = useState("");
  const [method, setMethod] = useState<ExternalPaymentMethod>("card");
  const [staffName, setStaffName] = useState(defaultStaffName ?? "");
  const [submitting, setSubmitting] = useState(false);
  /** Sync guard — submitting state alone loses to double-clicks before re-render. */
  const submittingRef = useRef(false);
  const [duplicatePayment, setDuplicatePayment] = useState<DuplicatePaymentInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    const { walletSeed, cardSeed } = seedInvoicePaymentSplit(walletBalance, invoiceTotal);
    setWalletAmount(String(walletSeed));
    setCardAmount(String(cardSeed));
    setStaffName(defaultStaffName ?? "");
    setMethod("card");
  }, [open, walletBalance, invoiceTotal, defaultStaffName]);

  const walletNum = Math.max(0, roundAed(parseFloat(walletAmount) || 0));
  const cardNum = Math.max(0, roundAed(parseFloat(cardAmount) || 0));
  const totalCollecting = roundAed(walletNum + cardNum);
  const remainingAfter = roundAed(invoiceTotal - totalCollecting);

  const handleConfirm = () => runPayment(false);

  const runPayment = async (confirmDuplicate: boolean) => {
    if (submittingRef.current) return;
    if (!staffName.trim()) {
      toast.error("Enter staff name");
      return;
    }
    if (walletNum > walletBalance) {
      toast.error(`Wallet amount exceeds available balance (${formatAed(walletBalance)})`);
      return;
    }
    if (totalCollecting === 0) {
      toast.error("Enter a payment amount");
      return;
    }
    if (totalCollecting > invoiceTotal) {
      toast.error(`Total cannot exceed invoice balance (${formatAed(invoiceTotal)})`);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      // Pre-check the external leg before any writes so a confirm-and-retry never
      // re-runs the wallet deduction. Soft alert only — hard 5s DB guard still applies
      // unless staff explicitly confirm via DuplicatePaymentConfirmDialog.
      if (cardNum > 0 && !confirmDuplicate) {
        const dup = await findRecentDuplicateExternalPayment(supabase, {
          invoiceId,
          amountAed: cardNum,
          method,
        });
        if (dup) {
          setDuplicatePayment(dup);
          return;
        }
      }

      if (ensureOutstanding) {
        const { error: statusErr } = await supabase
          .from("invoices")
          .update({ status: "outstanding" })
          .eq("id", invoiceId)
          .eq("status", "draft");
        if (statusErr) throw new Error(statusErr.message);
      }

      if (walletNum > 0) {
        const res = await payInvoiceFromWallet(supabase, {
          invoiceId,
          performedBy: staffName.trim(),
          amountAed: walletNum,
        });
        if (!res.success) throw new Error(res.error || "Wallet payment failed");
      }

      if (cardNum > 0) {
        const res = await recordExternalInvoicePayment(supabase, {
          invoiceId,
          method,
          performedBy: staffName.trim(),
          amountAed: cardNum,
          confirmDuplicate,
        });
        if (!res.success) throw new Error(res.error || "Card payment failed");
      }

      await queryClient.invalidateQueries({ queryKey: invoiceLedgerQueryKey(invoiceId) });
      await queryClient.invalidateQueries({ queryKey: accountBalanceQueryKey(ownerId) });
      await queryClient.invalidateQueries({ queryKey: ["invoice-alerts"] });
      toast.success(
        remainingAfter > 0
          ? `Partial payment recorded — ${formatAed(remainingAfter)} still outstanding`
          : "Payment recorded",
      );
      setDuplicatePayment(null);
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => (!submitting ? onOpenChange(v) : undefined)}>
      <DialogContent className="sm:max-w-md" data-testid="payment-split-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Edit wallet and card/cash amounts. Any uncollected balance stays outstanding on
            the invoice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Invoice balance</span>
            <span className="tabular-nums font-medium">{formatAed(invoiceTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Wallet balance</span>
            <span className="tabular-nums font-medium text-emerald-700">
              {accountLoading ? "…" : formatAed(walletBalance)}
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="split-wallet-amount">From wallet (AED)</Label>
            <Input
              id="split-wallet-amount"
              type="number"
              min="0"
              step="0.01"
              value={walletAmount}
              onChange={(e) => setWalletAmount(e.target.value)}
              data-testid="payment-split-wallet-amount"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="split-card-amount">By card/cash (AED)</Label>
            <Input
              id="split-card-amount"
              type="number"
              min="0"
              step="0.01"
              value={cardAmount}
              onChange={(e) => setCardAmount(e.target.value)}
              data-testid="payment-split-card-amount"
            />
          </div>

          {cardNum > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="split-method">Payment method</Label>
              <Select
                value={method}
                onValueChange={(v) => setMethod(v as ExternalPaymentMethod)}
              >
                <SelectTrigger id="split-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WALLET_TOPUP_PAYMENT_METHOD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="payment_link">Payment Link</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Collecting total</span>
              <span className="tabular-nums font-medium">{formatAed(totalCollecting)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Remaining outstanding after</span>
              <span
                className={`tabular-nums font-medium ${
                  remainingAfter < 0 ? "text-red-600" : "text-muted-foreground"
                }`}
              >
                {formatAed(remainingAfter)}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Staff name</Label>
            <StaffNameSelect value={staffName} onChange={setStaffName} />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || accountLoading}
            data-testid="payment-split-confirm"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <DuplicatePaymentConfirmDialog
      open={!!duplicatePayment}
      duplicate={duplicatePayment}
      submitting={submitting}
      onConfirm={() => runPayment(true)}
      onCancel={() => setDuplicatePayment(null)}
    />
    </>
  );
}
