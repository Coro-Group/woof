-- Complimentary daycare days on grooming packages sold from 24 Nov 2026.
-- SSPL (Summer Splash, both coat lengths) starts at 2 days. Other package
-- types stay at 0 until an admin sets them in Settings.
-- Does not change package prices, grooming sessions, VAT, or wallet logic.
-- Packages sold before 24 Nov 2026 are not backfilled.

ALTER TABLE public.package_definitions
  ADD COLUMN IF NOT EXISTS complimentary_daycare_days integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.package_definitions'::regclass
      AND conname = 'package_definitions_complimentary_daycare_days_check'
  ) THEN
    ALTER TABLE public.package_definitions
      ADD CONSTRAINT package_definitions_complimentary_daycare_days_check
      CHECK (complimentary_daycare_days >= 0);
  END IF;
END $$;

UPDATE public.package_definitions
SET complimentary_daycare_days = 2,
    updated_at = now()
WHERE code IN ('six_summer_splash_short', 'six_summer_splash_long')
  AND complimentary_daycare_days = 0;

-- service_credits.source_type is a check constraint. Add the complimentary value
-- without dropping the existing allowed values.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.service_credits'::regclass
      AND conname = 'service_credits_source_type_check'
      AND pg_get_constraintdef(oid) NOT ILIKE '%complimentary_daycare%'
  ) THEN
    ALTER TABLE public.service_credits DROP CONSTRAINT service_credits_source_type_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.service_credits'::regclass
      AND conname = 'service_credits_source_type_check'
  ) THEN
    ALTER TABLE public.service_credits
      ADD CONSTRAINT service_credits_source_type_check
      CHECK (source_type = ANY (ARRAY[
        'package_purchase'::text,
        'promotional'::text,
        'refund'::text,
        'long_stay_perk'::text,
        'complimentary_daycare'::text
      ]));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.grant_complimentary_daycare_on_package_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_days integer;
  v_issue date;
BEGIN
  IF NEW.source_type IS DISTINCT FROM 'package_purchase' OR NEW.purchase_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pd.complimentary_daycare_days, i.issue_date
    INTO v_days, v_issue
  FROM public.purchase_groups pg
  JOIN public.package_definitions pd ON pd.id = pg.package_def_id
  LEFT JOIN public.invoices i ON i.id = pg.invoice_id
  WHERE pg.id = NEW.purchase_group_id;

  IF coalesce(v_days, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Sold before this date keep the package they were sold with.
  IF coalesce(v_issue, CURRENT_DATE) < DATE '2026-11-24' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.service_credits sc
    WHERE sc.purchase_group_id = NEW.purchase_group_id
      AND sc.pet_id = NEW.pet_id
      AND sc.source_type = 'complimentary_daycare'
      AND sc.status <> 'revoked'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.service_credits (
    pet_id,
    service_code,
    units_total,
    units_consumed,
    expires_at,
    source_type,
    source_ref_id,
    purchase_group_id,
    is_bonus,
    status
  ) VALUES (
    NEW.pet_id,
    'daycare_full_day',
    v_days,
    0,
    NEW.expires_at,
    'complimentary_daycare',
    NEW.source_ref_id,
    NEW.purchase_group_id,
    true,
    'active'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_complimentary_daycare ON public.service_credits;
CREATE TRIGGER trg_grant_complimentary_daycare
  AFTER INSERT ON public.service_credits
  FOR EACH ROW
  EXECUTE FUNCTION public.grant_complimentary_daycare_on_package_sale();

CREATE OR REPLACE FUNCTION public.set_package_complimentary_daycare_days(
  p_package_def_id uuid,
  p_days integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_days integer;
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'set_package_complimentary_daycare_days requires authenticated user';
  END IF;

  IF p_days IS NULL OR p_days < 0 THEN
    RAISE EXCEPTION 'complimentary daycare days must be 0 or more';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.staff
    WHERE lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      AND role = 'admin'
      AND active
  ) THEN
    RAISE EXCEPTION 'Only an admin can change complimentary daycare days';
  END IF;

  UPDATE public.package_definitions
  SET complimentary_daycare_days = p_days,
      updated_at = now()
  WHERE id = p_package_def_id
  RETURNING complimentary_daycare_days INTO v_days;

  IF v_days IS NULL THEN
    RAISE EXCEPTION 'Package % not found', p_package_def_id;
  END IF;

  RETURN v_days;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_complimentary_daycare_on_package_sale() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_package_complimentary_daycare_days(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_package_complimentary_daycare_days(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_package_complimentary_daycare_days(uuid, integer) TO service_role;

-- Verification (safe to run after applying):
-- SELECT code, display_name, complimentary_daycare_days
-- FROM public.package_definitions
-- WHERE category = 'grooming'
-- ORDER BY sort_order;
--
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'public.service_credits'::regclass
--   AND conname = 'service_credits_source_type_check'
--   AND pg_get_constraintdef(oid) ILIKE '%complimentary_daycare%';
