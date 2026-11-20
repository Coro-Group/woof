-- Add grooming_service.splash so New Appointment can book/consume Summer Splash
-- packages (service_code grooming_splash). Enum ADD VALUE must commit before use.

DO $$ BEGIN
  ALTER TYPE public.grooming_service ADD VALUE 'splash';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Durations aligned with full_bath (Bijoux-class visit length).
INSERT INTO public.grooming_service_durations (service, size, default_minutes) VALUES
  ('splash', 'small', 30),
  ('splash', 'medium', 45),
  ('splash', 'large', 60)
ON CONFLICT (service, size) DO NOTHING;

-- Verification (paste after apply):
SELECT e.enumlabel
FROM pg_enum e
JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'grooming_service'
  AND e.enumlabel = 'splash';

SELECT service, size, default_minutes
FROM public.grooming_service_durations
WHERE service = 'splash'
ORDER BY size;
