-- Wallet charges must use the invoice total after discount, never the pre-discount
-- subtotal. If a discount lowers total after a wallet payment, refund the
-- difference and keep amount_paid from exceeding total.
--
-- Already-overpaid rows are left for staff to correct. The read-only list is
-- at the bottom of this file.

CREATE OR REPLACE FUNCTION public.invoice_wallet_charge_total(
  p_total numeric,
  p_subtotal numeric,
  p_discount numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN ROUND(COALESCE(p_discount, 0), 2) > 0.009
     AND ABS(ROUND(COALESCE(p_total, 0), 2) - ROUND(COALESCE(p_subtotal, 0), 2)) <= 0.02
    THEN ROUND(GREATEST(COALESCE(p_subtotal, 0) - COALESCE(p_discount, 0), 0), 2)
    ELSE ROUND(GREATEST(COALESCE(p_total, 0), 0), 2)
  END;
$$;

CREATE OR REPLACE FUNCTION public.invoice_wallet_payable(p_invoice_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_total numeric;
  v_subtotal numeric;
  v_header numeric;
  v_adj numeric;
  v_discount numeric;
BEGIN
  SELECT COALESCE(total, 0), COALESCE(subtotal, 0), COALESCE(discount_amount, 0)
  INTO v_total, v_subtotal, v_header
  FROM public.invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(ABS(adjusted_amount)), 0)
  INTO v_adj
  FROM public.billing_adjustments
  WHERE invoice_id = p_invoice_id
    AND adjustment_type IN (
      'discount_override',
      'double_occupancy_discount',
      'fee_waived',
      'goodwill_credit',
      'adjustment'
    );

  IF v_header + 0.02 >= v_adj THEN
    v_discount := ROUND(v_header, 2);
  ELSE
    v_discount := ROUND(v_header + v_adj, 2);
  END IF;

  RETURN public.invoice_wallet_charge_total(v_total, v_subtotal, v_discount);
END;
$$;

-- Member discount lives on invoices.discount_amount. Repricing double occupancy
-- used to replace that with the adjustment sum (or zero), so total became the
-- pre-discount subtotal and the next wallet payment charged it.
CREATE OR REPLACE FUNCTION public.apply_double_occupancy_discount(
  p_booking_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_amount numeric;
  v_invoice_id uuid;
  v_existing_id uuid;
  v_adjustment_id uuid;
  v_owner_id uuid;
  v_subtotal numeric;
  v_header numeric;
  v_adj numeric;
  v_preserved numeric;
  v_discount numeric;
  v_total numeric;
  v_vat numeric;
BEGIN
  v_amount := public.calculate_double_occupancy_discount(p_booking_id);

  SELECT id, owner_id, COALESCE(subtotal, 0), COALESCE(discount_amount, 0)
  INTO v_invoice_id, v_owner_id, v_subtotal, v_header
  FROM public.invoices
  WHERE booking_id = p_booking_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_invoice_id IS NULL THEN
    IF v_amount = 0 THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'No invoice for booking %', p_booking_id;
  END IF;

  SELECT COALESCE(SUM(ABS(adjusted_amount)), 0)
  INTO v_adj
  FROM public.billing_adjustments
  WHERE invoice_id = v_invoice_id
    AND adjustment_type IN (
      'discount_override',
      'double_occupancy_discount',
      'fee_waived',
      'goodwill_credit',
      'adjustment'
    );

  IF v_header + 0.02 >= v_adj THEN
    v_preserved := ROUND(v_header - v_adj, 2);
  ELSE
    v_preserved := ROUND(v_header, 2);
  END IF;
  v_preserved := GREATEST(v_preserved, 0);

  IF v_amount = 0 THEN
    DELETE FROM public.billing_adjustments
    WHERE booking_id = p_booking_id
      AND adjustment_type = 'double_occupancy_discount';
  ELSE
    SELECT id
    INTO v_existing_id
    FROM public.billing_adjustments
    WHERE booking_id = p_booking_id
      AND adjustment_type = 'double_occupancy_discount';

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.billing_adjustments
      SET
        adjusted_amount = -v_amount,
        reason = 'Double occupancy 15% discount (' ||
          (SELECT COUNT(*) FROM public.booking_pets WHERE booking_id = p_booking_id)::text ||
          ' pets sharing room)',
        approved_by = 'system'
      WHERE id = v_existing_id;
      v_adjustment_id := v_existing_id;
    ELSE
      INSERT INTO public.billing_adjustments (
        owner_id,
        booking_id,
        invoice_id,
        adjustment_type,
        original_amount,
        adjusted_amount,
        reason,
        approved_by
      )
      VALUES (
        v_owner_id,
        p_booking_id,
        v_invoice_id,
        'double_occupancy_discount',
        v_amount,
        -v_amount,
        'Double occupancy 15% discount (' ||
          (SELECT COUNT(*) FROM public.booking_pets WHERE booking_id = p_booking_id)::text ||
          ' pets sharing room)',
        'system'
      )
      RETURNING id INTO v_adjustment_id;
    END IF;
  END IF;

  SELECT COALESCE(SUM(ABS(adjusted_amount)), 0)
  INTO v_adj
  FROM public.billing_adjustments
  WHERE invoice_id = v_invoice_id
    AND adjustment_type IN (
      'discount_override',
      'double_occupancy_discount',
      'fee_waived',
      'goodwill_credit',
      'adjustment'
    );

  v_discount := ROUND(v_preserved + v_adj, 2);
  v_total := GREATEST(0, ROUND(v_subtotal - v_discount, 2));
  v_vat := CASE
    WHEN (SELECT vat_aed FROM public.invoices WHERE id = v_invoice_id) IS NOT NULL
      THEN ROUND(v_total - (v_total / 1.05), 2)
    ELSE NULL
  END;

  UPDATE public.invoices
  SET
    discount_amount = v_discount,
    discount_pct = CASE
      WHEN v_subtotal > 0 THEN ROUND((v_discount / v_subtotal) * 100, 2)
      ELSE 0
    END,
    total = v_total,
    vat_aed = COALESCE(v_vat, vat_aed),
    updated_at = now()
  WHERE id = v_invoice_id;

  RETURN v_adjustment_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.process_wallet_payment(
  p_invoice_id uuid,
  p_performed_by text DEFAULT 'system'::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner_id uuid;
  v_status public.invoice_status;
  v_payable numeric;
  v_amount numeric;
  v_balance numeric;
  v_new_balance numeric;
  v_wallet_tx_id uuid;
  v_already_paid numeric;
BEGIN
  SELECT
    i.owner_id,
    i.status,
    ROUND(COALESCE(i.amount_paid, 0), 2)
  INTO v_owner_id, v_status, v_already_paid
  FROM public.invoices i
  WHERE i.id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN '{"success":false,"error":"Invoice not found"}'::json;
  END IF;

  IF v_status IN ('voided', 'consolidated', 'cancelled') THEN
    RETURN json_build_object('success', false, 'error', 'Cannot pay a closed invoice');
  END IF;

  v_payable := public.invoice_wallet_payable(p_invoice_id);

  -- Copy a header discount onto total before charging so a stale subtotal is
  -- not what the wallet pays, and an earlier overcharge is refunded by
  -- trg_refund_wallet_when_invoice_total_drops.
  UPDATE public.invoices
  SET total = v_payable,
      updated_at = now()
  WHERE id = p_invoice_id
    AND ROUND(COALESCE(total, 0), 2) > v_payable + 0.01;

  SELECT ROUND(COALESCE(amount_paid, 0), 2)
  INTO v_already_paid
  FROM public.invoices
  WHERE id = p_invoice_id;

  v_amount := ROUND(GREATEST(0, v_payable - v_already_paid), 2);
  IF v_amount <= 0 THEN
    RETURN json_build_object('success', true, 'amount_charged', 0);
  END IF;

  SELECT wallet_balance INTO v_balance FROM public.owners WHERE id = v_owner_id FOR UPDATE;

  IF v_balance < v_amount THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient wallet balance',
      'shortfall', ROUND(v_amount - v_balance, 2)
    );
  END IF;

  v_new_balance := ROUND(v_balance - v_amount, 2);

  UPDATE public.owners SET wallet_balance = v_new_balance WHERE id = v_owner_id;

  INSERT INTO public.wallet_transactions (
    owner_id,
    transaction_type,
    amount,
    balance_after,
    invoice_id,
    payment_method,
    performed_by,
    notes
  ) VALUES (
    v_owner_id,
    'deduction',
    -v_amount,
    v_new_balance,
    p_invoice_id,
    'wallet'::public.payment_method,
    COALESCE(NULLIF(trim(p_performed_by), ''), 'system'),
    'Invoice payment via wallet'
  )
  RETURNING id INTO v_wallet_tx_id;

  INSERT INTO public.invoice_payments (
    invoice_id,
    owner_id,
    amount,
    payment_method,
    wallet_transaction_id,
    opening_balance,
    closing_balance,
    recorded_by,
    notes
  ) VALUES (
    p_invoice_id,
    v_owner_id,
    v_amount,
    'wallet'::public.payment_method,
    v_wallet_tx_id,
    v_balance,
    v_new_balance,
    COALESCE(NULLIF(trim(p_performed_by), ''), 'system'),
    'Invoice payment via wallet'
  );

  RETURN json_build_object(
    'success', true,
    'amount_charged', v_amount,
    'new_balance', v_new_balance,
    'wallet_transaction_id', v_wallet_tx_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_wallet_payment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_wallet_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_wallet_payment(uuid, text) TO service_role;

-- Reject a payment row that would push amount_paid above the invoice total.
CREATE OR REPLACE FUNCTION public.reject_invoice_payment_over_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_total numeric;
  v_paid numeric;
BEGIN
  SELECT ROUND(COALESCE(total, 0), 2)
  INTO v_total
  FROM public.invoices
  WHERE id = NEW.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', NEW.invoice_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Allow shrinking a payment (repairs and discount refunds). Only block new money.
  IF TG_OP = 'UPDATE'
     AND ROUND(COALESCE(NEW.amount, 0), 2) <= ROUND(COALESCE(OLD.amount, 0), 2) + 0.009 THEN
    RETURN NEW;
  END IF;

  SELECT ROUND(COALESCE(SUM(amount), 0), 2)
  INTO v_paid
  FROM public.invoice_payments
  WHERE invoice_id = NEW.invoice_id
    AND id IS DISTINCT FROM NEW.id;

  IF ROUND(v_paid + COALESCE(NEW.amount, 0), 2) > v_total + 0.01 THEN
    RAISE EXCEPTION
      'Payment of % would make amount_paid greater than invoice total %',
      ROUND(COALESCE(NEW.amount, 0), 2), v_total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_invoice_payment_over_total ON public.invoice_payments;

CREATE TRIGGER trg_reject_invoice_payment_over_total
  BEFORE INSERT OR UPDATE OF amount ON public.invoice_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_invoice_payment_over_total();

-- When a discount lowers total below what the wallet already paid, credit the
-- difference back and shrink the wallet payment rows so amount_paid follows.
CREATE OR REPLACE FUNCTION public.refund_wallet_when_invoice_total_drops()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_excess numeric;
  v_wallet_paid numeric;
  v_refund numeric;
  v_left numeric;
  v_balance numeric;
  v_new_balance numeric;
  rec record;
  v_number text;
BEGIN
  IF NEW.status IN ('voided', 'cancelled', 'consolidated') THEN
    RETURN NEW;
  END IF;

  IF ROUND(COALESCE(NEW.amount_paid, 0), 2) <= ROUND(COALESCE(NEW.total, 0), 2) + 0.01 THEN
    RETURN NEW;
  END IF;

  -- A higher total can close an existing gap. Do not move money for that.
  IF ROUND(COALESCE(NEW.total, 0), 2) + 0.01 >= ROUND(COALESCE(OLD.total, 0), 2) THEN
    IF ROUND(COALESCE(NEW.amount_paid, 0), 2) > ROUND(COALESCE(OLD.amount_paid, 0), 2) + 0.01 THEN
      RAISE EXCEPTION
        'amount_paid (%) cannot exceed invoice total (%)',
        ROUND(COALESCE(NEW.amount_paid, 0), 2),
        ROUND(COALESCE(NEW.total, 0), 2)
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  v_excess := ROUND(COALESCE(NEW.amount_paid, 0) - COALESCE(NEW.total, 0), 2);

  SELECT ROUND(COALESCE(SUM(amount), 0), 2)
  INTO v_wallet_paid
  FROM public.invoice_payments
  WHERE invoice_id = NEW.id
    AND payment_method = 'wallet'::public.payment_method
    AND amount > 0;

  v_refund := ROUND(LEAST(v_excess, v_wallet_paid), 2);

  IF v_excess - v_refund > 0.01 THEN
    RAISE EXCEPTION
      'amount_paid (%) cannot exceed invoice total (%). Wallet payments cover only % of the %.',
      ROUND(COALESCE(NEW.amount_paid, 0), 2),
      ROUND(COALESCE(NEW.total, 0), 2),
      v_wallet_paid,
      v_excess
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_refund <= 0.009 THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('woof.skip_invoice_payment_sum', 'on', true);

  v_left := v_refund;
  FOR rec IN
    SELECT id, amount
    FROM public.invoice_payments
    WHERE invoice_id = NEW.id
      AND payment_method = 'wallet'::public.payment_method
      AND amount > 0
    ORDER BY created_at DESC, id DESC
  LOOP
    EXIT WHEN v_left <= 0.009;
    IF rec.amount <= v_left + 0.009 THEN
      v_left := ROUND(v_left - rec.amount, 2);
      DELETE FROM public.invoice_payments WHERE id = rec.id;
    ELSE
      UPDATE public.invoice_payments
      SET amount = ROUND(rec.amount - v_left, 2)
      WHERE id = rec.id;
      v_left := 0;
    END IF;
  END LOOP;

  PERFORM set_config('woof.skip_invoice_payment_sum', 'off', true);

  SELECT COALESCE(wallet_balance, 0)
  INTO v_balance
  FROM public.owners
  WHERE id = NEW.owner_id
  FOR UPDATE;

  v_new_balance := ROUND(v_balance + v_refund, 2);
  UPDATE public.owners
  SET wallet_balance = v_new_balance
  WHERE id = NEW.owner_id;

  v_number := COALESCE(NEW.invoice_number, NEW.id::text);

  INSERT INTO public.wallet_transactions (
    owner_id,
    transaction_type,
    amount,
    balance_after,
    invoice_id,
    reference_id,
    reference_type,
    payment_method,
    performed_by,
    notes
  ) VALUES (
    NEW.owner_id,
    'refund'::public.transaction_type,
    v_refund,
    v_new_balance,
    NEW.id,
    NEW.id,
    'invoice_discount',
    'wallet'::public.payment_method,
    'system',
    'Discount on ' || v_number || ' lowered the total. Refunded AED '
      || to_char(v_refund, 'FM999999990.00') || ' to the wallet.'
  );

  NEW.amount_paid := ROUND(COALESCE(NEW.amount_paid, 0) - v_refund, 2);
  IF NEW.amount_paid + 0.01 >= ROUND(COALESCE(NEW.total, 0), 2)
     AND NEW.amount_paid > 0.009
     AND NEW.status NOT IN ('voided', 'cancelled', 'consolidated', 'draft') THEN
    NEW.status := 'paid'::public.invoice_status;
    IF NEW.paid_at IS NULL THEN
      NEW.paid_at := now();
    END IF;
  ELSIF NEW.amount_paid <= 0.009
        AND NEW.status NOT IN ('voided', 'cancelled', 'consolidated', 'draft') THEN
    NEW.amount_paid := 0;
    NEW.status := 'outstanding'::public.invoice_status;
    NEW.paid_at := NULL;
  ELSIF NEW.status = 'paid'::public.invoice_status THEN
    NEW.status := 'partially_paid'::public.invoice_status;
    NEW.paid_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refund_wallet_when_invoice_total_drops ON public.invoices;

CREATE TRIGGER trg_refund_wallet_when_invoice_total_drops
  BEFORE UPDATE OF total, amount_paid ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.refund_wallet_when_invoice_total_drops();

CREATE OR REPLACE FUNCTION public.apply_invoice_payment_sum(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_total numeric;
  v_paid numeric;
  v_status public.invoice_status;
BEGIN
  IF coalesce(current_setting('woof.skip_invoice_payment_sum', true), '') = 'on' THEN
    RETURN;
  END IF;

  SELECT total, status
  INTO v_total, v_status
  FROM public.invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_status IN (
    'voided'::public.invoice_status,
    'cancelled'::public.invoice_status,
    'consolidated'::public.invoice_status
  ) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_paid
  FROM public.invoice_payments
  WHERE invoice_id = p_invoice_id;

  UPDATE public.invoices
  SET amount_paid = v_paid,
      status = CASE
        WHEN v_paid <= 0 THEN 'outstanding'::public.invoice_status
        WHEN v_paid + 0.01 >= v_total THEN 'paid'::public.invoice_status
        ELSE 'partially_paid'::public.invoice_status
      END,
      paid_at = CASE WHEN v_paid + 0.01 >= v_total THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_invoice_id;
END;
$$;


-- Auto-apply and account collection use the same payable total (invoice total
-- after a header discount), not the pre-discount subtotal.

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
      ROUND(GREATEST(public.invoice_wallet_payable(i.id) - COALESCE(i.amount_paid, 0), 0), 2) AS balance
    FROM public.invoices i
    WHERE i.owner_id = p_owner_id
      AND COALESCE(i.receipt_only, false) = false
      AND i.status IN ('outstanding', 'overdue', 'partially_paid')
      AND (public.invoice_wallet_payable(i.id) - COALESCE(i.amount_paid, 0)) > 0
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

    UPDATE public.invoices
    SET total = public.invoice_wallet_payable(id),
        updated_at = now()
    WHERE id = rec.invoice_id
      AND ROUND(COALESCE(total, 0), 2) > public.invoice_wallet_payable(id) + 0.01
      AND ROUND(COALESCE(amount_paid, 0), 2) <= public.invoice_wallet_payable(id) + 0.01;

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

CREATE OR REPLACE FUNCTION public.collect_account_payment(
  p_owner_id        uuid,
  p_wallet_amount   numeric,
  p_external_amount numeric,
  p_external_method payment_method,
  p_performed_by    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wallet_balance      numeric;
  v_wallet_balance_after numeric;
  v_total_payment       numeric;
  v_total_collectable   numeric;
  v_remaining_wallet    numeric;
  v_remaining_external  numeric;
  v_apply               numeric;
  v_opening             numeric;
  v_closing             numeric;
  v_invoices_affected   integer;
  v_allocations         jsonb;
  rec                   RECORD;
BEGIN
  IF COALESCE(p_wallet_amount, 0) < 0 OR COALESCE(p_external_amount, 0) < 0 THEN
    RAISE EXCEPTION 'Payment amounts must be non-negative';
  END IF;

  v_total_payment := ROUND(COALESCE(p_wallet_amount, 0) + COALESCE(p_external_amount, 0), 3);
  IF v_total_payment <= 0 THEN
    RAISE EXCEPTION 'Total payment must be greater than zero';
  END IF;

  IF ROUND(COALESCE(p_external_amount, 0), 3) > 0 AND p_external_method IS NULL THEN
    RAISE EXCEPTION 'External payment method is required when external amount is greater than zero';
  END IF;

  IF ROUND(COALESCE(p_external_amount, 0), 3) > 0
     AND p_external_method NOT IN ('card', 'cash', 'bank_transfer') THEN
    RAISE EXCEPTION 'External payment method must be card, cash, or bank_transfer';
  END IF;

  SELECT COALESCE(wallet_balance, 0)
  INTO v_wallet_balance
  FROM owners
  WHERE id = p_owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owner not found';
  END IF;

  IF ROUND(COALESCE(p_wallet_amount, 0), 3) > ROUND(v_wallet_balance, 3) THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  CREATE TEMP TABLE tmp_collect_invoices ON COMMIT DROP AS
  SELECT
    row_number() OVER (
      ORDER BY i.due_date ASC NULLS LAST, i.created_at ASC
    ) AS sort_order,
    i.id AS invoice_id,
    i.invoice_number::text AS invoice_number,
    ROUND(GREATEST(public.invoice_wallet_payable(i.id) - COALESCE(i.amount_paid, 0), 0), 2) AS balance,
    0::numeric AS wallet_applied,
    0::numeric AS external_applied
  FROM public.invoices i
  WHERE i.owner_id = p_owner_id
    AND COALESCE(i.receipt_only, false) = false
    AND i.status IN ('outstanding', 'overdue', 'partially_paid')
    AND (public.invoice_wallet_payable(i.id) - COALESCE(i.amount_paid, 0)) > 0;

  SELECT COALESCE(SUM(balance), 0)
  INTO v_total_collectable
  FROM tmp_collect_invoices;

  IF v_total_collectable <= 0 THEN
    RAISE EXCEPTION 'No collectable invoices for this owner';
  END IF;

  IF v_total_payment > v_total_collectable THEN
    RAISE EXCEPTION 'Overpayment not allowed: total payment (%) exceeds collectable balance (%)',
      v_total_payment, v_total_collectable;
  END IF;

  UPDATE public.invoices i
  SET total = public.invoice_wallet_payable(i.id),
      updated_at = now()
  FROM tmp_collect_invoices t
  WHERE i.id = t.invoice_id
    AND ROUND(COALESCE(i.total, 0), 2) > public.invoice_wallet_payable(i.id) + 0.01;

  -- ── Wallet allocation (oldest first) ─────────────────────────────────────
  v_remaining_wallet := ROUND(COALESCE(p_wallet_amount, 0), 3);

  IF v_remaining_wallet > 0 THEN
    FOR rec IN
      SELECT sort_order, invoice_id, balance
      FROM tmp_collect_invoices
      ORDER BY sort_order
    LOOP
      EXIT WHEN v_remaining_wallet <= 0;

      IF rec.balance <= 0 THEN
        CONTINUE;
      END IF;

      v_apply := ROUND(LEAST(v_remaining_wallet, rec.balance), 3);
      IF v_apply <= 0 THEN
        CONTINUE;
      END IF;

      v_opening := rec.balance;
      v_closing := ROUND(rec.balance - v_apply, 3);

      INSERT INTO invoice_payments (
        invoice_id,
        owner_id,
        amount,
        payment_method,
        recorded_by,
        opening_balance,
        closing_balance
      ) VALUES (
        rec.invoice_id,
        p_owner_id,
        v_apply,
        'wallet',
        COALESCE(NULLIF(trim(p_performed_by), ''), 'system'),
        v_opening,
        v_closing
      );

      UPDATE tmp_collect_invoices
      SET
        balance = v_closing,
        wallet_applied = wallet_applied + v_apply
      WHERE sort_order = rec.sort_order;

      v_remaining_wallet := ROUND(v_remaining_wallet - v_apply, 3);
    END LOOP;

    -- Single wallet ledger row for the full wallet leg
    v_wallet_balance_after := ROUND(v_wallet_balance - ROUND(COALESCE(p_wallet_amount, 0), 3), 3);

    INSERT INTO wallet_transactions (
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
      -ROUND(COALESCE(p_wallet_amount, 0), 3),
      v_wallet_balance_after,
      'account_payment',
      'wallet',
      COALESCE(NULLIF(trim(p_performed_by), ''), 'system'),
      'Account payment via wallet'
    );
  END IF;

  -- ── External allocation (oldest first, reduced balances) ─────────────────
  v_remaining_external := ROUND(COALESCE(p_external_amount, 0), 3);

  IF v_remaining_external > 0 THEN
    FOR rec IN
      SELECT sort_order, invoice_id, balance
      FROM tmp_collect_invoices
      ORDER BY sort_order
    LOOP
      EXIT WHEN v_remaining_external <= 0;

      IF rec.balance <= 0 THEN
        CONTINUE;
      END IF;

      v_apply := ROUND(LEAST(v_remaining_external, rec.balance), 3);
      IF v_apply <= 0 THEN
        CONTINUE;
      END IF;

      v_opening := rec.balance;
      v_closing := ROUND(rec.balance - v_apply, 3);

      INSERT INTO invoice_payments (
        invoice_id,
        owner_id,
        amount,
        payment_method,
        recorded_by,
        opening_balance,
        closing_balance
      ) VALUES (
        rec.invoice_id,
        p_owner_id,
        v_apply,
        p_external_method,
        COALESCE(NULLIF(trim(p_performed_by), ''), 'system'),
        v_opening,
        v_closing
      );

      UPDATE tmp_collect_invoices
      SET
        balance = v_closing,
        external_applied = external_applied + v_apply
      WHERE sort_order = rec.sort_order;

      v_remaining_external := ROUND(v_remaining_external - v_apply, 3);
    END LOOP;
  END IF;

  SELECT COUNT(*)
  INTO v_invoices_affected
  FROM tmp_collect_invoices
  WHERE wallet_applied + external_applied > 0;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'invoice_id', invoice_id,
        'invoice_number', invoice_number,
        'wallet_amount', wallet_applied,
        'external_amount', external_applied
      )
      ORDER BY sort_order
    ),
    '[]'::jsonb
  )
  INTO v_allocations
  FROM tmp_collect_invoices
  WHERE wallet_applied + external_applied > 0;

  RETURN jsonb_build_object(
    'total_collected', v_total_payment,
    'wallet_applied', ROUND(COALESCE(p_wallet_amount, 0), 3),
    'external_applied', ROUND(COALESCE(p_external_amount, 0), 3),
    'invoices_affected', v_invoices_affected,
    'allocations', v_allocations
  );
END;
$$;

-- Read-only: owners with invoices already paid above the total.
-- SELECT
--   o.first_name,
--   o.last_name,
--   i.invoice_number,
--   i.status,
--   i.subtotal,
--   i.discount_amount,
--   i.total,
--   i.amount_paid,
--   ROUND(i.amount_paid - i.total, 2) AS overpaid
-- FROM public.invoices i
-- JOIN public.owners o ON o.id = i.owner_id
-- WHERE ROUND(COALESCE(i.amount_paid, 0), 2) > ROUND(COALESCE(i.total, 0), 2) + 0.01
-- ORDER BY o.last_name, o.first_name, i.invoice_number;

-- Verification:
-- SELECT proname FROM pg_proc
-- WHERE proname IN (
--   'invoice_wallet_charge_total',
--   'invoice_wallet_payable',
--   'refund_wallet_when_invoice_total_drops'
-- );
-- SELECT tgname FROM pg_trigger
-- WHERE tgname IN (
--   'trg_reject_invoice_payment_over_total',
--   'trg_refund_wallet_when_invoice_total_drops'
-- );
