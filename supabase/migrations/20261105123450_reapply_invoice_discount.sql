-- Recalculating an invoice (date change, extra night, drop-off line) used to
-- call apply_double_occupancy_discount, which set discount_amount and
-- discount_pct back to 0 whenever the stay had no double-occupancy amount.
-- Approved discount_override rows were left behind and never re-applied.
--
-- reapply_invoice_discount rebuilds the discount from the current lines and
-- the approved adjustments in one transaction:
--   * a percent (discount_pct, or a discount_override reason/approval with "%")
--     is applied to the new subtotal
--   * a fixed AED discount is kept, capped at the new subtotal
--   * VAT is recomputed from the VAT-inclusive total
--   * status follows amount_paid
--   * an invoice_amendments row is written when the discount AED changes

CREATE OR REPLACE FUNCTION public.discount_percent_in_text(p_text text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_text text;
BEGIN
  v_text := substring(COALESCE(p_text, '') from '([0-9]+(?:[.][0-9]+)?)[[:space:]]*%');
  IF v_text IS NULL OR v_text::numeric <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN LEAST(100, v_text::numeric);
END
$$;

CREATE OR REPLACE FUNCTION public.reapply_invoice_discount(
  p_invoice_id uuid,
  p_amended_by text DEFAULT 'system'
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_status public.invoice_status;
  v_new_status public.invoice_status;
  v_previous_subtotal numeric;
  v_subtotal numeric;
  v_header_pct numeric;
  v_header_amount numeric;
  v_old_adj numeric;
  v_member numeric;
  v_member_amount numeric := 0;
  v_member_pct numeric;
  v_used numeric := 0;
  v_remaining numeric;
  v_part numeric;
  v_pct numeric;
  v_discount numeric;
  v_total numeric;
  v_vat numeric;
  v_stored_pct numeric := 0;
  v_percent_count integer := 0;
  v_only_pct numeric;
  v_paid numeric;
  v_pay_count integer;
  v_paid_at timestamptz;
  v_old_discount numeric;
  rec record;
BEGIN
  SELECT
    status,
    ROUND(COALESCE(subtotal, 0), 2),
    LEAST(100, GREATEST(COALESCE(discount_pct, 0), 0)),
    ROUND(GREATEST(COALESCE(discount_amount, 0), 0), 2),
    paid_at,
    ROUND(COALESCE(discount_amount, 0), 2)
  INTO
    v_status,
    v_previous_subtotal,
    v_header_pct,
    v_header_amount,
    v_paid_at,
    v_old_discount
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;

  IF v_status IN ('voided', 'cancelled', 'consolidated') THEN
    RETURN;
  END IF;

  SELECT ROUND(COALESCE(SUM(unit_price * GREATEST(COALESCE(quantity, 1), 1)), 0), 2)
  INTO v_subtotal
  FROM public.invoice_line_items
  WHERE invoice_id = p_invoice_id;

  SELECT ROUND(COALESCE(SUM(ABS(adjusted_amount)), 0), 2)
  INTO v_old_adj
  FROM public.billing_adjustments
  WHERE invoice_id = p_invoice_id
    AND adjustment_type IN (
      'discount_override',
      'double_occupancy_discount',
      'fee_waived',
      'goodwill_credit',
      'adjustment'
    );

  IF v_header_amount + 0.02 >= v_old_adj THEN
    v_member := ROUND(GREATEST(v_header_amount - v_old_adj, 0), 2);
  ELSE
    v_member := 0;
  END IF;

  FOR rec IN
    SELECT
      id,
      adjustment_type,
      adjusted_amount,
      reason,
      approved_by,
      CASE
        WHEN adjustment_type = 'discount_override' THEN COALESCE(
          public.discount_percent_in_text(reason),
          public.discount_percent_in_text(approved_by)
        )
        ELSE NULL
      END AS parsed_pct
    FROM public.billing_adjustments
    WHERE invoice_id = p_invoice_id
      AND adjustment_type IN (
        'discount_override',
        'double_occupancy_discount',
        'fee_waived',
        'goodwill_credit',
        'adjustment'
      )
    ORDER BY
      CASE
        WHEN adjustment_type = 'discount_override'
          AND COALESCE(
            public.discount_percent_in_text(reason),
            public.discount_percent_in_text(approved_by)
          ) IS NOT NULL
        THEN 0
        ELSE 1
      END,
      created_at
  LOOP
    v_remaining := ROUND(GREATEST(v_subtotal - v_used, 0), 2);
    v_pct := rec.parsed_pct;
    IF v_pct IS NOT NULL THEN
      v_part := ROUND(LEAST(v_remaining, v_subtotal * v_pct / 100), 2);
      v_percent_count := v_percent_count + 1;
      v_only_pct := v_pct;
    ELSE
      v_part := ROUND(LEAST(v_remaining, ABS(COALESCE(rec.adjusted_amount, 0))), 2);
    END IF;
    v_used := ROUND(v_used + v_part, 2);

    IF rec.adjustment_type = 'discount_override'
       AND ABS(ROUND(ABS(COALESCE(rec.adjusted_amount, 0)), 2) - v_part) > 0.009 THEN
      UPDATE public.billing_adjustments
      SET adjusted_amount = v_part
      WHERE id = rec.id;
    END IF;
  END LOOP;

  v_remaining := ROUND(GREATEST(v_subtotal - v_used, 0), 2);
  IF v_old_adj = 0 AND v_header_pct > 0 THEN
    v_member_amount := ROUND(LEAST(v_subtotal, v_subtotal * v_header_pct / 100), 2);
    v_stored_pct := v_header_pct;
  ELSIF v_old_adj = 0 AND v_header_amount > 0 THEN
    v_member_amount := ROUND(LEAST(v_subtotal, v_header_amount), 2);
  ELSIF v_member > 0.009 AND v_header_pct > 0 AND v_previous_subtotal > 0 THEN
    v_member_pct := ROUND((v_member / v_previous_subtotal) * 100, 2);
    v_member_amount := ROUND(LEAST(v_remaining, v_subtotal * v_member_pct / 100), 2);
  ELSIF v_member > 0.009 THEN
    v_member_amount := ROUND(LEAST(v_remaining, v_member), 2);
  END IF;

  IF v_percent_count = 1 AND v_member_amount <= 0.009 THEN
    v_stored_pct := v_only_pct;
  END IF;

  v_discount := ROUND(LEAST(v_subtotal, v_used + v_member_amount), 2);
  v_total := ROUND(GREATEST(v_subtotal - v_discount, 0), 2);
  v_vat := ROUND(v_total - (v_total / 1.05), 2);

  SELECT COUNT(*), ROUND(COALESCE(SUM(amount), 0), 2)
  INTO v_pay_count, v_paid
  FROM public.invoice_payments
  WHERE invoice_id = p_invoice_id;

  IF v_pay_count = 0 THEN
    SELECT ROUND(COALESCE(amount_paid, 0), 2)
    INTO v_paid
    FROM public.invoices
    WHERE id = p_invoice_id;
  END IF;

  IF v_total <= 0 THEN
    IF v_paid > 0 THEN
      v_new_status := 'paid';
    ELSE
      v_new_status := v_status;
    END IF;
  ELSIF v_paid >= v_total THEN
    v_new_status := 'paid';
  ELSIF v_paid > 0 THEN
    IF v_status = 'overdue' THEN
      v_new_status := 'overdue';
    ELSE
      v_new_status := 'partially_paid';
    END IF;
  ELSIF v_status IN ('paid', 'partially_paid') THEN
    v_new_status := 'outstanding';
  ELSE
    v_new_status := v_status;
  END IF;

  UPDATE public.invoices
  SET
    subtotal = v_subtotal,
    discount_amount = v_discount,
    discount_pct = ROUND(COALESCE(v_stored_pct, 0), 2),
    total = v_total,
    vat_aed = v_vat,
    amount_paid = v_paid,
    status = v_new_status,
    paid_at = CASE
      WHEN v_new_status = 'paid' THEN COALESCE(v_paid_at, now())
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = p_invoice_id;

  IF ABS(COALESCE(v_old_discount, 0) - v_discount) > 0.009 THEN
    INSERT INTO public.invoice_amendments (
      invoice_id,
      field_changed,
      old_value,
      new_value,
      reason,
      amended_by
    ) VALUES (
      p_invoice_id,
      'discount_amount',
      to_char(COALESCE(v_old_discount, 0), 'FM999999990.00'),
      to_char(v_discount, 'FM999999990.00'),
      'auto re-applied after recalculation',
      COALESCE(NULLIF(btrim(p_amended_by), ''), 'system')
    );
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.reapply_invoice_discount(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reapply_invoice_discount(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reapply_invoice_discount(uuid, text) TO service_role;

-- Double occupancy must not replace an approved discount with zero.
-- It updates only its own adjustment, then re-applies every discount.
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
BEGIN
  v_amount := public.calculate_double_occupancy_discount(p_booking_id);

  SELECT id, owner_id
  INTO v_invoice_id, v_owner_id
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

  PERFORM public.reapply_invoice_discount(v_invoice_id, 'system');
  RETURN v_adjustment_id;
END
$function$;

-- Verification (read-only):
-- SELECT proname FROM pg_proc
-- WHERE proname IN ('reapply_invoice_discount', 'discount_percent_in_text');
-- SELECT public.discount_percent_in_text('sharing with Luna Azmi (15%)');
-- -- expected: 15
