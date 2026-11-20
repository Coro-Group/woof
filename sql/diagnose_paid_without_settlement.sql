-- Read-only fleet scan: status=paid, amount_paid=0, no invoice_payments.
-- Same pattern as Kate Hellewell INV-2026-01488 / 01471 / 01587 / 01642
-- (legacy phase 4b package import set status without amount_paid).

SELECT
  o.first_name,
  o.last_name,
  i.invoice_number,
  i.status,
  i.total,
  COALESCE(i.amount_paid, 0) AS amount_paid,
  i.notes,
  i.created_at::date AS created_date
FROM public.invoices i
JOIN public.owners o ON o.id = i.owner_id
WHERE i.status = 'paid'
  AND COALESCE(i.amount_paid, 0) = 0
  AND COALESCE(i.receipt_only, false) = false
  AND i.total > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id = i.id
  )
ORDER BY o.last_name, o.first_name, i.invoice_number;

SELECT
  COUNT(*) AS invoice_count,
  COUNT(DISTINCT i.owner_id) AS owner_count,
  ROUND(SUM(i.total)::numeric, 2) AS total_aed_flagged
FROM public.invoices i
WHERE i.status = 'paid'
  AND COALESCE(i.amount_paid, 0) = 0
  AND COALESCE(i.receipt_only, false) = false
  AND i.total > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id = i.id
  );
