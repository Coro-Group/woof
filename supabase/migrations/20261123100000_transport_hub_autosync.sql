-- Automatic sync to the transport hub (AE's Desk and Master).
--
-- Every change that moves a dog's transport kicks /api/transport-hub (op "auto") from
-- the database, so an approved request is on AE's Master board seconds later. No one
-- has to press "Sync now" any more (the button stays, for a sync on demand).
--
-- How it works:
--   * transport_hub_autosync is one row. Each kick adds one to `generation` (a row
--     lock held until the writer commits, so a sync that starts afterwards sees the
--     change) and, unless a sync is running or a kick is already on its way, posts to
--     the app's own endpoint through pg_net. The post leaves only after the commit.
--   * The endpoint claims the row (transport_hub_autosync_claim), syncs, and reports
--     (transport_hub_autosync_finish). If more changes came in while it ran, it goes
--     again straight away. One sync at a time, so an older picture never overwrites
--     a newer one on AE.
--   * pg_cron retries every 10 minutes when the last changes have not reached AE
--     (AE down, network), and runs once a night so the 8-week window moves on.
--   * The endpoint address and its token live in Vault (transport_hub_auto_url,
--     transport_hub_auto_secret). Without them nothing is posted. The token is made
--     here and never leaves the database: the endpoint passes the one it was given
--     back to claim/finish, which compare it.
--
-- What kicks: transport requests (and their dogs), regulars, vet visits, boarding
-- stays (dates, status, pickup / drop-off), their dogs, daycare days with a pickup or
-- drop-off, a dog's Voltlines link or name, and the owner's home pin or name.
-- Idempotent.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.transport_hub_autosync (
  id int primary key default 1 check (id = 1),
  generation bigint not null default 0,
  synced_generation bigint not null default 0,
  kicked_at timestamptz,
  running_until timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_ok_at timestamptz,
  last_result jsonb,
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.transport_hub_autosync (id) values (1) on conflict (id) do nothing;

alter table public.transport_hub_autosync enable row level security;
drop policy if exists transport_hub_autosync_read on public.transport_hub_autosync;
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'is_staff') then
    execute 'create policy transport_hub_autosync_read on public.transport_hub_autosync
             for select to authenticated using (public.is_staff())';
  else
    execute 'create policy transport_hub_autosync_read on public.transport_hub_autosync
             for select to authenticated using ((select auth.uid()) is not null)';
  end if;
end $$;
revoke insert, update, delete on public.transport_hub_autosync from anon, authenticated;

-- One kick. p_count = false re-kicks without counting a new change (the retry).
create or replace function public.transport_hub_autosync_kick(p_count boolean default true)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v public.transport_hub_autosync;
  v_url text;
  v_token text;
begin
  update public.transport_hub_autosync
     set generation = generation + case when p_count then 1 else 0 end,
         updated_at = now()
   where id = 1
  returning * into v;
  if not found then return; end if;

  -- A sync is running: it sees the new generation when it finishes and goes again.
  if v.running_until is not null and v.running_until > now() then return; end if;
  -- A kick is already on its way and nobody has picked it up yet.
  if v.kicked_at is not null and v.kicked_at > now() - interval '30 seconds'
     and (v.last_started_at is null or v.kicked_at > v.last_started_at) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'transport_hub_auto_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'transport_hub_auto_secret';
  if v_url is null or v_token is null then return; end if;

  update public.transport_hub_autosync set kicked_at = now() where id = 1;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('op', 'auto', 'token', v_token),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 120000
  );
end;
$$;

create or replace function public.transport_hub_autosync_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.transport_hub_autosync_kick();
  return null;
end;
$$;

-- Row trigger: an insert or delete always kicks; an update kicks only when one of the
-- columns named in the trigger arguments changed.
create or replace function public.transport_hub_autosync_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n jsonb;
  o jsonb;
  i int;
