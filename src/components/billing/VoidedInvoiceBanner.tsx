import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatVoidAed, roundVoidAed } from "@/lib/voidInvoice";

interface VoidedInvoiceBannerProps {
  invoiceId: string;
  voidedBy: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
}

export function VoidedInvoiceBanner({
  invoiceId,
  voidedBy,
  voidedAt,
  voidedReason,
}: VoidedInvoiceBannerProps) {
  const refund = useQuery({
    queryKey: ["invoice-void-refund", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("amount")
        .eq("reference_id", invoiceId)
        .eq("reference_type", "invoice_void");
      if (error) throw error;
      return roundVoidAed((data ?? []).reduce((sum, row) => sum + Number(row.amount), 0));
    },
  });

  const when = voidedAt ? format(new Date(voidedAt), "d MMM yyyy, HH:mm") : null;

  return (
    <div
      className="rounded-md border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700"
      data-testid="invoice-voided-banner"
    >
      <p className="font-semibold text-slate-900">Voided</p>
      <p>
        {voidedBy ? `By ${voidedBy}` : "Staff name not recorded"}
        {when ? ` on ${when}` : ""}.
      </p>
      {voidedReason ? <p>{voidedReason}</p> : null}
      <p className="mt-1 font-medium">
        Refunded to wallet: {refund.isLoading ? "…" : formatVoidAed(refund.data ?? 0)}
      </p>
    </div>
  );
}
