-- A read-only copy of the Voltlines passenger directory (21 Nov 2026).
--
-- Ported from Petzania (20261113094301_voltlines_passenger_directory.sql), with
-- Woof's RLS: Woof has no public.is_staff(), it gates on the authenticated role
-- the way every other transport table here does.
--
-- Matching hundreds of Woof dogs to Voltlines passengers one search at a time
-- would be hundreds of reads against an account MSH dispatch shares. Instead the
-- directory is read once, page by page (api/transport-voltlines.js op
-- "directory_sync"), and compared here. Only the server (service role) writes it;
-- staff read it. Nothing is ever written to Voltlines.

create table if not exists public.voltlines_passenger_directory (
  passenger_id text primary key,
  first_name text,
  last_name text,
  full_name text,
  phone text,
  status text,
  branch_id text,
  customer_id text,
  home_address_id text,
  address_line text,
  lat double precision,
  lng double precision,
  branch_address_id text,
  branch_address_line text,
  raw_tags text[],
  fetched_at timestamptz not null default now()
);

create index if not exists voltlines_passenger_directory_first_name_idx
  on public.voltlines_passenger_directory (lower(first_name));

alter table public.voltlines_passenger_directory enable row level security;

drop policy if exists voltlines_passenger_directory_staff_read on public.voltlines_passenger_directory;
create policy voltlines_passenger_directory_staff_read on public.voltlines_passenger_directory
  for select to authenticated using ((select auth.role()) = 'authenticated');

grant select on public.voltlines_passenger_directory to authenticated;

comment on table public.voltlines_passenger_directory is
  'Read-only copy of the Voltlines passenger list, refreshed by an admin from Transport. Server-written.';

notify pgrst, 'reload schema';

-- The table is server-written. A blanket grant earlier in this schema had handed
-- authenticated insert/update/delete; RLS already refused them (there is only a
-- select policy), but the grant should not say otherwise.
revoke insert, update, delete, truncate on public.voltlines_passenger_directory from authenticated;
revoke insert, update, delete, truncate on public.voltlines_passenger_directory from anon;
revoke all on public.voltlines_passenger_directory from anon;
notify pgrst, 'reload schema';
