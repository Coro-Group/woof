-- WOOF transport windows are exactly one hour (23 Nov 2026), as Petzania.
--
-- Staff book on the hour (AE's hour slots) or half past: 9:30–10:30 is booked in the
-- 9–10 slot with that one-hour window, sent to AE as the trip's custom window. The old
-- "flexible window" (any length ≥ 30 min) is gone; MSH keeps its wider windows in AE.
--
-- Regulars: pickup_window_* / dropoff_window_* are null or exactly 60 minutes.
-- Home-trip one-offs (purpose 'regular'): window_start_min / window_end_min are null or
-- exactly 60 minutes. Vet legs and branch moves keep their own windows.

ALTER TABLE public.transport_regular DROP CONSTRAINT IF EXISTS transport_regular_window_check;
ALTER TABLE public.transport_regular ADD CONSTRAINT transport_regular_window_check CHECK (
  ((pickup_window_start_min IS NULL AND pickup_window_end_min IS NULL)
    OR (pickup_window_start_min BETWEEN 0 AND 1380 AND pickup_window_end_min = pickup_window_start_min + 60))
  AND
  ((dropoff_window_start_min IS NULL AND dropoff_window_end_min IS NULL)
    OR (dropoff_window_start_min BETWEEN 0 AND 1380 AND dropoff_window_end_min = dropoff_window_start_min + 60))
);

ALTER TABLE public.transport_request DROP CONSTRAINT IF EXISTS transport_request_home_window_one_hour;
ALTER TABLE public.transport_request ADD CONSTRAINT transport_request_home_window_one_hour CHECK (
  purpose IS DISTINCT FROM 'regular'
  OR (window_start_min IS NULL AND window_end_min IS NULL)
  OR (window_start_min BETWEEN 0 AND 1379 AND window_end_min = window_start_min + 60)
);
