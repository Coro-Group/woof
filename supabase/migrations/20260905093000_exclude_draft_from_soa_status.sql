-- Exclude draft from SOA ledger classification (not finalized → not debt).
-- get_ledger_statement / get_statement_of_account call this helper.

CREATE OR REPLACE FUNCTION public.is_soa_invoice_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status NOT IN ('voided', 'consolidated', 'cancelled', 'draft');
$$;

-- Verification:
-- SELECT public.is_soa_invoice_status('draft');        -- false
-- SELECT public.is_soa_invoice_status('outstanding');  -- true
