-- URGENT: Fix short-window duplicate payment trigger time comparison.
-- Paste into Supabase SQL editor (project wineliuwejkxwsdbrthb).
-- Source: supabase/migrations/20260831140000_fix_invoice_payment_dedupe_window_now.sql
--
-- Replaces timezone('utc', now()) with now() so the 5s window compares
-- timestamptz to timestamptz (session TimeZone safe).

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

-- Verification: body should contain "now() - interval '5 seconds'" and not timezone('utc'
SELECT pg_get_functiondef('public.trg_reject_short_window_duplicate_invoice_payment'::regproc);
