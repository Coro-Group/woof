-- Diagnostic: invoices where opening_balance (deposit) is ignored by
-- total - amount_paid outstanding (same bug as INV-2026-06763).
-- Paste into Supabase SQL editor. Read-only.

SELECT
  i.invoice_number,
  i.status,
  i.total,
  COALESCE(i.amount_paid, 0) AS amount_paid,
  COALESCE(i.opening_balance, 0) AS opening_balance,
  ROUND((i.total - COALESCE(i.amount_paid, 0))::numeric, 2) AS shown_outstanding_old,
  ROUND(
    GREATEST(
      0,
      i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.opening_balance, 0)
    )::numeric,
    2
  ) AS correct_outstanding,
  ROUND(COALESCE(i.opening_balance, 0)::numeric, 2) AS overstated_by
FROM public.invoices i
WHERE COALESCE(i.opening_balance, 0) > 0.009
  AND i.status NOT IN ('voided', 'cancelled', 'consolidated')
ORDER BY COALESCE(i.opening_balance, 0) DESC, i.invoice_number;

-- Summary
SELECT
  COUNT(*) AS invoices_with_opening_balance,
  ROUND(SUM(COALESCE(i.opening_balance, 0))::numeric, 2) AS total_opening_balance_aed,
  ROUND(
    SUM(
      GREATEST(
        0,
        LEAST(
          COALESCE(i.opening_balance, 0),
          GREATEST(0, i.total - COALESCE(i.amount_paid, 0))
        )
      )
    )::numeric,
    2
  ) AS total_overstated_outstanding_aed
FROM public.invoices i
WHERE COALESCE(i.opening_balance, 0) > 0.009
  AND i.status NOT IN ('voided', 'cancelled', 'consolidated');
