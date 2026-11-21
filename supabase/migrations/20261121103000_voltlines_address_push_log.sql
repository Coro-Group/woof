-- Every Woof address / pin sent to Voltlines, with what Voltlines had before
-- (21 Nov 2026). Written by api/transport-voltlines.js ops "push_home" and
-- "push_owner_home" (service role) before and after each PATCH, so any push can be
-- read back and undone by hand.
--
-- Ported from Petzania (20261119073511_voltlines_address_push_log.sql) with Woof's
-- RLS: there is no public.is_staff() here. Server-written, staff-readable.

create table if not exists public.voltlines_address_push_log (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid references public.pets(id) on delete set null,
  owner_id uuid references public.owners(id) on delete set null,
  passenger_id text not null,
  address_id text,
  before_line text,
  before_lat double precision,
  before_lng double precision,
  after_line text,
  after_lat double precision,
  after_lng double precision,
  branch_address_id text,
  branch_before_line text,
  branch_before_lat double precision,
  branch_before_lng double precision,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  error text,
  pushed_by text,
  pushed_at timestamptz not null default now()
);

create index if not exists voltlines_address_push_log_passenger_idx
  on public.voltlines_address_push_log (passenger_id, pushed_at desc);

alter table public.voltlines_address_push_log enable row level security;

drop policy if exists voltlines_address_push_log_staff_read on public.voltlines_address_push_log;
create policy voltlines_address_push_log_staff_read on public.voltlines_address_push_log
  for select to authenticated using ((select auth.role()) = 'authenticated');

grant select on public.voltlines_address_push_log to authenticated;
revoke insert, update, delete, truncate on public.voltlines_address_push_log from authenticated;
revoke all on public.voltlines_address_push_log from anon;

comment on table public.voltlines_address_push_log is
  'Woof addresses/pins pushed to Voltlines with the values they replaced. Server-written.';

notify pgrst, 'reload schema';
