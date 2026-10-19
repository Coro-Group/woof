import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StaffNameSelect } from "@/components/staff/StaffNameSelect";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { withoutSupersededInvoices } from "@/lib/invoiceStatus";
import { loadInvoiceVoidPreview, voidInvoice, voidInvoicePreviewText, voidInvoiceRefusal } from "@/lib/voidInvoice";
import type { BookingWithDetails } from "@/hooks/useBookings";
import { useUpdateBooking } from "@/hooks/useBookings";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingWithDetails;
  onCancelled: () => void;
};

async function loadBookingInvoicePreview(bookingId: string) {
  const { data, error } = await withoutSupersededInvoices(
    supabase
      .from("invoices")
      .select("id")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1),
  );
  if (error) throw error;
  const invoiceId = data?.[0]?.id;
  if (!invoiceId) return null;
  return loadInvoiceVoidPreview(invoiceId);
}

export function CancelBookingDialog({ open, onOpenChange, booking, onCancelled }: Props) {
  const updateBooking = useUpdateBooking();
  const [reason, setReason] = useState("");
  const [staffName, setStaffName] = useState("");
  const [voidInvoiceChecked, setVoidInvoiceChecked] = useState(false);
  const [pending, setPending] = useState(false);

  const isCheckedIn = booking.status === "checked_in";
  const preview = useQuery({
    queryKey: ["booking-void-preview", booking.id],
    enabled: open && voidInvoiceChecked,
    queryFn: () => loadBookingInvoicePreview(booking.id),
  });

  const handleConfirm = async () => {
    if (!reason.trim()) {
      toast.error("Enter a cancellation reason.");
      return;
    }
    if (!staffName.trim()) {
      toast.error("Staff name is required.");
      return;
    }
    if (voidInvoiceChecked && preview.data && !preview.data.canVoid) {
      toast.error(voidInvoiceRefusal(preview.data.status) ?? "This invoice cannot be voided.");
      return;
    }

    setPending(true);
    try {
      if (voidInvoiceChecked) {
        const invoice = preview.data ?? (await loadBookingInvoicePreview(booking.id));
        if (invoice?.canVoid) {
          await voidInvoice({
            invoiceId: invoice.id,
            reason: reason.trim(),
            staff: staffName.trim(),
          });
        } else if (invoice) {
          throw new Error(voidInvoiceRefusal(invoice.status) ?? "This invoice cannot be voided.");
        }
      }

      const patch: {
        status: "cancelled";
        actual_check_out_at?: string;
        notes?: string;
      } = {
        status: "cancelled",
        notes: [booking.notes, `Cancelled by ${staffName.trim()}: ${reason.trim()}`]
          .filter(Boolean)
          .join("\n"),
      };
      if (isCheckedIn && !booking.actual_check_out_at) {
        patch.actual_check_out_at = new Date().toISOString();
      }

      await updateBooking.mutateAsync({ id: booking.id, ...patch });

      toast.success(
        voidInvoiceChecked && preview.data?.canVoid
          ? "Booking cancelled and invoice voided."
          : "Booking cancelled.",
      );
      onCancelled();
      onOpenChange(false);
      setReason("");
      setVoidInvoiceChecked(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel booking.");
    } finally {
      setPending(false);
    }
  };

  const refusal = preview.data ? voidInvoiceRefusal(preview.data.status) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel booking</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {isCheckedIn
              ? "This dog is currently checked in. Cancelling ends the stay and cannot be undone from this screen."
              : "The booking will be marked cancelled. This does not delete invoice history."}
          </p>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this booking being cancelled?"
              rows={3}
              data-testid="boarding-cancel-booking-reason"
            />
          </div>
          <StaffNameSelect value={staffName} onChange={setStaffName} label="Logged by" />
          <div className="flex items-start gap-2">
            <Checkbox
              id="void-invoice"
              checked={voidInvoiceChecked}
              onCheckedChange={(v) => setVoidInvoiceChecked(v === true)}
            />
            <Label htmlFor="void-invoice" className="font-normal leading-snug">
              Also void the linked invoice
            </Label>
          </div>
          {voidInvoiceChecked ? (
            preview.isLoading ? (
              <p className="text-muted-foreground">Loading linked invoice…</p>
            ) : preview.data?.canVoid ? (
              <p
                className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950"
                data-testid="booking-void-preview"
              >
                {preview.data.invoiceNumber ? `${preview.data.invoiceNumber}. ` : ""}
                {voidInvoicePreviewText(preview.data.paid, preview.data.unpaid)}
              </p>
            ) : refusal ? (
              <p className="text-destructive">{refusal} Uncheck the box to cancel the booking only.</p>
            ) : (
              <p className="text-muted-foreground">No linked invoice to void.</p>
            )
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep booking
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending || (voidInvoiceChecked && preview.isLoading)}
          >
            {pending ? "Cancelling…" : "Cancel booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
