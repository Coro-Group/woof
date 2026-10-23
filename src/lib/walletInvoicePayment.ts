import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resolveWalletChargeAmount } from "@/lib/accountBalance";
import { loadInvoiceWalletBalanceDue } from "@/lib/invoiceWalletBalance";
import { roundWalletChargeAed } from "@/lib/invoiceWalletCharge";
import { roundAed } from "@/lib/money";
import { recordPayment } from "@/services/invoiceService";

/** Float tolerance matching collect_account_payment / ledger settled checks. */
const WALLET_BALANCE_TOLERANCE_AED = 0.01;

export type WalletPaymentResult = {
  success: boolean;
  amountCharged?: number;
  newWalletBalance?: number;
  ownerId?: string;
  error?: string;
  shortfall?: number;
  partial?: boolean;
};

/**
 * Pay an invoice from the owner's wallet via recordPayment — writes
 * invoice_payments + wallet_transactions and lets the DB trigger update status.
 *
 * The deducted amount is the invoice total after discount, minus anything
 * already paid. It is never the pre-discount subtotal.
 *
 * Spendable funds are owners.wallet_balance only (same figure staff see in the
 * wallet modal / Customer Profile). Do not cap with SOA ledger K — K intentionally
 * excludes wallet-payment rows and can be ≤ 0 while the wallet still has credit.
 */
export async function payInvoiceFromWallet(
  supabase: SupabaseClient<Database>,
  params: { invoiceId: string; performedBy: string; amountAed?: number },
): Promise<WalletPaymentResult> {
  const { invoiceId, performedBy, amountAed } = params;

  let ownerId: string;
  let balanceDue: number;
  try {
    let due = await loadInvoiceWalletBalanceDue(supabase, invoiceId);
    if (
      due.storedTotal > due.chargeTotal + 0.01 &&
      due.amountPaid <= due.chargeTotal + 0.01
    ) {
      const { error: syncErr } = await supabase
        .from("invoices")
        .update({
          total: due.chargeTotal,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoiceId);
      if (syncErr) {
        return { success: false, error: syncErr.message, ownerId: due.ownerId };
      }
      due = await loadInvoiceWalletBalanceDue(supabase, invoiceId);
    }
    ownerId = due.ownerId;
    balanceDue = due.balanceDue;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not load invoice." };
  }

  if (balanceDue <= 0) {
    return {
      success: false,
      error: "This invoice has no outstanding balance",
      amountCharged: 0,
      ownerId,
    };
  }

  const { data: owner, error: ownerErr } = await supabase
    .from("owners")
    .select("wallet_balance")
    .eq("id", ownerId)
    .single();
  if (ownerErr) return { success: false, error: ownerErr.message, ownerId };

  const walletBalance = roundAed(owner.wallet_balance ?? 0);
  // Allow 0.01 AED slack so float noise does not block an otherwise full cover.
  const spendable = roundAed(walletBalance + WALLET_BALANCE_TOLERANCE_AED);
  const chargeAmount = roundAed(
    Math.min(
      resolveWalletChargeAmount(amountAed, spendable, balanceDue),
      walletBalance,
      balanceDue,
    ),
  );

  if (chargeAmount <= 0) {
    return {
      success: false,
      error: "Insufficient wallet balance",
      shortfall: balanceDue,
      ownerId,
    };
  }

  const partial = roundWalletChargeAed(chargeAmount) + 0.009 < balanceDue;

  // recordPayment owns the wallet deduction (wallet_transactions + balance
  // decrement), the invoice_payments row, and — via the
  // trg_update_invoice_status_on_payment trigger — invoices.amount_paid / status
  // / paid_at. This is the primary write here (not a best-effort dual-write), so
  // a failure is fatal for this payment.
  const res = await recordPayment({
    invoiceId,
    amount: chargeAmount,
    method: "wallet",
    recordedBy: performedBy,
    notes: partial
      ? "Partial invoice payment via wallet"
      : "Invoice payment via wallet",
    client: supabase,
  });
  if (!res.success) {
    return { success: false, error: res.error, ownerId };
  }

  const newWalletBalance = res.closingBalance ?? roundAed(walletBalance - chargeAmount);

  return {
    success: true,
    amountCharged: chargeAmount,
    newWalletBalance,
    ownerId,
    partial: partial || undefined,
    shortfall: partial ? roundWalletChargeAed(balanceDue - chargeAmount) : undefined,
  };
}
