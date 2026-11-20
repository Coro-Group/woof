-- Offers and promises on transport requests — AE's offer / accept flow, in Woof.
--
-- AE: a request is recorded, staff press Offer (the transport hub quotes the hour asked
-- for and the hours either side), the request becomes "offered" with its options stored,
-- and Accept records the promise against the person: the hour, the window and when the
-- van collects. Woof now does the same (src/components/transport/OfferPanel.tsx,
-- RequestDetailSheet.tsx), with the quote from AE's /api/transport-partner.
--
--   * transport_request.status gains 'offered' — open, like 'received'.
--   * The promise: promised_slot_id, promised_window_start/end_min, promised_eta_min,
--     accepted_offer_id; and who offered (offered_by / offered_at).
--   * transport_request_offer — the options a quote produced for one request row,
--     with declined_by_client / chosen_by_staff (AE's transport_offer).
--   * transport_day_demand and transport_request_decide treat 'offered' as open, as
--     they do 'received'. Both are rebuilt from their LIVE definitions (CLAUDE.md), the
--     one line changed, and the migration stops if that line is not found.
--
-- Ported from petzania/supabase/migrations/20261120090000_transport_request_offers.sql.
-- Woof's RLS is role-based ((select auth.role()) = 'authenticated'), not petzania's
-- is_staff(), so the policy below matches the other transport tables here.
--
-- Additive and idempotent.

alter table public.transport_request drop constraint if exists transport_request_promised_slot_id_fkey;

alter table public.transport_request drop constraint if exists transport_request_status_check;
alter table public.transport_request
  add constraint transport_request_status_check
  check (status = any (array['received'::text, 'offered'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]));

alter table public.transport_request
  add column if not exists offered_by text,
  add column if not exists offered_at timestamptz,
  add column if not exists accepted_offer_id uuid,
  -- No foreign key: a second one to transport_slots makes the app's embedded
  -- transport_slots(...) select ambiguous (PostgREST PGRST201).
  add column if not exists promised_slot_id uuid,
  add column if not exists promised_window_start_min integer,
  add column if not exists promised_window_end_min integer,
  add column if not exists promised_eta_min integer;

comment on column public.transport_request.promised_eta_min is
  'When the van collects / delivers, minutes after midnight, from the accepted hub offer (AE "collected around HH:MM").';

create table if not exists public.transport_request_offer (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.transport_request(id) on delete cascade,
  rank integer not null,
  outcome text,
  reason text,
  slot_start_min integer,
  slot_label text,
  promised_slot_label text,
  outside_windows boolean not null default false,
  shift_hours integer not null default 0,
  eta_min integer,
  added_km numeric,
  added_minutes numeric,
  displaces integer not null default 0,
  recommended boolean not null default false,
  basis text,
  declined_by_client boolean not null default false,
  chosen_by_staff boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists transport_request_offer_request_idx on public.transport_request_offer (request_id);

comment on table public.transport_request_offer is
  'Options the transport hub (AE) offered for one request row — AE''s transport_offer. Accepting one records the promise on the request.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transport_request_accepted_offer_fkey'
  ) then
    alter table public.transport_request
      add constraint transport_request_accepted_offer_fkey
      foreign key (accepted_offer_id) references public.transport_request_offer(id) on delete set null;
  end if;
end $$;

alter table public.transport_request_offer enable row level security;

drop policy if exists transport_request_offer_staff on public.transport_request_offer;
create policy transport_request_offer_staff on public.transport_request_offer
  for all to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

grant select, insert, update, delete on public.transport_request_offer to authenticated;

-- 'offered' is open, like 'received': rebuilt from the live definitions.
do $$
declare
  src text;
  old_line text := $q$r.status in ('received', 'approved')$q$;
  new_line text := $q$r.status in ('received', 'offered', 'approved')$q$;
begin
  src := pg_get_functiondef('public.transport_day_demand(date, uuid)'::regprocedure);
  if position(new_line in src) = 0 then
    if position(old_line in src) = 0 then
      raise exception 'transport_day_demand: the request status line was not found — rebuild by hand';
    end if;
    execute replace(src, old_line, new_line);
  end if;
end $$;

do $$
declare
  fn regprocedure;
  src text;
  old_line text := $q$status = 'received' for update$q$;
  new_line text := $q$status in ('received', 'offered') for update$q$;
begin
  select p.oid::regprocedure into fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'transport_request_decide' limit 1;
  src := pg_get_functiondef(fn);
  if position(new_line in src) = 0 then
    if position(old_line in src) = 0 then
      raise exception 'transport_request_decide: the open-status line was not found — rebuild by hand';
    end if;
    execute replace(src, old_line, new_line);
  end if;
end $$;
