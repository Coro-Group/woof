/** 2 decimal places, matching invoice totals and void_invoice. */
export function roundWalletChargeAed(amount: number): number {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

/**
 * Header discount already includes adjustments when it is at least as large
 * as their sum. Otherwise the adjustment is an extra discount not yet copied
 * onto the invoice header.
 */
export function memberDiscountBesideAdjustments(
  headerDiscount: number,
  adjustmentDiscount: number,
): number {
  const header = roundWalletChargeAed(Math.max(0, headerDiscount || 0));
  const adjustment = roundWalletChargeAed(Math.max(0, adjustmentDiscount || 0));
  if (header + 0.02 >= adjustment) {
    return roundWalletChargeAed(Math.max(0, header - adjustment));
  }
  return header;
}

/**
 * Header discount already includes adjustments when it is at least as large
 * as their sum. Otherwise the adjustment is an extra discount not yet copied
 * onto the invoice header.
 */
export function combinedInvoiceDiscount(headerDiscount: number, adjustmentDiscount: number): number {
  const header = roundWalletChargeAed(Math.max(0, headerDiscount || 0));
  const adjustment = roundWalletChargeAed(Math.max(0, adjustmentDiscount || 0));
  if (header + 0.02 >= adjustment) return header;
  return roundWalletChargeAed(header + adjustment);
}

/**
 * What a wallet payment may charge.
 * Uses invoices.total once a discount has been written into it.
 * If total is still the pre-discount subtotal, charges subtotal minus the discount.
 */
export function invoiceWalletChargeTotal(input: {
  total: number;
  subtotal: number;
  discountAmount: number;
}): number {
  const total = roundWalletChargeAed(Math.max(0, input.total || 0));
  const subtotal = roundWalletChargeAed(Math.max(0, input.subtotal || 0));
  const discount = roundWalletChargeAed(Math.max(0, input.discountAmount || 0));
  if (discount > 0.009 && subtotal > 0 && Math.abs(total - subtotal) <= 0.02) {
    return roundWalletChargeAed(Math.max(0, subtotal - discount));
  }
  return total;
}

export function invoiceWalletBalanceDue(input: {
  total: number;
  subtotal: number;
  discountAmount: number;
  amountPaid: number;
}): number {
  const chargeTotal = invoiceWalletChargeTotal(input);
  const paid = roundWalletChargeAed(Math.max(0, input.amountPaid || 0));
  return roundWalletChargeAed(Math.max(0, chargeTotal - paid));
}
