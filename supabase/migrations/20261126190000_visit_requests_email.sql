-- Website visit requests: keep the client's email (every request form now asks for it),
-- so staff can reply by email as well as WhatsApp or phone. Additive; old rows stay null.
-- No BEGIN/COMMIT.

ALTER TABLE public.visit_requests
  ADD COLUMN IF NOT EXISTS email text
  CHECK (email IS NULL OR (char_length(email) <= 150 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));

COMMENT ON COLUMN public.visit_requests.email IS 'Client email from the website form (lowercased). Null on requests sent before 26 Nov 2026.';
COMMENT ON COLUMN public.visit_requests.source IS 'website = the brand''s own page (its domain is in source_page); coro.ae = the coro.ae planner (/inquire).';

NOTIFY pgrst, 'reload schema';
