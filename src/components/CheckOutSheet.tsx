import { useEffect, useMemo, useRef, useState } from "react";
import { format, differenceInCalendarDays, parseISO, isValid } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBookingItems, useUpdateBookingItem, type BookingItem } from "@/hooks/useBookingItems";
import { useCheckOut, useUpdateBooking } from "@/hooks/useBookings";
import { OVERVIEW_ITEM_DESCRIPTION } from "@/components/CheckInSheet";
import { PaymentSplitDialog } from "@/components/billing/PaymentSplitDialog";
import { useAccountBalance, accountBalanceQueryKey } from "@/hooks/useAccountBalance";
import { formatAed } from "@/hooks/useBilling";
import { invoiceWalletBalanceDue } from "@/lib/invoiceWalletCharge";
import { withoutSupersededInvoices } from "@/lib/invoiceStatus";
import { syncBoardingRoomAssignmentsAfterDateChange } from "@/lib/boardingRoomAssignmentSync";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const THUMB = "h-[60px] w-[60px] rounded object-cover border border-border shrink-0 cursor-pointer";

type ReturnStatus = "returned" | "missing" | "damaged" | "";

type ItemState = {
  return_status: ReturnStatus;
  return_notes: string;
};

export type CheckOutSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  ownerName: string;
  petNames: string;
  roomName: string;
  checkInDate: string;
  checkOutDate: string;
  onFinished?: () => void;
};

function firstPetName(petNames: string): string {
  const p = petNames.split(",")[0]?.trim();
  return p || "Pet";
}

