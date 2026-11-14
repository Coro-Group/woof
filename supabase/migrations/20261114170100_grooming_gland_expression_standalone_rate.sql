-- Run only after 20261114170000_grooming_addon_service_codes.sql has committed.
-- Standalone Anal Gland Expression: service_code_meta + one active flat rate.
-- Ear cleaning, paw wash, and paw brushing get catalog rows only — no prices.
-- addon_glands (the with-grooming add-on) is left unchanged.

INSERT INTO public.service_code_meta (service_code, display_name, unit, applicable_species, description)
VALUES (
  'grooming_gland_expression',
  'Anal Gland Expression',
  'each',
  ARRAY['dog']::public.species[],
  'Standalone anal gland expression (not the grooming add-on)'
)
ON CONFLICT (service_code) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description
WHERE public.service_code_meta.display_name ILIKE '%expansion%';

INSERT INTO public.service_rates (service_code, amount_aed, is_active, notes)
SELECT
  'grooming_gland_expression'::public.service_code,
  52.50,
  true,
  'Standalone anal gland expression'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.service_rates sr
  WHERE sr.service_code = 'grooming_gland_expression'::public.service_code
    AND sr.is_active = true
    AND sr.pet_size IS NULL
    AND sr.coat_type IS NULL
    AND sr.season IS NULL
);

INSERT INTO public.service_code_meta (service_code, display_name, unit, applicable_species, description)
VALUES
  (
    'addon_ear_cleaning',
    'Ear cleaning',
    'each',
    ARRAY['dog']::public.species[],
    'Grooming add-on. Price comes from service_rates.'
  ),
  (
    'addon_paw_wash',
    'Paw wash',
    'each',
    ARRAY['dog']::public.species[],
    'Grooming add-on. Price comes from service_rates.'
  ),
  (
    'addon_paw_brushing',
    'Pawdicure / paw brushing',
    'each',
    ARRAY['dog']::public.species[],
    'Grooming add-on. Price comes from service_rates.'
  )
ON CONFLICT (service_code) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- Verification:
-- Expect grooming_gland_expression at 52.50, is_active true.
-- Expect addon_glands unchanged at 36.75.
-- Expect no service_rates rows for addon_ear_cleaning, addon_paw_wash, addon_paw_brushing.
SELECT service_code, amount_aed, is_active, pet_size, coat_type, season, notes
FROM public.service_rates
WHERE service_code IN (
  'grooming_gland_expression',
  'addon_glands',
  'addon_ear_cleaning',
  'addon_paw_wash',
  'addon_paw_brushing'
)
ORDER BY service_code, amount_aed;

SELECT service_code, display_name
FROM public.service_code_meta
WHERE service_code IN (
  'grooming_gland_expression',
  'addon_ear_cleaning',
  'addon_paw_wash',
  'addon_paw_brushing'
)
ORDER BY service_code;
