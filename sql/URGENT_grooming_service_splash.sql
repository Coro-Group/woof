-- URGENT: Add grooming_service.splash for Summer Splash New Appointment bookings.
-- Paste into Supabase SQL editor (project wineliuwejkxwsdbrthb).
-- Source: supabase/migrations/20260829160000_grooming_service_splash.sql
--
-- Enum ADD VALUE must run (and commit) before the Vite app saves appointments
-- with service = 'splash'. Rates for service_code grooming_splash already exist.

DO $$ BEGIN
  ALTER TYPE public.grooming_service ADD VALUE 'splash';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO public.grooming_service_durations (service, size, default_minutes) VALUES
  ('splash', 'small', 30),
  ('splash', 'medium', 45),
  ('splash', 'large', 60)
ON CONFLICT (service, size) DO NOTHING;

-- Verification
SELECT e.enumlabel
FROM pg_enum e
JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'grooming_service'
  AND e.enumlabel = 'splash';

SELECT service, size, default_minutes
FROM public.grooming_service_durations
WHERE service = 'splash'
ORDER BY size;

-- Lotus / Tamima: confirm Splash credit exists for New Appointment matching
-- SELECT sc.service_code, sc.units_total, sc.units_consumed, pd.display_name, p.name
-- FROM service_credits sc
-- JOIN pets p ON p.id = sc.pet_id
-- JOIN owners o ON o.id = p.owner_id
-- LEFT JOIN purchase_groups pg ON pg.id = sc.purchase_group_id
-- LEFT JOIN package_definitions pd ON pd.id = pg.package_def_id
-- WHERE o.first_name ILIKE 'Tamima%' AND p.name ILIKE 'Lotus%'
--   AND sc.service_code = 'grooming_splash';
