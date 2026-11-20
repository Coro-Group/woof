-- Auto-apply wallet top-ups to open invoices (oldest due_date / created_at first).
--
-- After credit_wallet_topup credits the wallet, allocate the incoming amount to
-- outstanding / overdue / partially_paid invoices using the same invoice_payments
-- + wallet deduction pattern as collect_account_payment. Leftover stays as wallet
-- credit. Never hard-blocks the top-up when there are no open invoices or when
-- invoices are future-dated.

-- ── 1. Shared allocator (wallet already holds the funds) ─────────────────────

CREATE OR REPLACE FUNCTION public.apply_wallet_to_open_invoices(
  p_owner_id uuid,
  p_amount numeric,
  p_performed_by text DEFAULT 'system'::text,
  p_notes text DEFAULT 'Auto-applied from wallet top-up'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wallet_balance       numeric;
  v_wallet_balance_after numeric;
  v_remaining            numeric;
  v_apply                numeric;
  v_opening              numeric;
  v_closing              numeric;
  v_applied_total        numeric := 0;
  v_invoices_affected    integer := 0;
  v_allocations          jsonb := '[]'::jsonb;
  v_performed_by         text;
  rec                    RECORD;
BEGIN
  v_performed_by := COALESCE(NULLIF(trim(p_performed_by), ''), 'system');
  v_remaining := ROUND(COALESCE(p_amount, 0), 2);

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object(
      'applied', 0,
      'invoices_affected', 0,
      'allocations', '[]'::jsonb,
      'wallet_balance_after', NULL
    );
  END IF;

  SELECT COALESCE(wallet_balance, 0)
  INTO v_wallet_balance
  FROM public.owners
  WHERE id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owner not found';
  END IF;

  -- Cap at available wallet (never overdraw). Do not reject the caller.
  IF v_remaining > ROUND(v_wallet_balance, 2) THEN
    v_remaining := ROUND(v_wallet_balance, 2);
  END IF;

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object(
      'applied', 0,
      'invoices_affected', 0,
      'allocations', '[]'::jsonb,
      'wallet_balance_after', ROUND(v_wallet_balance, 2)
    );
  END IF;

  FOR rec IN
    SELECT
      i.id AS invoice_id,
      i.invoice_number::text AS invoice_number,
      ROUND(GREATEST(i.total - COALESCE(i.amount_paid, 0), 0), 2) AS balance
    FROM public.invoices i
    WHERE i.owner_id = p_owner_id
      AND COALESCE(i.receipt_only, false) = false
      AND i.status IN ('outstanding', 'overdue', 'partially_paid')
      AND (i.total - COALESCE(i.amount_paid, 0)) > 0
    ORDER BY i.due_date ASC NULLS LAST, i.created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;

    IF rec.balance <= 0 THEN
      CONTINUE;
    END IF;

    v_apply := ROUND(LEAST(v_remaining, rec.balance), 2);
    IF v_apply <= 0 THEN
      CONTINUE;
    END IF;

    v_opening := rec.balance;
    v_closing := ROUND(rec.balance - v_apply, 2);

    -- Same shape as collect_account_payment wallet leg; trigger updates
    -- invoices.amount_paid / status / paid_at.
    INSERT INTO public.invoice_payments (
      invoice_id,
      owner_id,
      amount,
      payment_method,
      recorded_by,
      opening_balance,
      closing_balance,
      notes
    ) VALUES (
      rec.invoice_id,
      p_owner_id,
      v_apply,
      'wallet'::public.payment_method,
      v_performed_by,
      v_opening,
      v_closing,
      NULLIF(trim(p_notes), '')
    );

    v_allocations := v_allocations || jsonb_build_array(
      jsonb_build_object(
        'invoice_id', rec.invoice_id,
        'invoice_number', rec.invoice_number,
        'wallet_amount', v_apply
      )
    );

    v_applied_total := ROUND(v_applied_total + v_apply, 2);
    v_invoices_affected := v_invoices_affected + 1;
    v_remaining := ROUND(v_remaining - v_apply, 2);
  END LOOP;

  IF v_applied_total <= 0 THEN
    RETURN jsonb_build_object(
      'applied', 0,
      'invoices_affected', 0,
      'allocations', '[]'::jsonb,
      'wallet_balance_after', ROUND(v_wallet_balance, 2)
    );
  END IF;

  v_wallet_balance_after := ROUND(v_wallet_balance - v_applied_total, 2);

  INSERT INTO public.wallet_transactions (
    owner_id,
    transaction_type,
    amount,
    balance_after,
    reference_type,
    payment_method,
    performed_by,
    notes
  ) VALUES (
    p_owner_id,
    'deduction',
    -v_applied_total,
    v_wallet_balance_after,
    'topup_auto_apply',
    'wallet'::public.payment_method,
    v_performed_by,
    COALESCE(NULLIF(trim(p_notes), ''), 'Auto-applied from wallet top-up')
  );

  UPDATE public.owners
  SET wallet_balance = v_wallet_balance_after
  WHERE id = p_owner_id;

  RETURN jsonb_build_object(
    'applied', v_applied_total,
    'invoices_affected', v_invoices_affected,
    'allocations', v_allocations,
    'wallet_balance_after', v_wallet_balance_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_wallet_to_open_invoices(uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_wallet_to_open_invoices(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_wallet_to_open_invoices(uuid, numeric, text, text) TO service_role;

-- ── 2. credit_wallet_topup: credit then auto-apply incoming amount ───────────

CREATE OR REPLACE FUNCTION public.credit_wallet_topup(
  p_owner_id uuid,
  p_amount numeric,
  p_transaction_type public.transaction_type DEFAULT 'top_up'::public.transaction_type,
  p_performed_by text DEFAULT 'reception'::text,
  p_payment_method public.payment_method DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_balance numeric;
  v_new_balance numeric;
  v_amount numeric;
  v_tx_id uuid;
  v_receipt public.wallet_topup_receipts%ROWTYPE;
  v_performed_by text;
  v_apply jsonb;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_transaction_type NOT IN ('top_up', 'manual_topup') THEN
    RAISE EXCEPTION 'Transaction type must be top_up or manual_topup';
  END IF;

  v_amount := ROUND(ABS(p_amount), 2);
  v_performed_by := COALESCE(NULLIF(TRIM(p_performed_by), ''), 'reception');

  SELECT wallet_balance
  INTO v_balance
  FROM public.owners
  WHERE id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owner not found';
  END IF;

  v_balance := COALESCE(v_balance, 0);
  v_new_balance := ROUND(v_balance + v_amount, 2);

  INSERT INTO public.wallet_transactions (
    owner_id,
    transaction_type,
    amount,
    balance_after,
    notes,
    payment_method,
    staff_id,
    performed_by
  ) VALUES (
    p_owner_id,
    p_transaction_type,
    v_amount,
    v_new_balance,
    NULLIF(TRIM(p_notes), ''),
    p_payment_method,
    p_staff_id,
    v_performed_by
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO public.wallet_topup_receipts (
    owner_id,
    wallet_transaction_id,
    amount,
    issued_by,
    receipt_number,
    issued_at,
    notes
  ) VALUES (
    p_owner_id,
    v_tx_id,
    v_amount,
    v_performed_by,
    'RCP-' || (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
    now(),
    NULLIF(TRIM(p_notes), '')
  )
  ON CONFLICT (wallet_transaction_id) DO NOTHING;

  UPDATE public.owners
  SET wallet_balance = v_new_balance
  WHERE id = p_owner_id;

  SELECT *
  INTO v_receipt
  FROM public.wallet_topup_receipts
  WHERE wallet_transaction_id = v_tx_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt was not created for wallet top-up';
  END IF;

  -- Apply only the incoming top-up against open invoices; leftover remains credit.
  -- Never raises for missing/future invoices — empty apply is success.
  v_apply := public.apply_wallet_to_open_invoices(
    p_owner_id,
    v_amount,
    v_performed_by,
    'Auto-applied from wallet top-up'
  );

  RETURN jsonb_build_object(
    'success', true,
    'wallet_transaction_id', v_tx_id,
    'receipt_id', v_receipt.id,
    'receipt_number', v_receipt.receipt_number,
    'balance_after', COALESCE(
      (v_apply->>'wallet_balance_after')::numeric,
      v_new_balance
    ),
    'auto_applied', COALESCE((v_apply->>'applied')::numeric, 0),
    'invoices_affected', COALESCE((v_apply->>'invoices_affected')::integer, 0),
    'allocations', COALESCE(v_apply->'allocations', '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_wallet_topup(
  uuid,
  numeric,
  public.transaction_type,
  text,
  public.payment_method,
  text,
  uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.credit_wallet_topup(
  uuid,
  numeric,
  public.transaction_type,
  text,
  public.payment_method,
  text,
  uuid
) TO service_role;

-- Verification (paste into Supabase SQL editor after apply):
--
-- -- Before/after for a test owner with multiple open invoices:
-- -- 1) Snapshot open invoices BEFORE top-up
-- SELECT id, invoice_number, status, total, amount_paid,
--        ROUND(GREATEST(total - COALESCE(amount_paid, 0), 0), 2) AS remaining
-- FROM invoices
-- WHERE owner_id = '<TEST_OWNER_ID>'
--   AND COALESCE(receipt_only, false) = false
--   AND status IN ('outstanding', 'overdue', 'partially_paid')
-- ORDER BY due_date ASC NULLS LAST, created_at ASC;
--
-- -- 2) Top up (replace amount / staff as needed)
-- -- SELECT public.credit_wallet_topup(
-- --   '<TEST_OWNER_ID>'::uuid,
-- --   500,
-- --   'top_up',
-- --   'verification',
-- --   'card',
-- --   'Auto-apply verification top-up'
-- -- );
--
-- -- 3) Snapshot AFTER — oldest invoices should be paid/partial; leftover on wallet
-- SELECT id, invoice_number, status, total, amount_paid,
--        ROUND(GREATEST(total - COALESCE(amount_paid, 0), 0), 2) AS remaining
-- FROM invoices
-- WHERE owner_id = '<TEST_OWNER_ID>'
--   AND COALESCE(receipt_only, false) = false
--   AND status IN ('outstanding', 'overdue', 'partially_paid', 'paid')
-- ORDER BY due_date ASC NULLS LAST, created_at ASC;
--
-- SELECT proname, pg_get_function_arguments(oid)
-- FROM pg_proc
-- WHERE proname IN ('apply_wallet_to_open_invoices', 'credit_wallet_topup');
