-- URGENT: Short-window duplicate guard on invoice_payments (double-click race).
-- Paste into Supabase SQL editor (project wineliuwejkxwsdbrthb).
-- Source: supabase/migrations/20260829170000_invoice_payment_short_window_dedupe.sql
--
-- Rejects identical invoice_id + amount + payment_method within 5 seconds
-- unless insert_invoice_payment(..., p_confirm_duplicate := true) is used
-- (staff "Record anyway" override). Advisory lock serializes concurrent inserts.

CREATE OR REPLACE FUNCTION public.trg_reject_short_window_duplicate_invoice_payment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allow_dup text;
BEGIN
  allow_dup := lower(coalesce(
    nullif(current_setting('app.allow_duplicate_invoice_payment', true), ''),
    'false'
  ));
  IF allow_dup IN ('true', 'on', '1') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(87201401, hashtext(NEW.invoice_id::text));

  IF EXISTS (
    SELECT 1
    FROM public.invoice_payments p
    WHERE p.invoice_id = NEW.invoice_id
      AND p.amount = NEW.amount
      AND p.payment_method = NEW.payment_method
      AND p.created_at > (now() - interval '5 seconds')
  ) THEN
    RAISE EXCEPTION
      'DUPLICATE_PAYMENT_REJECTED: identical invoice_id+amount+payment_method within 5 seconds'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_short_window_duplicate_invoice_payment
  ON public.invoice_payments;

CREATE TRIGGER trg_reject_short_window_duplicate_invoice_payment
  BEFORE INSERT ON public.invoice_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reject_short_window_duplicate_invoice_payment();

CREATE OR REPLACE FUNCTION public.insert_invoice_payment(
  p_invoice_id uuid,
  p_owner_id uuid,
  p_amount numeric,
  p_payment_method public.payment_method,
  p_opening_balance numeric,
  p_closing_balance numeric,
  p_recorded_by text,
  p_notes text DEFAULT NULL,
  p_wallet_transaction_id uuid DEFAULT NULL,
  p_confirm_duplicate boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF coalesce(p_confirm_duplicate, false) THEN
    PERFORM set_config('app.allow_duplicate_invoice_payment', 'true', true);
  END IF;

  INSERT INTO public.invoice_payments (
    invoice_id,
    owner_id,
    amount,
    payment_method,
    opening_balance,
    closing_balance,
    recorded_by,
    notes,
    wallet_transaction_id
  ) VALUES (
    p_invoice_id,
    p_owner_id,
    p_amount,
    p_payment_method,
    p_opening_balance,
    p_closing_balance,
    p_recorded_by,
    p_notes,
    p_wallet_transaction_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_invoice_payment(
  uuid, uuid, numeric, public.payment_method, numeric, numeric, text, text, uuid, boolean
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.insert_invoice_payment(
  uuid, uuid, numeric, public.payment_method, numeric, numeric, text, text, uuid, boolean
) TO service_role;

-- Verification
SELECT tgname
FROM pg_trigger
WHERE tgrelid = 'public.invoice_payments'::regclass
  AND tgname = 'trg_reject_short_window_duplicate_invoice_payment';

SELECT proname
FROM pg_proc
WHERE proname = 'insert_invoice_payment';
