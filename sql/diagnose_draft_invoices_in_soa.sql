-- Read-only: draft invoices with positive totals (previously could debit SOA K).

SELECT
  o.first_name,
  o.last_name,
  i.invoice_number,
  i.total,
  i.service_type,
  i.notes,
  i.created_at::date AS created_date
FROM public.invoices i
JOIN public.owners o ON o.id = i.owner_id
WHERE i.status = 'draft'
  AND COALESCE(i.receipt_only, false) = false
  AND i.total > 0
ORDER BY i.total DESC, o.last_name, i.invoice_number;

SELECT
  COUNT(*) AS draft_invoice_count,
  COUNT(DISTINCT i.owner_id) AS owner_count,
  ROUND(SUM(i.total)::numeric, 2) AS total_aed_excluded_from_soa
FROM public.invoices i
WHERE i.status = 'draft'
  AND COALESCE(i.receipt_only, false) = false
  AND i.total > 0;
