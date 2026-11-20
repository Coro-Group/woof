-- URGENT: Fix orphan card_payment credits in get_ledger_statement
-- Paste into Supabase SQL editor (project wineliuwejkxwsdbrthb).
-- Source: supabase/migrations/20260908190000_ledger_exclude_orphan_payments.sql
--
-- DOES NOT UPDATE owners.wallet_balance or any invoice / payment rows.
-- Run sections in order. Review SELECT results before CREATE OR REPLACE.

-- =============================================================================
-- 1) BEFORE: status of the two known orphan payment invoices
-- =============================================================================
SELECT
  i.id,
  i.invoice_number,
  i.status,
  i.total,
  i.amount_paid,
  i.created_at,
  i.issue_date,
  i.became_outstanding_at,
  public.is_soa_invoice_status(i.status::text) AS soa_eligible,
  COALESCE(i.receipt_only, false) AS receipt_only
FROM public.invoices i
WHERE i.owner_id = '8a4b428d-b0c2-4b64-88d4-41c447d3f9e9'::uuid
  AND i.invoice_number IN ('INV-2026-07447', 'INV-2026-07467');

SELECT
  ip.id AS payment_id,
  i.invoice_number,
  i.status,
  ip.amount,
  ip.payment_method,
  ip.created_at AS payment_at,
  public.is_soa_invoice_status(i.status::text) AS invoice_soa_eligible
FROM public.invoice_payments ip
JOIN public.invoices i ON i.id = ip.invoice_id
WHERE ip.id IN (
  'c31f21ae-0005-4c14-ae49-7ea6585a4abe'::uuid,
  'c4932cf7-eaa2-42ec-8ac8-e7a23ba4ed6d'::uuid
);

-- =============================================================================
-- 2) Full-history orphan reconciliation (Roshni) — find remaining ~77.00
--    Orphan = visible (non-wallet) payment whose invoice is NOT SOA-eligible
-- =============================================================================
SELECT
  ip.id AS payment_id,
  i.invoice_number,
  i.status,
  ROUND(ip.amount, 2) AS amount,
  ip.payment_method,
  ip.created_at
FROM public.invoice_payments ip
JOIN public.invoices i ON i.id = ip.invoice_id
WHERE ip.owner_id = '8a4b428d-b0c2-4b64-88d4-41c447d3f9e9'::uuid
  AND COALESCE(i.receipt_only, false) = false
  AND NOT public.is_soa_invoice_status(i.status::text)
  AND ip.payment_method <> 'wallet'::public.payment_method
ORDER BY ip.created_at;

SELECT
  ROUND(COALESCE(SUM(ip.amount), 0), 2) AS orphan_credit_total
FROM public.invoice_payments ip
JOIN public.invoices i ON i.id = ip.invoice_id
WHERE ip.owner_id = '8a4b428d-b0c2-4b64-88d4-41c447d3f9e9'::uuid
  AND COALESCE(i.receipt_only, false) = false
  AND NOT public.is_soa_invoice_status(i.status::text)
  AND ip.payment_method <> 'wallet'::public.payment_method;
-- Expect orphan_credit_total ≈ 187.75 if orphans fully explain Running Ledger vs SOA gap.

-- Cross-check: SOA invoice debits vs non-orphan payment credits (full history)
WITH soa_debits AS (
  SELECT ROUND(SUM(public.invoice_gross_total(i.total, i.vat_aed, i.service_type, i.notes)), 2) AS debit_sum
  FROM public.invoices i
  WHERE i.owner_id = '8a4b428d-b0c2-4b64-88d4-41c447d3f9e9'::uuid
    AND COALESCE(i.receipt_only, false) = false
    AND public.is_soa_invoice_status(i.status::text)
    AND public.invoice_gross_total(i.total, i.vat_aed, i.service_type, i.notes) > 0
),
soa_payment_credits AS (
  SELECT ROUND(COALESCE(SUM(ip.amount), 0), 2) AS credit_sum
  FROM public.invoice_payments ip
  JOIN public.invoices i ON i.id = ip.invoice_id
  WHERE ip.owner_id = '8a4b428d-b0c2-4b64-88d4-41c447d3f9e9'::uuid
    AND COALESCE(i.receipt_only, false) = false
    AND public.is_soa_invoice_status(i.status::text)
    AND ip.payment_method <> 'wallet'::public.payment_method
)
SELECT
  d.debit_sum,
  c.credit_sum,
  ROUND(c.credit_sum - d.debit_sum, 2) AS payments_minus_debits_ex_wallet_topups
