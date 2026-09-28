-- Closing an invoice as paid must actually settle it:
--   * invoice_payments covering the total, or
--   * a net wallet movement on that invoice of a single negative deduction
--     (money left the wallet).
-- A refund paired with a deduction that nets to ~0 marks the invoice paid
-- without charging owners.wallet_balance, so the SOA ledger keeps a debit
-- the wallet does not have. Reject positive deductions outright, and reject
-- a status change to paid that is not covered by payments or a net deduction.

CREATE OR REPLACE FUNCTION public.reject_non_negative_wallet_deduction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transaction_type = 'deduction'::public.transaction_type
     AND COALESCE(NEW.amount, 0) >= 0 THEN
    RAISE EXCEPTION
      'Wallet deduction must be a single negative amount so the owner balance decreases. A positive deduction (often paired with a refund that nets to zero) does not settle an invoice.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_non_negative_wallet_deduction ON public.wallet_transactions;

CREATE TRIGGER trg_reject_non_negative_wallet_deduction
  BEFORE INSERT OR UPDATE OF amount, transaction_type
  ON public.wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_non_negative_wallet_deduction();

CREATE OR REPLACE FUNCTION public.guard_invoice_paid_requires_settlement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_payments numeric;
  v_wallet_net numeric;
  v_total numeric;
BEGIN
  IF NEW.status IS DISTINCT FROM 'paid'::public.invoice_status THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid'::public.invoice_status THEN
    RETURN NEW;
  END IF;

  v_total := ROUND(COALESCE(NEW.total, 0), 2);
  IF v_total <= 0.01 THEN
    RETURN NEW;
  END IF;

  SELECT ROUND(COALESCE(SUM(amount), 0), 2)
  INTO v_payments
  FROM public.invoice_payments
  WHERE invoice_id = NEW.id;

  -- Net of invoice-linked deduction + refund. A real charge is negative.
  -- A refund that cancels a deduction sums to ~0 and must not count as paid.
  SELECT ROUND(COALESCE(SUM(amount), 0), 2)
  INTO v_wallet_net
  FROM public.wallet_transactions
  WHERE invoice_id = NEW.id
    AND transaction_type IN (
      'deduction'::public.transaction_type,
      'refund'::public.transaction_type
    );

  IF v_payments + 0.01 < v_total
     AND v_wallet_net > -v_total + 0.01 THEN
    RAISE EXCEPTION
      'Cannot mark invoice % paid without invoice_payments covering the total or a net wallet deduction. A refund and deduction that net to zero do not charge the wallet.',
      COALESCE(NEW.invoice_number, NEW.id::text)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_paid_requires_settlement ON public.invoices;

CREATE TRIGGER trg_guard_invoice_paid_requires_settlement
  BEFORE INSERT OR UPDATE OF status
  ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_invoice_paid_requires_settlement();

-- Verification (no data changes):
-- SELECT tgname FROM pg_trigger
-- WHERE tgname IN (
--   'trg_reject_non_negative_wallet_deduction',
--   'trg_guard_invoice_paid_requires_settlement'
-- );
