-- URGENT: Recompute amount_paid on invoice_payments DELETE/UPDATE
-- Paste into Supabase SQL editor (project wineliuwejkxwsdbrthb).
-- Source: supabase/migrations/20260919140000_invoice_payments_recompute_on_delete.sql
--
-- Does NOT update invoice/payment data rows except via the trigger function
-- definition. After applying, deleting a duplicate invoice_payments row will
-- set invoices.amount_paid = SUM(remaining payments).

CREATE OR REPLACE FUNCTION public.apply_invoice_payment_sum(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_total numeric;
  v_paid numeric;
  v_status public.invoice_status;
BEGIN
  SELECT total, status INTO v_total, v_status
  FROM public.invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_status IN ('voided'::public.invoice_status, 'consolidated'::public.invoice_status) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.invoice_payments
  WHERE invoice_id = p_invoice_id;

  UPDATE public.invoices SET
    amount_paid = v_paid,
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

CREATE OR REPLACE FUNCTION public.update_invoice_status_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_invoice_id := OLD.invoice_id;
  ELSE
    v_invoice_id := NEW.invoice_id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.apply_invoice_payment_sum(OLD.invoice_id);
  END IF;

  PERFORM public.apply_invoice_payment_sum(v_invoice_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_invoice_status_on_payment ON public.invoice_payments;

CREATE TRIGGER trg_update_invoice_status_on_payment
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_invoice_status_on_payment();

-- Verification
SELECT tgname, pg_get_triggerdef(oid) AS def
FROM pg_trigger
WHERE tgrelid = 'public.invoice_payments'::regclass
  AND tgname = 'trg_update_invoice_status_on_payment'
  AND NOT tgisinternal;
