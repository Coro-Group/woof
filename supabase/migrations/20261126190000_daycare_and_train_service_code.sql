-- Daycare & Train. Run this file first and let it commit before
-- 20261126190100_daycare_and_train_rate.sql. Postgres cannot use a new
-- enum value in the same transaction that adds it.

DO $$ BEGIN
  ALTER TYPE public.service_code ADD VALUE 'daycare_and_train';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Verification:
-- SELECT e.enumlabel
-- FROM pg_enum e
-- JOIN pg_type t ON t.oid = e.enumtypid
-- WHERE t.typname = 'service_code'
--   AND e.enumlabel = 'daycare_and_train';