FROM soa_debits d, soa_payment_credits c;

-- =============================================================================
-- 3) APPLY FIX (only after reviewing sections 1–2)
-- =============================================================================
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
      AND public.is_soa_invoice_status(i.status::text)
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
      AND ROUND(COALESCE(i.amount_paid, 0), 2) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id = i.id
      )
  ),
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
      AND public.is_ledger_wallet_event(wt.invoice_id, wt.transaction_type)
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

-- =============================================================================
-- 4) AFTER: Roshni last Running Ledger row should be 818.75
-- =============================================================================
SELECT
  row_id,
  created_at,
  amount,
  balance_after,
  transaction_type,
  invoice_number
FROM public.get_ledger_statement(
  '8a4b428d-b0c2-4b64-88d4-41c447d3f9e9'::uuid,
  '2020-01-01 00:00:00+04'::timestamptz,
  now()
)
ORDER BY created_at DESC, row_id DESC
LIMIT 5;

SELECT
  o.wallet_balance,
  ROUND(
    COALESCE(SUM(
      public.invoice_gross_total(i.total, i.vat_aed, i.service_type, i.notes)
      - COALESCE(i.amount_paid, 0)
    ) FILTER (
      WHERE i.status IN ('outstanding', 'partially_paid', 'overdue')
        AND COALESCE(i.receipt_only, false) = false
    ), 0),
    2
  ) AS open_remainders,
  ROUND(
    o.wallet_balance - COALESCE(SUM(
      public.invoice_gross_total(i.total, i.vat_aed, i.service_type, i.notes)
      - COALESCE(i.amount_paid, 0)
    ) FILTER (
      WHERE i.status IN ('outstanding', 'partially_paid', 'overdue')
        AND COALESCE(i.receipt_only, false) = false
    ), 0),
    2
  ) AS account_balance_soa
FROM public.owners o
LEFT JOIN public.invoices i ON i.owner_id = o.id
WHERE o.id = '8a4b428d-b0c2-4b64-88d4-41c447d3f9e9'::uuid
GROUP BY o.id, o.wallet_balance;

-- Spot-check: 2 other owners with card_payment rows — last ledger K vs SOA
WITH card_owners AS (
  SELECT DISTINCT ip.owner_id
  FROM public.invoice_payments ip
  WHERE ip.payment_method = 'card'::public.payment_method
    AND ip.owner_id <> '8a4b428d-b0c2-4b64-88d4-41c447d3f9e9'::uuid
  LIMIT 2
)
SELECT
  o.id AS owner_id,
  trim(both FROM concat(o.first_name, ' ', coalesce(o.last_name, ''))) AS owner_name,
  o.wallet_balance,
  (
    SELECT wb.balance_after
    FROM public.get_ledger_statement(
      o.id,
      '2020-01-01 00:00:00+04'::timestamptz,
      now()
    ) wb
    ORDER BY wb.created_at DESC, wb.row_id DESC
    LIMIT 1
  ) AS running_ledger_last,
  ROUND(
    o.wallet_balance - COALESCE((
      SELECT SUM(
        public.invoice_gross_total(i.total, i.vat_aed, i.service_type, i.notes)
        - COALESCE(i.amount_paid, 0)
      )
      FROM public.invoices i
      WHERE i.owner_id = o.id
        AND i.status IN ('outstanding', 'partially_paid', 'overdue')
        AND COALESCE(i.receipt_only, false) = false
    ), 0),
    2
  ) AS account_balance_soa
FROM card_owners co
JOIN public.owners o ON o.id = co.owner_id;
