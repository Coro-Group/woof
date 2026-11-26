-- Run only after 20261126190000_daycare_and_train_service_code.sql has committed.
-- AED 155.00 per dog per day, VAT-inclusive (service_code_meta.vat_included),
-- the same gross handling as daycare_full_day and daycare_hourly.

INSERT INTO public.service_code_meta (
  service_code,
  display_name,
  unit,
  applicable_species,
  vat_included,
  description
)
VALUES (
  'daycare_and_train',
  'Daycare & Train',
  'per_day',
  ARRAY['dog']::public.species[],
  true,
  'Daycare with training. Amount is VAT-inclusive, same as the other daycare day rates.'
)
ON CONFLICT (service_code) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  unit = EXCLUDED.unit,
  vat_included = EXCLUDED.vat_included,
  description = EXCLUDED.description;

INSERT INTO public.service_rates (service_code, amount_aed, is_active, notes)
SELECT
  'daycare_and_train'::public.service_code,
  155.00,
  true,
  'Daycare & Train per dog per day, VAT-inclusive'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.service_rates sr
  WHERE sr.service_code = 'daycare_and_train'::public.service_code
    AND sr.is_active = true
    AND sr.pet_size IS NULL
    AND sr.coat_type IS NULL
    AND sr.season IS NULL
);

DO $$
BEGIN
  IF to_regclass('public.pricing') IS NOT NULL THEN
    INSERT INTO public.pricing (key, amount_aed, label, category)
    VALUES ('daycare_and_train', 155.00, 'Daycare & Train', 'daycare')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;

-- Verification: one active flat rate at 155.00, VAT included.
SELECT service_code, display_name, unit, vat_included
FROM public.service_code_meta
WHERE service_code = 'daycare_and_train';

SELECT service_code, amount_aed, is_active, pet_size, coat_type, season
FROM public.service_rates
WHERE service_code = 'daycare_and_train'
ORDER BY is_active DESC, amount_aed;

SELECT key, amount_aed, label, category
FROM public.pricing
WHERE key = 'daycare_and_train';
