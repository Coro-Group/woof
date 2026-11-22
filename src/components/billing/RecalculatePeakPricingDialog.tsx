import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentStaffName } from "@/hooks/useCurrentStaffName";
import { formatWalletAed } from "@/lib/money";
import {
  applyPeakPricingRecalc,
  previewPeakPricingRecalc,
  type PeakRecalcPreview,
} from "@/lib/peakPricingRecalc";

export function RecalculatePeakPricingButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="billing-recalculate-peak-btn"
        onClick={() => setOpen(true)}
      >
        Recalculate peak pricing
      </Button>
      <RecalculatePeakPricingDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function RecalculatePeakPricingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { staff, staffName } = useCurrentStaffName();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [preview, setPreview] = useState<PeakRecalcPreview | null>(null);
  const [applying, setApplying] = useState(false);

  const loadPreview = async () => {
    setLoading(true);
    setPreview(null);
    setProgress("Finding invoices…");
    try {
      const result = await previewPeakPricingRecalc((done, total) => {
        setProgress(total === 0 ? "Finding invoices…" : `Checking ${done} of ${total}`);
      });
      setPreview(result);
      setProgress("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not build the preview.");
      setProgress("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadPreview();
    // Preview is rebuilt each time the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const confirm = async () => {
    if (!preview || preview.rows.length === 0 || applying) return;
    setApplying(true);
    setProgress("Updating invoices…");
    try {
      const result = await applyPeakPricingRecalc(
        preview.rows,
        { staffName: staffName.trim() || "admin", staffId: staff?.id ?? null },
        (done, total) => setProgress(`Updating ${done} of ${total}`),
      );
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
      await queryClient.invalidateQueries({ queryKey: ["wallet_transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["owners"] });
      await queryClient.invalidateQueries({ queryKey: ["owner_wallet"] });
      await queryClient.invalidateQueries({ queryKey: ["statement_ledger"] });
      if (result.failed.length === 0) {
        toast.success(`Updated ${result.updated.length} invoice${result.updated.length === 1 ? "" : "s"}.`);
        onOpenChange(false);
        setPreview(null);
      } else {
        toast.error(`${result.failed.length} invoice${result.failed.length === 1 ? "" : "s"} could not be updated.`);
        const refreshed = await previewPeakPricingRecalc();
        setPreview({
          ...refreshed,
          errors: [...result.failed, ...refreshed.errors],
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update invoices.");
    } finally {
      setApplying(false);
      setProgress("");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setPreview(null);
          setProgress("");
        }
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Recalculate peak pricing</DialogTitle>
          <DialogDescription>
            Boarding invoices with a stay overlapping 30 Nov – 4 Dec 2026. Voided, cancelled,
            consolidated, and Board &amp; Train invoices are left out. Night lines are re-split with the
            current peak periods. Discounts, add-ons, and transport stay as they are. Nothing is saved
            until you confirm.
          </DialogDescription>
        </DialogHeader>

        {loading || applying ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progress || "Working…"}
          </div>
        ) : preview ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {preview.rows.length} invoice{preview.rows.length === 1 ? "" : "s"} will change.
              {preview.unchanged > 0 ? ` ${preview.unchanged} already match the current peak dates.` : ""}
              {" "}Paid invoices with a lower total get that difference credited to the wallet. A higher
              total is left outstanding.
            </p>
            {preview.rows.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">No invoices need a change.</p>
            ) : (
              <div className="max-h-[420px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Old total</TableHead>
                      <TableHead className="text-right">New total</TableHead>
                      <TableHead className="text-right">Difference</TableHead>
                      <TableHead className="text-right">Wallet credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row) => (
                      <TableRow key={row.invoiceId}>
                        <TableCell className="font-medium">{row.invoiceNumber}</TableCell>
                        <TableCell>{row.ownerName}</TableCell>
                        <TableCell className="capitalize">{row.status.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatWalletAed(row.oldTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatWalletAed(row.newTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatSigned(row.difference)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.walletCredit > 0.009 ? formatWalletAed(row.walletCredit) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {preview.errors.length > 0 ? (
              <ul className="space-y-1 text-sm text-destructive">
                {preview.errors.map((error) => (
                  <li key={`${error.invoiceNumber}-${error.message}`}>
                    {error.invoiceNumber}: {error.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="py-6 text-sm text-muted-foreground">The preview could not be loaded.</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="billing-recalculate-peak-confirm"
            disabled={loading || applying || !preview || preview.rows.length === 0}
            onClick={() => void confirm()}
          >
            Confirm and update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatSigned(amount: number): string {
  const formatted = formatWalletAed(Math.abs(amount));
  if (amount < -0.009) return `−${formatted}`;
  if (amount > 0.009) return `+${formatted}`;
  return formatted;
}
