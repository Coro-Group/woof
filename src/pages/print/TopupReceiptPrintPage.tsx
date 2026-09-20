import { format, parseISO } from "date-fns";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PrintLayout } from "@/components/print/PrintLayout";
import { PrintCompanyHeader } from "@/components/print/PrintCompanyHeader";
import { supabase } from "@/integrations/supabase/client";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { formatAed } from "@/hooks/useBilling";

type TopupReceiptRow = {
  id: string;
  amount: number;
  receipt_number: string | null;
  issued_at: string;
  issued_by: string;
  notes: string | null;
  owner_id: string;
  wallet_transaction_id: string;
  owners: {
    first_name: string;
    last_name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
};

const RECEIPT_SELECT =
  "id, amount, receipt_number, issued_at, issued_by, notes, owner_id, wallet_transaction_id, owners(first_name, last_name, phone, email)";

/**
 * Primary lookup by receipt PK. Legacy fallback by wallet_transaction_id for
 * old print links that opened with the WT id before receipt_id was returned.
 */
async function fetchTopupReceipt(idOrTxId: string): Promise<TopupReceiptRow | null> {
  const byId = await supabase
    .from("wallet_topup_receipts")
    .select(RECEIPT_SELECT)
    .eq("id", idOrTxId)
    .maybeSingle();
  if (byId.error) throw byId.error;
  if (byId.data) return byId.data as TopupReceiptRow;

  // Legacy: URL used wallet_transaction_id instead of receipt id
  const byTx = await supabase
    .from("wallet_topup_receipts")
    .select(RECEIPT_SELECT)
    .eq("wallet_transaction_id", idOrTxId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byTx.error) throw byTx.error;
  return (byTx.data as TopupReceiptRow | null) ?? null;
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd MMM yyyy, HH:mm");
  } catch {
    return value;
  }
}

export default function TopupReceiptPrintPage() {
  const { receiptId } = useParams<{ receiptId: string }>();
  const { data, isLoading, error, isPending } = useQuery({
    queryKey: ["print", "topup-receipt", receiptId],
    enabled: !!receiptId,
    queryFn: () => fetchTopupReceipt(receiptId!),
    // Legacy WT-id links / brief replication lag: retry until the row appears.
    retry: 4,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
  });

  // Gate Print on receipt row presence — not merely logo load.
  const receiptReady = !!data && !isPending;

  return (
    <PrintLayout
      imageUrls={["/woof-logo.png"]}
      contentReady={receiptReady}
      contentLoadingLabel="Loading receipt..."
    >
      {isLoading ? <p className="print-sans text-sm">Loading receipt...</p> : null}
      {error ? (
        <p className="print-sans text-sm text-red-700">Could not load this receipt.</p>
      ) : null}
      {!isLoading && !error && !data ? (
        <p className="print-sans text-sm text-red-700">Receipt not found.</p>
      ) : null}

      {data ? (
        <article className="print-page relative border border-black p-4 text-[12px]">
          <header className="mb-4 border-b border-black pb-3">
            <PrintCompanyHeader
              right={
                <>
                  <p className="font-semibold">{data.receipt_number ?? "—"}</p>
                  <p>{fmtDate(data.issued_at)}</p>
                </>
              }
            />
            <div className="mt-3">
              <h1 className="text-lg font-bold">Wallet Top-Up Receipt</h1>
              <p className="print-sans text-[11px] text-neutral-600">
                Not a tax invoice — wallet credit confirmation
              </p>
            </div>
          </header>

          <section className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <p className="font-semibold">Received from</p>
              <p>
                {data.owners
                  ? ownerDisplayName(data.owners.first_name, data.owners.last_name)
                  : "—"}
              </p>
              {data.owners?.phone ? (
                <p className="print-sans text-[11px]">{data.owners.phone}</p>
              ) : null}
              {data.owners?.email ? (
                <p className="print-sans text-[11px]">{data.owners.email}</p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="font-semibold">Issued by</p>
              <p>{data.issued_by || "—"}</p>
            </div>
          </section>

          <section className="mb-4 border-t border-black pt-3">
            <div className="flex items-center justify-between text-base font-bold">
              <span>Amount added to wallet</span>
              <span className="tabular-nums">{formatAed(data.amount)}</span>
            </div>
          </section>

          {data.notes ? (
            <section className="mb-2">
              <p className="font-semibold">Notes</p>
              <p className="print-sans text-[11px]">{data.notes}</p>
            </section>
          ) : null}

          <footer className="mt-6 border-t border-black pt-2 print-sans text-[10px] text-neutral-600">
            This receipt confirms funds added to the owner's wallet balance. Wallet
            credit is applied automatically against future invoices.
          </footer>
        </article>
      ) : null}
    </PrintLayout>
  );
}
