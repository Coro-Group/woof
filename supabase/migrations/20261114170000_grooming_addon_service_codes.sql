-- Grooming booking service codes.
-- Enum additions are their own migration so they commit before the next
-- migration inserts a rate that uses them. Idempotent: duplicate_object is a no-op.
-- Live already has grooming_service.gland_expression; this keeps the repo in sync.

DO $$ BEGIN
  ALTER TYPE public.grooming_service ADD VALUE 'gland_expression';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.service_code ADD VALUE 'grooming_gland_expression';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.service_code ADD VALUE 'addon_ear_cleaning';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.service_code ADD VALUE 'addon_paw_wash';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.service_code ADD VALUE 'addon_paw_brushing';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Verification (paste after this file commits, before the rate migration):
SELECT t.typname, e.enumlabel
FROM pg_enum e
JOIN pg_type t ON e.enumtypid = t.oid
WHERE (t.typname = 'grooming_service' AND e.enumlabel = 'gland_expression')
   OR (t.typname = 'service_code' AND e.enumlabel IN (
        'grooming_gland_expression',
        'addon_ear_cleaning',
        'addon_paw_wash',
        'addon_paw_brushing'
      ))
ORDER BY t.typname, e.enumlabel;
