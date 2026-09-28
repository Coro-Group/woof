-- Draft invoices are not issued, so they must not move the statement.
-- Invoice/payment events already require is_soa_invoice_status (draft = false).
-- Orphan wallet deductions previously used NOT is_soa_invoice_status, which
-- also matches draft and posted those deductions as standalone debt.
-- Keep deductions only for voided/consolidated/cancelled invoices.

CREATE OR REPLACE FUNCTION public.get_ledger_statement(
  p_owner_id uuid,
  p_from timestamp with time zone,
  p_to timestamp with time zone
)
RETURNS TABLE (
  row_id text,
  created_at timestamp with time zone,
  amount numeric,
  balance_after numeric,
  is_opening_balance boolean,
  is_visible boolean,
  transaction_type text,
  invoice_id uuid,
  invoice_number text,
  service_type text,
  due_date date,
  payment_method public.payment_method,
  notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH invoice_events AS (
    SELECT
      ('inv:' || i.id::text) AS row_id,
      COALESCE(i.issue_date::timestamptz, i.became_outstanding_at, i.created_at) AS event_at,
      1 AS sort_seq,
      -public.invoice_gross_total(i.total, i.vat_aed, i.service_type, i.notes) AS amount,
      true AS is_visible,
      'invoice'::text AS transaction_type,
      i.id AS invoice_id,
      i.invoice_number,
      i.service_type,
      i.due_date,
      NULL::public.payment_method AS payment_method,
      COALESCE(i.notes, '') AS notes
    FROM public.invoices i
    WHERE i.owner_id = p_owner_id
      AND COALESCE(i.receipt_only, false) = false
      AND public.is_soa_invoice_status(i.status::text)
      AND i.status::text <> 'draft'
      AND public.invoice_gross_total(i.total, i.vat_aed, i.service_type, i.notes) > 0
  ),
  payment_events AS (
    SELECT
      ('pay:' || ip.id::text) AS row_id,
      ip.created_at AS event_at,
      2 AS sort_seq,
      ROUND(ip.amount, 2) AS amount,
      (ip.payment_method <> 'wallet'::public.payment_method) AS is_visible,
      public.invoice_payment_tx_type(ip.payment_method) AS transaction_type,
      ip.invoice_id,
      i.invoice_number,
      i.service_type,
      i.due_date,
      ip.payment_method,
      COALESCE(ip.notes, '') AS notes
    FROM public.invoice_payments ip
    JOIN public.invoices i ON i.id = ip.invoice_id
    WHERE ip.owner_id = p_owner_id
      AND COALESCE(i.receipt_only, false) = false
      -- Pair with invoice_events: no credit without a matching SOA debit path
      AND public.is_soa_invoice_status(i.status::text)
      AND i.status::text <> 'draft'
  ),
  legacy_payment_events AS (
    SELECT
      ('legacy_pay:' || i.id::text) AS row_id,
      COALESCE(i.paid_at, i.updated_at, i.created_at) AS event_at,
      2 AS sort_seq,
      ROUND(COALESCE(i.amount_paid, 0), 2) AS amount,
      true AS is_visible,
      COALESCE(
        public.invoice_payment_tx_type(i.payment_method),
        'manual_topup'
      ) AS transaction_type,
      i.id AS invoice_id,
      i.invoice_number,
      i.service_type,
      i.due_date,
      i.payment_method,
      'Legacy settled amount'::text AS notes
    FROM public.invoices i
    WHERE i.owner_id = p_owner_id
      AND COALESCE(i.receipt_only, false) = false
      AND public.is_soa_invoice_status(i.status::text)
      AND i.status::text <> 'draft'
      AND ROUND(COALESCE(i.amount_paid, 0), 2) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id = i.id
      )
  ),
  -- status=paid, amount_paid=0, no invoice_payments, positive total:
  -- synthetic credit so SOA K is not inflated. Flagged for manual review —
  -- does not UPDATE invoices.amount_paid or status.
  paid_without_settlement_events AS (
    SELECT
      ('paid_no_settle:' || i.id::text) AS row_id,
      COALESCE(i.paid_at, i.updated_at, i.created_at) AS event_at,
      2 AS sort_seq,
      public.invoice_gross_total(i.total, i.vat_aed, i.service_type, i.notes) AS amount,
      true AS is_visible,
      'manual_topup'::text AS transaction_type,
      i.id AS invoice_id,
      i.invoice_number,
      i.service_type,
      i.due_date,
      i.payment_method,
      'PAID_WITHOUT_SETTLEMENT — status=paid but amount_paid=0; confirm before backfilling amount_paid'::text AS notes
    FROM public.invoices i
    WHERE i.owner_id = p_owner_id
      AND COALESCE(i.receipt_only, false) = false
      AND i.status = 'paid'::public.invoice_status
      AND ROUND(COALESCE(i.amount_paid, 0), 2) = 0
      AND public.invoice_gross_total(i.total, i.vat_aed, i.service_type, i.notes) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id = i.id
      )
  ),
  wallet_events AS (
    SELECT
      ('wt:' || wt.id::text) AS row_id,
      wt.created_at AS event_at,
      3 AS sort_seq,
      ROUND(wt.amount, 2) AS amount,
      true AS is_visible,
      wt.transaction_type::text AS transaction_type,
      wt.invoice_id,
      i.invoice_number,
      COALESCE(wt.service_type, i.service_type) AS service_type,
      i.due_date,
      wt.payment_method,
      COALESCE(wt.notes, '') AS notes
    FROM public.wallet_transactions wt
    LEFT JOIN public.invoices i ON i.id = wt.invoice_id
    WHERE wt.owner_id = p_owner_id
      AND (
        -- Standalone wallet events (top-up, refund, …) — invoice_id must be null
        public.is_ledger_wallet_event(wt.invoice_id, wt.transaction_type)
        OR (
          -- Genuine wallet outflow after the invoice was issued and then left SOA.
          -- Draft is excluded: it was never issued, so the deduction is not debt.
          wt.transaction_type = 'deduction'::public.transaction_type
          AND wt.invoice_id IS NOT NULL
          AND i.id IS NOT NULL
          AND i.status::text IN ('voided', 'consolidated', 'cancelled')
        )
      )
  ),
  all_events AS (
    SELECT * FROM invoice_events
    UNION ALL
    SELECT * FROM payment_events
    UNION ALL
    SELECT * FROM legacy_payment_events
    UNION ALL
    SELECT * FROM paid_without_settlement_events
    UNION ALL
    SELECT * FROM wallet_events
  ),
  with_balance AS (
    SELECT
      ae.*,
      ROUND(
        SUM(ae.amount) OVER (
          ORDER BY ae.event_at ASC, ae.sort_seq ASC, ae.row_id ASC
          ROWS UNBOUNDED PRECEDING
        ),
        2
      ) AS balance_after
    FROM all_events ae
    WHERE ae.is_visible
  ),
  opening_k AS (
    SELECT ROUND(
      COALESCE(
        (
          SELECT wb.balance_after
          FROM with_balance wb
          WHERE wb.event_at < p_from
          ORDER BY wb.event_at DESC, wb.sort_seq DESC, wb.row_id DESC
          LIMIT 1
        ),
        0
      ),
      2
    ) AS k
  ),
  window_rows AS (
    SELECT wb.*
    FROM with_balance wb
    WHERE wb.event_at >= p_from
      AND wb.event_at <= p_to
  )
  SELECT
    'opening'::text,
    p_from,
    0::numeric,
    ok.k,
    true,
    true,
    'opening_balance'::text,
    NULL::uuid,
    NULL::text,
    NULL::text,
    NULL::date,
    NULL::public.payment_method,
    'Opening balance'::text
  FROM opening_k ok
  WHERE ok.k <> 0
     OR EXISTS (SELECT 1 FROM window_rows)

  UNION ALL

  SELECT
    wr.row_id,
    wr.event_at,
    wr.amount,
    wr.balance_after,
    false,
    wr.is_visible,
    wr.transaction_type,
    wr.invoice_id,
    wr.invoice_number,
    wr.service_type,
    wr.due_date,
    wr.payment_method,
    wr.notes
  FROM window_rows wr

  ORDER BY 2 ASC, 1 ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ledger_statement(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ledger_statement(uuid, timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_statement(uuid, timestamp with time zone, timestamp with time zone) TO service_role;

-- Verification (Elena Karpova): paste sql/URGENT_ledger_exclude_draft_invoices.sql
-- Last balance_after should not include INV-2026-09438.
-- A draft-linked deduction drops out; voided/consolidated deductions stay.
