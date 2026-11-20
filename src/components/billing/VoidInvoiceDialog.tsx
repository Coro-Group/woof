import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StaffNameSelect } from "@/components/staff/StaffNameSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatVoidAed, loadInvoiceVoidPreview, voidInvoice, voidInvoicePreviewText, voidInvoiceRefusal } from "@/lib/voidInvoice";
import { invalidateOwnerStatementQueries } from "@/lib/statementQueryKeys";

type ConfirmInput = {
  reason: string;
  staff: string;
  paid: number;
  unpaid: number;
};

interface VoidInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  title?: string;
  description?: string;
  confirmLabel?: string;
  /** When set, the dialog does not call void_invoice itself. */
  onConfirm?: (input: ConfirmInput) => Promise<void>;
  onCompleted?: () => void;
  /** Extra wait, for example while deciding which invoice a package removal will void. */
  pending?: boolean;
  loadError?: string | null;
}

export function VoidInvoiceDialog({
  open,
  onOpenChange,
  invoiceId,
  title = "Void invoice",
  description = "Voiding keeps the invoice and its payments for history. A reason and your name are required.",
  confirmLabel = "Void invoice",
  onConfirm,
  onCompleted,
  pending = false,
  loadError = null,
}: VoidInvoiceDialogProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [staff, setStaff] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason("");
      setStaff("");
      setSubmitting(false);
    }
  }, [open]);

  const preview = useQuery({
    queryKey: ["invoice-void-preview", invoiceId],
    enabled: open && !!invoiceId,
    queryFn: () => loadInvoiceVoidPreview(invoiceId as string),
  });

  const refusal = preview.data ? voidInvoiceRefusal(preview.data.status) : null;
  const blocked =
    pending || !!loadError || (!!invoiceId && (preview.isLoading || preview.isError || !!refusal));
  const canSubmit = reason.trim().length > 0 && staff.trim().length > 0 && !blocked && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) {
      if (!reason.trim()) toast.error("A void reason is required.");
      else if (!staff.trim()) toast.error("Staff name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const paid = preview.data?.paid ?? 0;
      const unpaid = preview.data?.unpaid ?? 0;
      if (onConfirm) {
        await onConfirm({ reason: reason.trim(), staff: staff.trim(), paid, unpaid });
      } else if (invoiceId) {
        const refunded = await voidInvoice({
          invoiceId,
          reason: reason.trim(),
          staff: staff.trim(),
        });
        toast.success(
          refunded > 0
            ? `Invoice voided. ${formatVoidAed(refunded)} returned to the wallet.`
            : "Invoice voided. Nothing was paid, so no wallet credit was added.",
        );
      }
      if (invoiceId) {
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
        queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
        queryClient.invalidateQueries({ queryKey: ["invoice-ledger", invoiceId] });
        queryClient.invalidateQueries({ queryKey: ["wallet_transactions"] });
        queryClient.invalidateQueries({ queryKey: ["owners"] });
        if (preview.data?.ownerId) {
          invalidateOwnerStatementQueries(queryClient, preview.data.ownerId);
        }
      }
      onCompleted?.();
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not void invoice.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="invoice-void-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {pending || (invoiceId && preview.isLoading) ? (
            <p className="text-muted-foreground">Loading invoice…</p>
          ) : null}
          {loadError ? <p className="text-destructive">{loadError}</p> : null}
          {preview.isError ? (
            <p className="text-destructive">
              {preview.error instanceof Error ? preview.error.message : "Could not load this invoice."}
            </p>
          ) : null}
          {refusal ? <p className="text-destructive">{refusal}</p> : null}
          {preview.data && !refusal ? (
            <p
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950"
              data-testid="invoice-void-preview"
            >
              {preview.data.invoiceNumber ? `${preview.data.invoiceNumber}. ` : ""}
              {voidInvoicePreviewText(preview.data.paid, preview.data.unpaid)}
            </p>
          ) : null}
          {!invoiceId && !pending && !loadError ? (
            <p className="rounded-md border bg-muted/40 p-3 text-muted-foreground">
              No invoice will be voided.
            </p>
          ) : null}
          <div className="space-y-1">
            <Label>
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this invoice being voided?"
              rows={3}
              data-testid="invoice-void-reason"
            />
          </div>
          <StaffNameSelect value={staff} onChange={setStaff} label="Staff name" />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={!canSubmit}
            data-testid="invoice-void-confirm"
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {submitting ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
