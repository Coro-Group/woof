-- Visit requests from the Woof website ("Request a visit" on the Coro Campus – Woof
-- landing page at woofdubai.ae). The website posts to /api/visit-request, which saves
-- the row with the service role; staff see the list on /visit-requests and reach the
-- client on WhatsApp or by phone. Same shape as admin-essentials' visit_requests,
-- without branches: Woof is one campus.

CREATE TABLE IF NOT EXISTS public.visit_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_name  text NOT NULL CHECK (char_length(contact_name) BETWEEN 2 AND 100),
  phone         text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  pet_name      text CHECK (pet_name IS NULL OR char_length(pet_name) BETWEEN 1 AND 100),
  interest      text CHECK (interest IS NULL OR interest IN ('daycare', 'boarding', 'training', 'grooming', 'transport')),
  client_note   text CHECK (client_note IS NULL OR char_length(client_note) <= 1000),
  source        text NOT NULL DEFAULT 'website',
  source_page   text CHECK (source_page IS NULL OR char_length(source_page) <= 300),
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'booked', 'closed')),
  staff_note    text CHECK (staff_note IS NULL OR char_length(staff_note) <= 1000),
  handled_by    uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  contacted_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.visit_requests IS 'Website "Request a visit" submissions from woofdubai.ae. Inserted only by /api/visit-request (service role).';
COMMENT ON COLUMN public.visit_requests.status IS 'new = not yet reached; contacted = team reached out; booked = assessment and daycare trial arranged; closed = no further action.';

CREATE INDEX IF NOT EXISTS visit_requests_status_idx ON public.visit_requests (status, created_at DESC);
-- The endpoint counts recent requests per number to slow down repeat submissions.
CREATE INDEX IF NOT EXISTS visit_requests_phone_idx ON public.visit_requests (phone, created_at DESC);

CREATE OR REPLACE FUNCTION public.visit_requests_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'new' AND NEW.contacted_at IS NULL THEN
    NEW.contacted_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS visit_requests_touch ON public.visit_requests;
CREATE TRIGGER visit_requests_touch
  BEFORE UPDATE ON public.visit_requests
  FOR EACH ROW EXECUTE FUNCTION public.visit_requests_touch();

ALTER TABLE public.visit_requests ENABLE ROW LEVEL SECURITY;

-- Same rule as the rest of Woof: signed-in staff see and work the list.
DROP POLICY IF EXISTS visit_requests_staff_select ON public.visit_requests;
CREATE POLICY visit_requests_staff_select ON public.visit_requests FOR SELECT TO authenticated
  USING ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS visit_requests_staff_update ON public.visit_requests;
CREATE POLICY visit_requests_staff_update ON public.visit_requests FOR UPDATE TO authenticated
  USING ((SELECT auth.role()) = 'authenticated')
  WITH CHECK ((SELECT auth.role()) = 'authenticated');

-- The website fields stay as submitted: staff may only change the follow-up columns.
REVOKE ALL ON TABLE public.visit_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.visit_requests TO authenticated;
GRANT UPDATE (status, staff_note, handled_by) ON TABLE public.visit_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.visit_requests TO service_role;

-- Reload PostgREST's schema cache so the new table is visible at once.
NOTIFY pgrst, 'reload schema';

-- Verify:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'visit_requests' ORDER BY ordinal_position;
