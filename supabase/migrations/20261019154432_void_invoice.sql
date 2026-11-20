-- One void path. Returns the amount credited to the wallet (0 when nothing was paid).
-- Already applied on live; this file records it for the repo.

CREATE OR REPLACE FUNCTION public.void_invoice(
  p_invoice uuid,
  p_reason text,
  p_staff text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_balance numeric;
  v_paid numeric;
  v_payment_rows integer;
  v_reason text;
  v_staff text;
  v_number text;
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'void_invoice requires a signed-in staff session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_reason := nullif(trim(p_reason), '');
  v_staff := nullif(trim(p_staff), '');

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A void reason is required' USING ERRCODE = 'check_violation';
  END IF;
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Staff name is required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice USING ERRCODE = 'no_data_found';
  END IF;

  IF v_invoice.status = 'voided'::public.invoice_status THEN
    RAISE EXCEPTION 'Invoice % is already voided', coalesce(v_invoice.invoice_number, v_invoice.id::text)
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_invoice.status IN ('consolidated'::public.invoice_status, 'cancelled'::public.invoice_status) THEN
    RAISE EXCEPTION 'Invoice % is % and cannot be voided',
      coalesce(v_invoice.invoice_number, v_invoice.id::text), v_invoice.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(wallet_balance, 0)
  INTO v_balance
  FROM public.owners
  WHERE id = v_invoice.owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owner % not found', v_invoice.owner_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT COUNT(*)::integer, ROUND(COALESCE(SUM(amount), 0), 2)
  INTO v_payment_rows, v_paid
  FROM public.invoice_payments
  WHERE invoice_id = v_invoice.id;

  IF v_payment_rows = 0 THEN
    v_paid := ROUND(COALESCE(v_invoice.amount_paid, 0), 2);
  END IF;

  IF v_paid < 0 THEN
    RAISE EXCEPTION 'Invoice % has a negative amount paid', coalesce(v_invoice.invoice_number, v_invoice.id::text)
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.invoices
  SET status = 'voided'::public.invoice_status,
      voided_at = now(),
      voided_by = v_staff,
      voided_reason = v_reason
  WHERE id = v_invoice.id;

  IF v_paid > 0 THEN
    v_number := coalesce(v_invoice.invoice_number, v_invoice.id::text);
    v_balance := ROUND(v_balance + v_paid, 2);

    INSERT INTO public.wallet_transactions (
      owner_id,
      transaction_type,
      amount,
      balance_after,
      invoice_id,
      reference_id,
      reference_type,
      performed_by,
      notes
    ) VALUES (
      v_invoice.owner_id,
      'refund'::public.transaction_type,
      v_paid,
      v_balance,
      NULL,
      v_invoice.id,
      'invoice_void',
      v_staff,
      'Refund of voided ' || v_number || ': ' || v_reason
    );

    UPDATE public.owners
    SET wallet_balance = v_balance
    WHERE id = v_invoice.owner_id;
  END IF;

  RETURN v_paid;
END;
$$;

REVOKE ALL ON FUNCTION public.void_invoice(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_invoice_payment_sum(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_total numeric;
  v_paid numeric;
  v_status public.invoice_status;
BEGIN
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
        WHEN v_paid >= v_total THEN 'paid'::public.invoice_status
        ELSE 'partially_paid'::public.invoice_status
      END,
      paid_at = CASE WHEN v_paid >= v_total THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_invoice_id;
END;
$$;

DROP FUNCTION IF EXISTS public.revoke_daycare_package_credit(uuid, text);

CREATE OR REPLACE FUNCTION public.revoke_daycare_package_credit(
  p_credit_id uuid,
  p_reason text DEFAULT NULL,
  p_staff text DEFAULT NULL
)
RETURNS TABLE(credit_id uuid, invoice_voided boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_credit record;
  v_session_count int;
  v_active_sibling_count int;
  v_invoice_id uuid;
  v_invoice_status public.invoice_status;
  v_invoice_voided boolean := false;
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'revoke_daycare_package_credit requires authenticated user';
  END IF;

  SELECT *
  INTO v_credit
  FROM public.service_credits
  WHERE id = p_credit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package credit % not found', p_credit_id;
  END IF;

  IF v_credit.service_code NOT IN ('daycare_full_day', 'daycare_hourly') THEN
    RAISE EXCEPTION 'Only daycare package credits can be revoked with this function';
  END IF;

  IF v_credit.status = 'revoked' THEN
    RETURN QUERY SELECT p_credit_id, false;
    RETURN;
  END IF;

  IF coalesce(v_credit.units_consumed, 0) > 0 THEN
    RAISE EXCEPTION 'Cannot remove package — % day(s) already used. Cancel check-ins first if needed.',
      v_credit.units_consumed;
  END IF;

  SELECT count(*) INTO v_session_count
  FROM public.daycare_sessions ds
  WHERE ds.package_id = p_credit_id;

  IF v_session_count > 0 THEN
    RAISE EXCEPTION 'Cannot remove package — % planner/check-in session(s) still linked. Delete those sessions first.',
      v_session_count;
  END IF;

  UPDATE public.service_credits
  SET status = 'revoked'
  WHERE id = p_credit_id;

  v_invoice_id := NULL;
  IF v_credit.purchase_group_id IS NOT NULL THEN
    SELECT pg.invoice_id INTO v_invoice_id
    FROM public.purchase_groups pg
    WHERE pg.id = v_credit.purchase_group_id;
  END IF;

  IF v_invoice_id IS NOT NULL AND v_credit.purchase_group_id IS NOT NULL THEN
    SELECT count(*) INTO v_active_sibling_count
    FROM public.service_credits sc
    WHERE sc.purchase_group_id = v_credit.purchase_group_id
      AND sc.id <> p_credit_id
      AND sc.status = 'active';

    IF v_active_sibling_count = 0 THEN
      SELECT i.status INTO v_invoice_status
      FROM public.invoices i
      WHERE i.id = v_invoice_id;

      IF v_invoice_status IS NOT NULL
         AND v_invoice_status NOT IN (
           'voided'::public.invoice_status,
           'cancelled'::public.invoice_status,
           'consolidated'::public.invoice_status
         ) THEN
        PERFORM public.void_invoice(
          v_invoice_id,
          coalesce(nullif(trim(p_reason), ''), 'Daycare package removed by staff'),
          p_staff
        );
        v_invoice_voided := true;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT p_credit_id, v_invoice_voided;
END
$function$;

REVOKE ALL ON FUNCTION public.revoke_daycare_package_credit(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_daycare_package_credit(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_daycare_package_credit(uuid, text, text) TO service_role;
