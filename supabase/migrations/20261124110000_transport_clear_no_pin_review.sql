-- Clear a stale "No home pin" review flag once the client has a home pin.
--
-- A request made before the client had a pin is saved with needs_review = true and
-- review_reason "No home pin — the van can't be routed". Nothing used to clear that when
-- the pin was saved later, so the request kept showing the warning. Pins are written from
-- several places (client profile, hub link, Voltlines adopt, transport profile step), so
-- this lives in the database and covers all of them.
--
-- It only clears the flag this app writes for a missing pin (review_reason 'No home pin%')
-- on open requests (received / offered). Other review flags (vet, manual) are untouched.
-- It never blocks or changes status: approve and offer were never gated on the flag.
-- Idempotent.

create or replace function public.transport_clear_no_pin_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pin_lat is not null and new.pin_lng is not null
     and (old.pin_lat is distinct from new.pin_lat or old.pin_lng is distinct from new.pin_lng) then
    update public.transport_request
       set needs_review = false,
           review_reason = null
     where owner_id = new.id
       and needs_review
       and review_reason like 'No home pin%'
       and status in ('received', 'offered');
  end if;
  return new;
end;
$$;

revoke all on function public.transport_clear_no_pin_review() from public, anon, authenticated;

drop trigger if exists transport_clear_no_pin_review on public.owners;
create trigger transport_clear_no_pin_review
  after update of pin_lat, pin_lng on public.owners
  for each row execute function public.transport_clear_no_pin_review();

-- One-time backfill: clear the flags already stuck on requests whose client now has a pin.
update public.transport_request r
   set needs_review = false,
       review_reason = null
  from public.owners o
 where o.id = r.owner_id
   and o.pin_lat is not null
   and o.pin_lng is not null
   and r.needs_review
   and r.review_reason like 'No home pin%'
   and r.status in ('received', 'offered');

-- Verification (paste into the Supabase SQL editor):
-- select
--   (select count(*) from pg_trigger
--     where tgname = 'transport_clear_no_pin_review' and tgrelid = 'public.owners'::regclass and not tgisinternal) as trigger_installed,
--   (select count(*) from public.transport_request r
--     join public.owners o on o.id = r.owner_id
--     where r.needs_review and r.review_reason like 'No home pin%'
--       and o.pin_lat is not null and o.pin_lng is not null
--       and r.status in ('received', 'offered')) as stale_flags_left;
-- Expect trigger_installed = 1 and stale_flags_left = 0.