export function CheckOutSheet({
  open,
  onOpenChange,
  bookingId,
  ownerName,
  petNames,
  roomName,
  checkInDate,
  checkOutDate,
  onFinished,
}: CheckOutSheetProps) {
  const { data: allItems = [], isLoading } = useBookingItems(bookingId);
  const updateItem = useUpdateBookingItem();
  const checkOut = useCheckOut();
  const updateBooking = useUpdateBooking();
  const queryClient = useQueryClient();

  const checkoutBillingKey = ["checkout-billing", bookingId] as const;
  const { data: checkoutBilling } = useQuery({
    queryKey: checkoutBillingKey,
    enabled: open && !!bookingId,
    queryFn: async () => {
      const { data: booking } = await supabase
        .from("bookings")
        .select("owner_id")
        .eq("id", bookingId)
        .maybeSingle();
      const ownerId = (booking?.owner_id as string | undefined) ?? undefined;
      const { data: inv } = await withoutSupersededInvoices(
        supabase
          .from("invoices")
          .select("id, total, subtotal, discount_amount, vat_aed, service_type, notes, status, amount_paid")
          .eq("booking_id", bookingId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      return { ownerId, invoice: inv ?? null };
    },
  });
  const billingOwnerId = checkoutBilling?.ownerId;
  const checkoutInvoice = checkoutBilling?.invoice ?? null;
  const { data: account } = useAccountBalance(billingOwnerId);

  const invoiceRemaining = checkoutInvoice
    ? invoiceWalletBalanceDue({
        total: checkoutInvoice.total ?? 0,
        subtotal: checkoutInvoice.subtotal ?? 0,
        discountAmount: checkoutInvoice.discount_amount ?? 0,
        amountPaid: checkoutInvoice.amount_paid ?? 0,
      })
    : 0;

  const [payOpen, setPayOpen] = useState(false);

  const checklistItems = useMemo(
    () => allItems.filter((i) => i.description !== OVERVIEW_ITEM_DESCRIPTION),
    [allItems],
  );

  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [issuesNotes, setIssuesNotes] = useState("");
  const [staffName, setStaffName] = useState("");
  const [actualCheckOutDate, setActualCheckOutDate] = useState(checkOutDate);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const itemsSig = useMemo(
    () => [...checklistItems.map((i) => i.id)].sort().join(","),
    [checklistItems],
  );

  const initRef = useRef("");
  useEffect(() => {
    if (!open) {
      initRef.current = "";
      return;
    }
    if (isLoading) return;
    const sig = `${bookingId}:${itemsSig}:${checkOutDate}`;
    if (initRef.current === sig) return;
    initRef.current = sig;
    const next: Record<string, ItemState> = {};
    for (const it of checklistItems) {
      const rs = (it.return_status as ReturnStatus) || "";
      next[it.id] = {
        return_status: rs,
        return_notes: it.return_notes ?? "",
      };
    }
    setStates(next);
    setIssuesNotes("");
    setStaffName("");
    setActualCheckOutDate(checkOutDate);
  }, [open, isLoading, bookingId, itemsSig, checkOutDate, checklistItems]);

  const nights = (() => {
    const ci = parseISO(checkInDate);
    const co = parseISO(checkOutDate);
    if (!isValid(ci) || !isValid(co)) return 0;
    return differenceInCalendarDays(co, ci);
  })();

  const counts = useMemo(() => {
    let ret = 0,
      miss = 0,
      dmg = 0;
    for (const it of checklistItems) {
      const s = states[it.id]?.return_status;
      if (s === "returned") ret++;
      else if (s === "missing") miss++;
      else if (s === "damaged") dmg++;
    }
    return { ret, miss, dmg };
  }, [checklistItems, states]);

  const hasIssues = counts.miss > 0 || counts.dmg > 0;
  const allHaveStatus = checklistItems.every((it) => {
    const s = states[it.id]?.return_status;
    return s === "returned" || s === "missing" || s === "damaged";
  });

  const canConfirm =
    allHaveStatus &&
    staffName.trim().length > 0 &&
    (!hasIssues || issuesNotes.trim().length > 0);

  const close = () => {
    onOpenChange(false);
    onFinished?.();
  };

  const setItemState = (id: string, patch: Partial<ItemState>) => {
    setStates((prev) => ({
      ...prev,
      [id]: { ...prev[id], return_notes: prev[id]?.return_notes ?? "", ...patch },
    }));
  };

  const statusBg = (s: ReturnStatus) => {
    if (s === "returned") return "bg-emerald-50 border-emerald-200";
    if (s === "missing") return "bg-red-50 border-red-200";
    if (s === "damaged") return "bg-amber-50 border-amber-200";
    return "bg-card";
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      for (const it of checklistItems) {
        const st = states[it.id];
        if (!st?.return_status) continue;
        await updateItem.mutateAsync({
          id: it.id,
          return_status: st.return_status,
          returned: st.return_status === "returned",
          return_notes: st.return_notes.trim() || null,
        });
      }

      const nowIso = new Date().toISOString();
      const effectiveCheckOut = actualCheckOutDate;
      if (actualCheckOutDate !== checkOutDate) {
        await updateBooking.mutateAsync({
          id: bookingId,
          status: "checked_out",
          check_out_date: actualCheckOutDate,
          actual_check_out_at: nowIso,
        });
      } else {
        await checkOut.mutateAsync(bookingId);
      }

      try {
        const roomResult = await syncBoardingRoomAssignmentsAfterDateChange(
          bookingId,
          checkInDate,
          effectiveCheckOut,
        );
        if (roomResult.trimmed > 0) {
          toast.message("Kennel assignment adjusted to match checkout date.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Kennel assignment sync failed";
        toast.warning(`Checked out, but kennel rows may need review: ${msg}`);
      }

      // Checkout is the trigger for boarding billing: flip a still-draft invoice
      // to outstanding so the balance is collectable and surfaces in alerts.
      if (checkoutInvoice && checkoutInvoice.status === "draft") {
        await supabase
          .from("invoices")
          .update({ status: "outstanding" })
          .eq("id", checkoutInvoice.id)
          .eq("status", "draft");
        await queryClient.invalidateQueries({ queryKey: checkoutBillingKey });
      }

      const pet = firstPetName(petNames);
      const total = checklistItems.length;
      if (hasIssues) {
        toast.warning(
          `${pet} checked out · ${counts.ret} returned${counts.miss ? ` · ${counts.miss} missing` : ""}${counts.dmg ? ` · ${counts.dmg} damaged` : ""}`,
        );
      } else {
        toast.success(`${pet} checked out · ${total} item${total !== 1 ? "s" : ""} returned`);
      }

      // If there is a balance to collect, open the wallet-first payment modal
      // before closing; otherwise finish immediately.
      if (checkoutInvoice && billingOwnerId && invoiceRemaining > 0) {
        setPayOpen(true);
      } else {
        close();
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  };

  const renderGroup = (title: string, items: BookingItem[]) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
        {items.map((it) => {
          const st = states[it.id] ?? { return_status: "" as ReturnStatus, return_notes: "" };
          return (
            <div
              key={it.id}
              className={cn("rounded-lg border p-3 space-y-2", statusBg(st.return_status))}
            >
              <div className="flex items-start gap-2">
                <Checkbox
                  id={`ret-${it.id}`}
                  checked={st.return_status === "returned"}
                  onCheckedChange={(v) => {
                    if (v) setItemState(it.id, { return_status: "returned" });
                    else setItemState(it.id, { return_status: "" });
                  }}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0 space-y-2">
                  <Label htmlFor={`ret-${it.id}`} className="font-medium leading-tight cursor-pointer">
                    {it.description}
                  </Label>
                  <p className="text-xs text-muted-foreground">Qty brought in: {it.quantity}</p>
                  {it.photo_urls?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {it.photo_urls.map((u) => (
                        <button key={u} type="button" onClick={() => setLightbox(u)} className="p-0 border-0 bg-transparent">
                          <img src={u} alt="" className={THUMB} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Select
                      value={st.return_status || undefined}
                      onValueChange={(v) =>
                        setItemState(it.id, { return_status: v as ReturnStatus })
                      }
                    >
                      <SelectTrigger className="w-full sm:w-[200px]">
                        <SelectValue placeholder="Return status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="returned">Returned</SelectItem>
                        <SelectItem value="missing">Missing</SelectItem>
                        <SelectItem value="damaged">Damaged</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {(st.return_status === "missing" || st.return_status === "damaged") && (
                    <Input
                      placeholder="Notes for this item"
                      value={st.return_notes}
                      onChange={(e) => setItemState(it.id, { return_notes: e.target.value })}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const personal = checklistItems.filter((i) => i.category === "personal");
  const food = checklistItems.filter((i) => i.category === "food");

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
          <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
            <SheetTitle>Check-out</SheetTitle>
            <SheetDescription>
              {ownerName} · {petNames} · {roomName}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0 px-6">
            <div className="space-y-5 pb-6 pr-3">
              {isLoading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <div className="rounded-md border p-3 text-sm space-y-1">
                    <p>
                      <span className="text-muted-foreground">Check-in:</span>{" "}
                      {format(parseISO(checkInDate), "d MMM yyyy")}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Booked check-out:</span>{" "}
                      {format(parseISO(checkOutDate), "d MMM yyyy")}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Nights:</span> {nights}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="actual-co">Actual check-out date</Label>
                    <Input
                      id="actual-co"
                      type="date"
                      value={actualCheckOutDate}
                      onChange={(e) => setActualCheckOutDate(e.target.value)}
                    />
                  </div>

                  <div>
                    <p className="text-sm font-semibold mb-2">Belongings return checklist</p>
                    {renderGroup("Personal belongings", personal)}
                    {renderGroup("Food & medication", food)}
                    {checklistItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No items were recorded at check-in.</p>
                    ) : null}
                  </div>

                  {checklistItems.length > 0 ? (
                    <div className="rounded-md bg-muted/60 px-3 py-2 text-sm font-medium">
                      {counts.ret} returned · {counts.miss} missing · {counts.dmg} damaged
                    </div>
                  ) : null}

                  {hasIssues ? (
                    <div className="space-y-2">
                      <Label htmlFor="issues-notes">Notes on missing or damaged items *</Label>
                      <Textarea
                        id="issues-notes"
                        rows={3}
                        value={issuesNotes}
                        onChange={(e) => setIssuesNotes(e.target.value)}
                        placeholder="Required when any item is missing or damaged"
                      />
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <Label htmlFor="staff-name">Staff name *</Label>
                    <Input
                      id="staff-name"
                      value={staffName}
                      onChange={(e) => setStaffName(e.target.value)}
                      placeholder="Who is confirming checkout?"
                    />
                  </div>

                  {checkoutInvoice ? (
                    <div className="rounded-md border p-3 text-sm space-y-1" data-testid="checkout-billing-summary">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Balance due</span>
                        <span className="tabular-nums font-medium">{formatAed(invoiceRemaining)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Account balance</span>
                        <span
                          className={cn(
                            "tabular-nums font-medium",
                            (account?.accountBalance ?? 0) >= 0 ? "text-emerald-700" : "text-red-700",
                          )}
                        >
                          {(account?.accountBalance ?? 0) >= 0 ? "+" : ""}
                          {formatAed(account?.accountBalance ?? 0)}
                        </span>
                      </div>
                      {invoiceRemaining > 0 ? (
                        <p className="text-xs text-muted-foreground pt-1">
                          You'll confirm payment after checkout.
                        </p>
                      ) : (
                        <p className="text-xs text-emerald-700 pt-1">Invoice already settled.</p>
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </ScrollArea>

          <div className="border-t p-4 shrink-0">
            <Button className="w-full" disabled={!canConfirm || busy} onClick={handleConfirm}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm checkout
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {checkoutInvoice && billingOwnerId ? (
        <PaymentSplitDialog
          open={payOpen}
          onOpenChange={(v) => {
            setPayOpen(v);
            // Closing the payment dialog finishes the checkout flow whether or
            // not payment was collected (staff may collect later).
            if (!v) close();
          }}
          invoiceId={checkoutInvoice.id}
          ownerId={billingOwnerId}
          invoiceTotal={invoiceRemaining}
          ensureOutstanding={checkoutInvoice.status === "draft"}
          defaultStaffName={staffName}
          title="Collect boarding payment"
          onSuccess={() => {
            if (billingOwnerId) {
              void queryClient.invalidateQueries({
                queryKey: accountBalanceQueryKey(billingOwnerId),
              });
            }
          }}
        />
      ) : null}

      <Dialog open={!!lightbox} onOpenChange={() => setLightbox(null)}>
        <DialogContent className="max-w-3xl">
          {lightbox ? <img src={lightbox} alt="" className="w-full max-h-[80vh] object-contain rounded-md" /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
