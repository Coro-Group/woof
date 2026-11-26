-- Publish visit_requests so staff alerts can update without waiting for the 30s poll.
-- Woof has no separate public booking or assessment table (park_bookings was removed).
-- A visit request is unhandled while status = 'new', so no reviewed_at column is added.
-- Existing rows are left as they are: only status 'new' alerts.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'visit_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.visit_requests;
  END IF;
END $$;

-- Verify:
-- SELECT pubname, schemaname, tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime' AND tablename = 'visit_requests';
