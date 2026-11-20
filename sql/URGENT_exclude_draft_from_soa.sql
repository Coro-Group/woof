-- Exclude draft invoices from SOA / ledger classification.
-- Drafts are not finalized and must not debit customer-facing balance K.
-- Paste into Supabase SQL editor (project wineliuwejkxwsdbrthb).
--
-- Example: Kate Hellewell INV-2026-06394 (draft, 196.35) was reducing credit
-- from 488.30 to 291.95. get_ledger_statement / get_statement_of_account both
-- call is_soa_invoice_status, so replacing this function is sufficient.

CREATE OR REPLACE FUNCTION public.is_soa_invoice_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status NOT IN ('voided', 'consolidated', 'cancelled', 'draft');
$$;

-- Verification
SELECT public.is_soa_invoice_status('draft') AS draft_is_soa;           -- expect false
SELECT public.is_soa_invoice_status('outstanding') AS outstanding_is_soa; -- expect true
SELECT public.is_soa_invoice_status('paid') AS paid_is_soa;             -- expect true

-- Fleet scan: draft invoices that previously could inflate SOA debt
SELECT
  o.first_name,
  o.last_name,
  i.invoice_number,
  i.status,
  i.total,
  i.notes,
  i.created_at::date AS created_date
FROM public.invoices i
JOIN public.owners o ON o.id = i.owner_id
WHERE i.status = 'draft'
  AND COALESCE(i.receipt_only, false) = false
  AND i.total > 0
ORDER BY i.total DESC, o.last_name, i.invoice_number;