begin
  if tg_op = 'UPDATE' then
    n := to_jsonb(new);
    o := to_jsonb(old);
    for i in 0 .. tg_nargs - 1 loop
      if n -> tg_argv[i] is distinct from o -> tg_argv[i] then
        perform public.transport_hub_autosync_kick();
        return null;
      end if;
    end loop;
    return null;
  end if;
  perform public.transport_hub_autosync_kick();
  return null;
end;
$$;

create or replace function public.transport_hub_autosync_claim(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_gen bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'transport_hub_auto_secret';
  if v_token is null or p_token is distinct from v_token then
    return jsonb_build_object('ok', false, 'reason', 'bad token');
  end if;
  update public.transport_hub_autosync
     set running_until = now() + interval '4 minutes',
         last_started_at = now(),
         updated_at = now()
   where id = 1 and (running_until is null or running_until < now())
  returning generation into v_gen;
  if v_gen is null then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  return jsonb_build_object('ok', true, 'generation', v_gen);
end;
$$;

-- p_continue = false releases the row even if more changes came in (the cron picks
-- them up), so one call never loops for ever.
create or replace function public.transport_hub_autosync_finish(
  p_token text,
  p_generation bigint,
  p_result jsonb,
  p_error text,
  p_continue boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_again boolean;
  v_gen bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'transport_hub_auto_secret';
  if v_token is null or p_token is distinct from v_token then
    return jsonb_build_object('ok', false, 'reason', 'bad token');
  end if;
  update public.transport_hub_autosync
     set synced_generation = case when p_error is null then greatest(synced_generation, p_generation) else synced_generation end,
         last_finished_at = now(),
         last_ok_at = case when p_error is null then now() else last_ok_at end,
         last_result = coalesce(p_result, last_result),
         last_error = p_error,
         running_until = case when p_error is null and p_continue and generation > p_generation
                              then now() + interval '4 minutes' else null end,
         last_started_at = case when p_error is null and p_continue and generation > p_generation
                                then now() else last_started_at end,
         updated_at = now()
   where id = 1
  returning (p_error is null and p_continue and generation > p_generation), generation into v_again, v_gen;
  return jsonb_build_object('ok', true, 'again', coalesce(v_again, false), 'generation', v_gen);
end;
$$;

-- The cron: retry when the last changes have not reached AE; p_roll for the nightly run.
create or replace function public.transport_hub_autosync_tick(p_roll boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.transport_hub_autosync;
begin
  select * into v from public.transport_hub_autosync where id = 1;
  if not found then return; end if;
  if p_roll then
    perform public.transport_hub_autosync_kick(true);
  elsif v.generation > v.synced_generation then
    perform public.transport_hub_autosync_kick(false);
  end if;
end;
$$;

revoke all on function public.transport_hub_autosync_kick(boolean) from public, anon, authenticated;
revoke all on function public.transport_hub_autosync_stmt() from public, anon, authenticated;
revoke all on function public.transport_hub_autosync_row() from public, anon, authenticated;
revoke all on function public.transport_hub_autosync_tick(boolean) from public, anon, authenticated;
revoke all on function public.transport_hub_autosync_claim(text) from public, anon, authenticated;
revoke all on function public.transport_hub_autosync_finish(text, bigint, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.transport_hub_autosync_claim(text) to service_role;
grant execute on function public.transport_hub_autosync_finish(text, bigint, jsonb, text, boolean) to service_role;

-- Triggers.
do $$
declare
  t text;
begin
  foreach t in array array['transport_request', 'transport_request_pet', 'transport_regular', 'transport_vet_visit', 'booking_pets'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_transport_hub_autosync on public.%I', t);
      execute format('create trigger zz_transport_hub_autosync after insert or update or delete on public.%I
                      for each statement execute function public.transport_hub_autosync_stmt()', t);
    end if;
  end loop;
end $$;

drop trigger if exists zz_transport_hub_autosync_ins on public.bookings;
drop trigger if exists zz_transport_hub_autosync_del on public.bookings;
drop trigger if exists zz_transport_hub_autosync_upd on public.bookings;
create trigger zz_transport_hub_autosync_ins after insert on public.bookings
  for each row execute function public.transport_hub_autosync_row();
create trigger zz_transport_hub_autosync_del after delete on public.bookings
  for each row execute function public.transport_hub_autosync_row();
create trigger zz_transport_hub_autosync_upd after update on public.bookings
  for each row execute function public.transport_hub_autosync_row(
    'status', 'check_in_date', 'check_out_date', 'pickup_required', 'dropoff_required', 'branch_id', 'booking_type', 'owner_id');

drop trigger if exists zz_transport_hub_autosync_ins on public.daycare_sessions;
drop trigger if exists zz_transport_hub_autosync_del on public.daycare_sessions;
drop trigger if exists zz_transport_hub_autosync_upd on public.daycare_sessions;
create trigger zz_transport_hub_autosync_ins after insert on public.daycare_sessions
  for each row when (new.pickup_used or new.dropoff_used) execute function public.transport_hub_autosync_row();
create trigger zz_transport_hub_autosync_del after delete on public.daycare_sessions
  for each row when (old.pickup_used or old.dropoff_used) execute function public.transport_hub_autosync_row();
create trigger zz_transport_hub_autosync_upd after update on public.daycare_sessions
  for each row execute function public.transport_hub_autosync_row(
    'pickup_used', 'dropoff_used', 'session_date', 'branch_id', 'pet_id', 'owner_id');

drop trigger if exists zz_transport_hub_autosync_upd on public.pets;
create trigger zz_transport_hub_autosync_upd after update on public.pets
  for each row execute function public.transport_hub_autosync_row('voltlines_passenger_id', 'name', 'owner_id');

drop trigger if exists zz_transport_hub_autosync_upd on public.owners;
create trigger zz_transport_hub_autosync_upd after update on public.owners
  for each row execute function public.transport_hub_autosync_row('pin_lat', 'pin_lng', 'first_name', 'last_name');

-- transport_day_demand gates on the signed-in staff member; the automatic sync reads it
-- with the service role. Patched in place from the live definition (it is long and
-- carries earlier in-place fixes), so only the gate changes.
do $$
declare
  d text;
begin
  select pg_get_functiondef('public.transport_day_demand(date, uuid)'::regprocedure) into d;
  if position('service_role' in d) = 0 then
    d := replace(d, 'where public.is_staff()',
                    'where (public.is_staff() or (select auth.role()) = ''service_role'')');
    d := replace(d, 'where (select auth.uid()) is not null',
                    'where ((select auth.uid()) is not null or (select auth.role()) = ''service_role'')');
    if position('service_role' in d) = 0 then
      raise exception 'transport_day_demand: the staff gate was not found, so it was not patched';
    end if;
    execute d;
  end if;
end $$;

-- The token is made here and stays in the database.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'transport_hub_auto_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'transport_hub_auto_secret',
                                'Token pg_net sends to /api/transport-hub op auto; checked by transport_hub_autosync_claim/finish');
  end if;
end $$;

-- Cron: retry every 10 minutes, and once a night (00:05 Dubai) so the window moves on.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('transport-hub-autosync-retry', 'transport-hub-autosync-nightly');
  perform cron.schedule('transport-hub-autosync-retry', '*/10 * * * *', 'select public.transport_hub_autosync_tick(false)');
  perform cron.schedule('transport-hub-autosync-nightly', '5 20 * * *', 'select public.transport_hub_autosync_tick(true)');
end $$;

-- The endpoint address is set per project (Vault secret transport_hub_auto_url):
--   select vault.create_secret('https://<app>/api/transport-hub', 'transport_hub_auto_url');
-- Until it is set, kicks are counted but nothing is posted.

-- New RPCs (claim / finish): PostgREST serves them only after a schema reload.
notify pgrst, 'reload schema';
