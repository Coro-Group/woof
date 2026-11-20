import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { planDaycareCheckInCancel } from "@/lib/daycareCancelCheckIn";
import { voidInvoicePreviewText } from "@/lib/voidInvoice";

type Props = {
  open: boolean;
  sessionId: string | null;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  onConfirm: (input: { sessionId: string; reason: string; staff: string }) => Promise<void>;
};

export function CancelDaycareCheckInDialog({
  open,
  sessionId,
  onOpenChange,
  pending = false,
  onConfirm,
}: Props) {
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

  const plan = useQuery({
    queryKey: ["daycare-cancel-plan", sessionId],
    enabled: open && !!sessionId,
    queryFn: () => planDaycareCheckInCancel(sessionId as string),
  });

  const busy = pending || submitting || plan.isLoading;
  const canSubmit = !!sessionId && reason.trim().length > 0 && staff.trim().length > 0 && !busy && !plan.isError;

  const handleConfirm = async () => {
    if (!sessionId || !canSubmit) {
      if (!reason.trim()) toast.error("A reason is required.");
      else if (!staff.trim()) toast.error("Staff name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm({ sessionId, reason: reason.trim(), staff: staff.trim() });
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not cancel check-in.");
    } finally {
      setSubmitting(false);
    }
  };

  const invoices = (plan.data?.invoices ?? []).filter((invoice) => invoice.canVoid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="daycare-cancel-checkin-dialog">
        <DialogHeader>
          <DialogTitle>Cancel check-in</DialogTitle>
          <DialogDescription>
            The session is removed and package credit is restored if it was used. A linked invoice is
            voided, never deleted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {plan.isLoading ? <p className="text-muted-foreground">Loading linked invoice…</p> : null}
          {plan.isError ? (
            <p className="text-destructive">
              {plan.error instanceof Error ? plan.error.message : "Could not load this check-in."}
            </p>
          ) : null}
          {invoices.map((invoice) => (
            <p
              key={invoice.id}
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950"
              data-testid="daycare-cancel-void-preview"
            >
              {invoice.invoiceNumber ? `${invoice.invoiceNumber}. ` : ""}
              {voidInvoicePreviewText(invoice.paid, invoice.unpaid)}
            </p>
          ))}
          {plan.data && invoices.length === 0 ? (
            <p className="rounded-md border bg-muted/40 p-3 text-muted-foreground">
              {plan.data.lineRemoval
                ? "No invoice will be voided. This dog's line is removed. The shared invoice stays open for the other dogs."
                : "No invoice will be voided."}
            </p>
          ) : null}
          <div className="space-y-1">
            <Label>
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this check-in being cancelled?"
              rows={3}
              data-testid="daycare-cancel-checkin-reason"
            />
          </div>
          <StaffNameSelect value={staff} onChange={setStaff} label="Staff name" />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Keep check-in
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={!canSubmit}
            data-testid="daycare-cancel-checkin-confirm"
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Cancel check-in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
