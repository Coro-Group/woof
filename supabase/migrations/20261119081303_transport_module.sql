-- Transport reception tab (Petzania step 1, one Woof facility).
--
-- Dispatch, vans and Voltlines stay in admin-essentials. This records Woof's own
-- demand: requests, regulars, vet visits, and the day board built from those plus
-- daycare pickup/drop-off and boarding check-in/check-out flags.
-- hub_request_id / hub_rule_id stay null until a later step pushes rows to the hub.
--
-- Idempotent. Woof has no branches table and no is_staff(); RLS matches bookings
-- (authenticated). Booking statuses are the live enum (no in_progress).

-- ── One facility, so the ported branch_id shape stays intact ──

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  short_name text not null,
  created_at timestamptz not null default now(),
  constraint branches_code_key unique (code)
);

comment on table public.branches is
  'Facilities. Woof has one row (Al Quoz) so transport rows keep a branch_id for a later hub push.';

insert into public.branches (code, name, short_name)
values ('woof', 'Woof Al Quoz', 'Woof')
on conflict (code) do update set name = excluded.name, short_name = excluded.short_name;

alter table public.branches enable row level security;
drop policy if exists branches_staff on public.branches;
create policy branches_staff on public.branches
  for all to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- ── Household pin and driver note (vans route to the pin, not the typed address) ──

alter table public.owners add column if not exists pin_lat double precision;
alter table public.owners add column if not exists pin_lng double precision;
alter table public.owners add column if not exists pin_source text;
alter table public.owners add column if not exists pin_updated_at timestamptz;
alter table public.owners add column if not exists transport_notes text;
alter table public.owners add column if not exists voltlines_customer_id text;
alter table public.owners add column if not exists voltlines_branch_id text;

comment on column public.owners.pin_lat is
  'Household home pin (from a dropped Google Maps pin, never geocoded). Vans route to this, not to address.';
comment on column public.owners.transport_notes is
  'Household standing instruction for drivers. Shown on every transport board for the household.';
comment on column public.owners.voltlines_customer_id is
  'Voltlines customer (household). Empty until Woof joins the admin-essentials hub.';

alter table public.pets add column if not exists driver_note text;
alter table public.pets add column if not exists driver_note_source text;
alter table public.pets add column if not exists driver_note_updated_at timestamptz;
alter table public.pets add column if not exists voltlines_passenger_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pets_driver_note_source_check') then
    alter table public.pets add constraint pets_driver_note_source_check
      check (driver_note_source is null or driver_note_source in ('staff', 'auto'));
  end if;
end $$;

comment on column public.pets.driver_note is
  'What the driver needs to know about this dog. Staff-written; the hub may fill it later.';
comment on column public.pets.voltlines_passenger_id is
  'Voltlines passenger for this dog. Empty until Woof joins the hub.';

create unique index if not exists pets_voltlines_passenger_id_key
  on public.pets (voltlines_passenger_id) where voltlines_passenger_id is not null;

alter table public.vet_clinics add column if not exists address_label text;
alter table public.vet_clinics add column if not exists lat double precision;
alter table public.vet_clinics add column if not exists lng double precision;
alter table public.vet_clinics add column if not exists maps_link text;
alter table public.vet_clinics add column if not exists location_source text;

comment on column public.vet_clinics.lat is
  'Clinic pin for transport, read from a dropped Google Maps pin (never geocoded).';

-- ── Hour slots (same catalogue as admin-essentials: 06-07AM … 8-9PM) ──

create table if not exists public.transport_slots (
  id uuid primary key default gen_random_uuid(),
  direction text not null,
  label text not null,
  start_min integer not null,
  end_min integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint transport_slots_direction_check check (direction in ('pickup', 'dropoff')),
  constraint transport_slots_window_check check (end_min > start_min),
  constraint transport_slots_unique unique (direction, start_min, end_min)
);

insert into public.transport_slots (direction, label, start_min, end_min)
select d.dir,
       case
         when h < 10 then lpad(h::text, 2, '0') || '-' || lpad((h + 1)::text, 2, '0') || 'AM'
         when h = 10 then '10-11AM'
         when h = 11 then '11-12PM'
         when h = 12 then '12-1PM'
         else (h - 12)::text || '-' || (h - 11)::text || 'PM'
       end,
       h * 60, (h + 1) * 60
from generate_series(6, 20) as h
cross join (values ('pickup'), ('dropoff')) as d(dir)
on conflict (direction, start_min, end_min) do nothing;

alter table public.transport_slots enable row level security;
drop policy if exists transport_slots_staff on public.transport_slots;
create policy transport_slots_staff on public.transport_slots
  for all to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- ── Requests ──

create table if not exists public.transport_request (
  id uuid primary key default gen_random_uuid(),
  brand text not null default 'WOOF',
  branch_id uuid not null references public.branches(id),
  owner_id uuid not null references public.owners(id) on delete cascade,
  kind text not null default 'one_off',
  direction text not null,
  service_date date,
  status text not null default 'received',
  location_text text,
  location_lat double precision,
  location_lng double precision,
  notes text,
  created_by text,
  hub_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  group_id uuid not null default gen_random_uuid(),
  cadence text,
  weekday smallint,
  starts_on date,
  ends_on date,
  paused_from date,
  paused_until date,
  requested_slot_id uuid references public.transport_slots(id) on delete set null,
  rejection_reason text,
  decided_by text,
  decided_at timestamptz,
  updated_by text,
  applied_regular_ids uuid[],
  purpose text not null default 'regular',
  vet_visit_id uuid,
  deadline_min integer,
  window_start_min integer,
  window_end_min integer,
  from_date date,
  needs_review boolean not null default false,
  review_reason text,
  transfer_from_branch_id uuid references public.branches(id),
  transfer_to_branch_id uuid references public.branches(id)
);

alter table public.transport_request drop constraint if exists transport_request_brand_check;
alter table public.transport_request add constraint transport_request_brand_check check (brand = 'WOOF');
alter table public.transport_request drop constraint if exists transport_request_kind_check;
alter table public.transport_request add constraint transport_request_kind_check
  check (kind in ('one_off', 'new_recurring', 'cancel', 'pause', 'change'));
alter table public.transport_request drop constraint if exists transport_request_direction_check;
alter table public.transport_request add constraint transport_request_direction_check
  check (direction in ('pickup', 'dropoff'));
alter table public.transport_request drop constraint if exists transport_request_status_check;
alter table public.transport_request add constraint transport_request_status_check
  check (status in ('received', 'approved', 'rejected', 'cancelled'));
alter table public.transport_request drop constraint if exists transport_request_cadence_check;
alter table public.transport_request add constraint transport_request_cadence_check
  check (case when kind = 'cancel' then coalesce(cadence in ('one_off', 'regular'), false) else cadence is null end);
alter table public.transport_request drop constraint if exists transport_request_weekday_check;
alter table public.transport_request add constraint transport_request_weekday_check
  check (weekday is null or weekday between 0 and 6);
alter table public.transport_request drop constraint if exists transport_request_target_check;
alter table public.transport_request add constraint transport_request_target_check
  check (
    case
      when kind = 'change' then service_date is not null and from_date is not null
      when kind = 'one_off' or (kind = 'cancel' and cadence = 'one_off') then service_date is not null
      else weekday is not null
    end
  );
alter table public.transport_request drop constraint if exists transport_request_purpose_check;
alter table public.transport_request add constraint transport_request_purpose_check
  check (purpose in ('regular', 'vet', 'transfer'));
alter table public.transport_request drop constraint if exists transport_request_minutes_check;
alter table public.transport_request add constraint transport_request_minutes_check check (
  (deadline_min is null or deadline_min between 0 and 1439)
  and (window_start_min is null or window_start_min between 0 and 1439)
  and (window_end_min is null or window_end_min between 0 and 1439)
);
alter table public.transport_request drop constraint if exists transport_request_transfer_check;
alter table public.transport_request add constraint transport_request_transfer_check
  check (
    case
      when purpose = 'transfer' then transfer_from_branch_id is not null and transfer_to_branch_id is not null
                                     and transfer_from_branch_id <> transfer_to_branch_id and kind = 'one_off'
      else transfer_from_branch_id is null and transfer_to_branch_id is null
    end
  );

comment on column public.transport_request.group_id is
  'Rows recorded together as one ask share a group and show as one card.';
comment on column public.transport_request.hub_request_id is
  'admin-essentials transport_request id once this row is pushed to the hub. Null until then.';
comment on column public.transport_request.from_date is
  'A move (kind change): the date the trip was on. service_date is where it moves to.';

create index if not exists transport_request_group_idx on public.transport_request (group_id);
create index if not exists transport_request_status_idx on public.transport_request (status, service_date);
create index if not exists transport_request_owner_idx on public.transport_request (owner_id);
create index if not exists transport_request_transfer_idx on public.transport_request (service_date) where purpose = 'transfer';

create table if not exists public.transport_request_pet (
  request_id uuid not null references public.transport_request(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  primary key (request_id, pet_id)
);

create index if not exists transport_request_pet_pet_idx on public.transport_request_pet (pet_id);

create table if not exists public.transport_request_event (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.transport_request(id) on delete cascade,
  group_id uuid not null,
  at timestamptz not null default now(),
  actor text,
  action text not null,
  detail text
);

create index if not exists transport_request_event_group_idx on public.transport_request_event (group_id, at);

-- ── Regulars ──

create table if not exists public.transport_regular (
  id uuid primary key default gen_random_uuid(),
  brand text not null default 'WOOF',
  branch_id uuid not null references public.branches(id),
  owner_id uuid not null references public.owners(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  weekday smallint not null,
  direction text not null,
  pickup_time time,
  dropoff_time time,
  starts_on date not null default current_date,
  ends_on date,
  paused_from date,
  paused_until date,
  notes text,
  is_active boolean not null default true,
  created_by text,
  hub_rule_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  pickup_window_start_min integer,
  pickup_window_end_min integer,
  dropoff_window_start_min integer,
  dropoff_window_end_min integer,
  transfer_to_branch_id uuid references public.branches(id)
);

alter table public.transport_regular drop constraint if exists transport_regular_brand_check;
alter table public.transport_regular add constraint transport_regular_brand_check check (brand = 'WOOF');
alter table public.transport_regular drop constraint if exists transport_regular_weekday_check;
alter table public.transport_regular add constraint transport_regular_weekday_check check (weekday between 0 and 6);
alter table public.transport_regular drop constraint if exists transport_regular_direction_check;
alter table public.transport_regular add constraint transport_regular_direction_check
  check (direction in ('pickup', 'dropoff', 'both'));
alter table public.transport_regular drop constraint if exists transport_regular_window_check;
alter table public.transport_regular add constraint transport_regular_window_check
  check (
    ((pickup_window_start_min is null and pickup_window_end_min is null)
      or (pickup_window_start_min between 0 and 1439 and pickup_window_end_min between 1 and 1440
          and pickup_window_end_min - pickup_window_start_min >= 30))
    and
    ((dropoff_window_start_min is null and dropoff_window_end_min is null)
      or (dropoff_window_start_min between 0 and 1439 and dropoff_window_end_min between 1 and 1440
          and dropoff_window_end_min - dropoff_window_start_min >= 30))
  );
alter table public.transport_regular drop constraint if exists transport_regular_transfer_check;
alter table public.transport_regular add constraint transport_regular_transfer_check
  check (transfer_to_branch_id is null or transfer_to_branch_id <> branch_id);

comment on column public.transport_regular.hub_rule_id is
  'admin-essentials recurring rule id once this regular is pushed to the hub. Null until then.';
comment on column public.transport_regular.transfer_to_branch_id is
  'Reserved for a cross-facility regular. Woof has one facility, so this stays null.';

create index if not exists transport_regular_weekday_idx on public.transport_regular (weekday, branch_id) where is_active;
create index if not exists transport_regular_owner_idx on public.transport_regular (owner_id);

-- ── Vet visits ──

create table if not exists public.transport_vet_visit (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  owner_id uuid not null references public.owners(id) on delete cascade,
  pet_ids uuid[] not null,
  vet_clinic_id uuid references public.vet_clinics(id) on delete set null,
  vet_label text not null,
  vet_lat double precision,
  vet_lng double precision,
  appointment_date date not null,
  appointment_time_min integer not null,
  arrive_buffer_min integer not null default 15,
  visit_mode text not null,
  expected_duration_min integer,
  return_to text not null default 'facility',
  return_date date,
  ready_time_min integer,
  home_window_start_min integer,
  home_window_end_min integer,
  status text not null default 'planned',
  notes text,
  outbound_request_id uuid references public.transport_request(id) on delete set null,
  return_request_id uuid references public.transport_request(id) on delete set null,
  home_request_id uuid references public.transport_request(id) on delete set null,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_vet_visit_mode_check check (visit_mode in ('wait', 'return_later', 'admitted')),
  constraint transport_vet_visit_return_to_check check (return_to in ('facility', 'home', 'owner_collects')),
  constraint transport_vet_visit_status_check check (status in ('planned', 'at_vet', 'returned', 'cancelled')),
  constraint transport_vet_visit_minutes_check check (
    appointment_time_min between 0 and 1439
    and arrive_buffer_min between 0 and 180
    and (expected_duration_min is null or expected_duration_min between 0 and 1439)
    and (ready_time_min is null or ready_time_min between 0 and 1439)
    and (home_window_start_min is null or home_window_start_min between 0 and 1439)
    and (home_window_end_min is null or home_window_end_min between 0 and 1439)
  ),
  constraint transport_vet_visit_return_date_check check (return_date is null or return_date >= appointment_date),
  constraint transport_vet_visit_pets_check check (cardinality(pet_ids) > 0)
);

create index if not exists transport_vet_visit_date_idx on public.transport_vet_visit (appointment_date) where status <> 'cancelled';
create index if not exists transport_vet_visit_open_idx on public.transport_vet_visit (status, return_date);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transport_request_vet_visit_id_fkey') then
    alter table public.transport_request add constraint transport_request_vet_visit_id_fkey
      foreign key (vet_visit_id) references public.transport_vet_visit(id) on delete set null;
  end if;
end $$;

-- ── Day notes: one household note per date and direction ──

create table if not exists public.transport_day_note (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  direction text not null,
  owner_id uuid not null references public.owners(id) on delete cascade,
  note text not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint transport_day_note_direction_check check (direction in ('pickup', 'dropoff')),
  constraint transport_day_note_length_check check (char_length(note) <= 1000),
  constraint transport_day_note_unique unique (service_date, direction, owner_id)
);

-- ── Facility pin used by vet legs that return to the kennel ──

create table if not exists public.transport_facility (
  code text primary key,
  branch_id uuid references public.branches(id),
  name text not null,
  lat double precision,
  lng double precision,
  voltlines_address_match text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.transport_facility (code, branch_id, name)
select 'WOOF_AQ', b.id, 'Woof Al Quoz'
from public.branches b
where b.code = 'woof'
on conflict (code) do update set branch_id = excluded.branch_id, name = excluded.name;

-- ── updated_at ──

drop trigger if exists transport_request_updated_at on public.transport_request;
create trigger transport_request_updated_at before update on public.transport_request
  for each row execute function public.update_updated_at();

drop trigger if exists transport_regular_updated_at on public.transport_regular;
create trigger transport_regular_updated_at before update on public.transport_regular
  for each row execute function public.update_updated_at();

drop trigger if exists transport_vet_visit_updated_at on public.transport_vet_visit;
create trigger transport_vet_visit_updated_at before update on public.transport_vet_visit
  for each row execute function public.update_updated_at();

drop trigger if exists transport_day_note_updated_at on public.transport_day_note;
create trigger transport_day_note_updated_at before update on public.transport_day_note
  for each row execute function public.update_updated_at();

-- ── Request activity log ──

create or replace function public.transport_request_log()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  who text := coalesce(new.updated_by, new.created_by);
begin
  if tg_op = 'INSERT' then
    insert into public.transport_request_event (request_id, group_id, actor, action)
    values (new.id, new.group_id, who, 'recorded');
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.transport_request_event (request_id, group_id, actor, action, detail)
    values (new.id, new.group_id, who, new.status,
            case when new.status = 'rejected' then new.rejection_reason end);
  end if;
  if new.notes is distinct from old.notes then
    insert into public.transport_request_event (request_id, group_id, actor, action, detail)
    values (new.id, new.group_id, who, 'note', new.notes);
  end if;
  if new.requested_slot_id is distinct from old.requested_slot_id
     or new.service_date is distinct from old.service_date
     or new.owner_id is distinct from old.owner_id
     or new.branch_id is distinct from old.branch_id
     or new.location_text is distinct from old.location_text
     or new.location_lat is distinct from old.location_lat then
    insert into public.transport_request_event (request_id, group_id, actor, action)
    values (new.id, new.group_id, who, 'edited');
  end if;
  return new;
end;
$$;

drop trigger if exists transport_request_log on public.transport_request;
create trigger transport_request_log after insert or update on public.transport_request
  for each row execute function public.transport_request_log();

-- ── Split a both-ways regular so one direction can be paused or ended ──

create or replace function public.transport_regular_split(p_regular_id uuid, p_keep text)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  rg public.transport_regular;
  new_id uuid;
begin
  select * into rg from public.transport_regular where id = p_regular_id;
  if rg.id is null then
    raise exception 'That regular is not available';
  end if;
  if rg.direction <> 'both' then
    return rg.id;
  end if;
  update public.transport_regular
     set direction = case p_keep when 'pickup' then 'dropoff' else 'pickup' end,
         pickup_time = case p_keep when 'pickup' then null else pickup_time end,
         dropoff_time = case p_keep when 'dropoff' then null else dropoff_time end,
         pickup_window_start_min = case p_keep when 'pickup' then null else pickup_window_start_min end,
         pickup_window_end_min = case p_keep when 'pickup' then null else pickup_window_end_min end,
         dropoff_window_start_min = case p_keep when 'dropoff' then null else dropoff_window_start_min end,
         dropoff_window_end_min = case p_keep when 'dropoff' then null else dropoff_window_end_min end
   where id = rg.id;
  insert into public.transport_regular (
    brand, branch_id, owner_id, pet_id, weekday, direction, pickup_time, dropoff_time,
    pickup_window_start_min, pickup_window_end_min, dropoff_window_start_min, dropoff_window_end_min,
    transfer_to_branch_id, starts_on, ends_on, paused_from, paused_until, notes, is_active, created_by, hub_rule_id)
  values (
    rg.brand, rg.branch_id, rg.owner_id, rg.pet_id, rg.weekday, p_keep,
    case p_keep when 'pickup' then rg.pickup_time end,
    case p_keep when 'dropoff' then rg.dropoff_time end,
    case p_keep when 'pickup' then rg.pickup_window_start_min end,
    case p_keep when 'pickup' then rg.pickup_window_end_min end,
    case p_keep when 'dropoff' then rg.dropoff_window_start_min end,
    case p_keep when 'dropoff' then rg.dropoff_window_end_min end,
    rg.transfer_to_branch_id,
    rg.starts_on, rg.ends_on, rg.paused_from, rg.paused_until, rg.notes, rg.is_active, rg.created_by, rg.hub_rule_id)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.transport_request_decide(
  p_request_ids uuid[],
  p_action text,
  p_actor text,
  p_reason text default null
)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  r public.transport_request;
  pet uuid;
  rg record;
  target uuid;
  applied uuid[];
  slot_time time;
  n integer := 0;
begin
  if p_action not in ('approve', 'reject', 'cancel') then
    raise exception 'Unknown action %', p_action;
  end if;
  if p_action = 'reject' and coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for rejecting';
  end if;

  for r in
    select * from public.transport_request where id = any (p_request_ids) and status = 'received' for update
  loop
    applied := '{}';
    if p_action = 'approve' then
      select make_time(s.start_min / 60, s.start_min % 60, 0) into slot_time
        from public.transport_slots s where s.id = r.requested_slot_id;

      if r.kind = 'new_recurring' then
        for pet in select rp.pet_id from public.transport_request_pet rp where rp.request_id = r.id loop
          insert into public.transport_regular (
            branch_id, owner_id, pet_id, weekday, direction, pickup_time, dropoff_time,
            pickup_window_start_min, pickup_window_end_min, dropoff_window_start_min, dropoff_window_end_min,
            starts_on, notes, created_by)
          values (
            r.branch_id, r.owner_id, pet, r.weekday, r.direction,
            case r.direction when 'pickup' then slot_time end,
            case r.direction when 'dropoff' then slot_time end,
            case when r.direction = 'pickup' and r.window_end_min - r.window_start_min >= 30 then r.window_start_min end,
            case when r.direction = 'pickup' and r.window_end_min - r.window_start_min >= 30 then r.window_end_min end,
            case when r.direction = 'dropoff' and r.window_end_min - r.window_start_min >= 30 then r.window_start_min end,
            case when r.direction = 'dropoff' and r.window_end_min - r.window_start_min >= 30 then r.window_end_min end,
            coalesce(r.starts_on, current_date), r.notes, p_actor)
          returning id into target;
          applied := applied || target;
        end loop;
      elsif r.kind = 'pause' or (r.kind = 'cancel' and r.cadence = 'regular') then
        for rg in
          select g.id from public.transport_regular g
          join public.transport_request_pet rp on rp.request_id = r.id and rp.pet_id = g.pet_id
          where g.owner_id = r.owner_id
            and g.weekday = r.weekday
            and g.is_active
            and g.direction in (r.direction, 'both')
            and (g.ends_on is null or g.ends_on >= current_date)
        loop
          target := public.transport_regular_split(rg.id, r.direction);
          if r.kind = 'pause' then
            update public.transport_regular set paused_from = r.paused_from, paused_until = r.paused_until where id = target;
          else
            update public.transport_regular set ends_on = r.ends_on where id = target;
          end if;
          applied := applied || target;
        end loop;
      end if;

      update public.transport_request
         set status = 'approved', decided_by = p_actor, decided_at = now(), updated_by = p_actor,
             applied_regular_ids = nullif(applied, '{}')
       where id = r.id;
    elsif p_action = 'reject' then
      update public.transport_request
         set status = 'rejected', rejection_reason = trim(p_reason), decided_by = p_actor, decided_at = now(), updated_by = p_actor
       where id = r.id;
    else
      update public.transport_request
         set status = 'cancelled', decided_by = p_actor, decided_at = now(), updated_by = p_actor
       where id = r.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ── Who needs a van on a date ──
--
-- Regulars, one-off requests, daycare days logged with pickup/drop-off, and boarding
-- stays with pickup on check-in or drop-off on check-out. The app dedupes. Struck rows
-- (paused, boarding, at the vet, cancelled, moved) stay so Schedule can show them.

create or replace function public.transport_day_demand(p_date date, p_branch_id uuid default null)
returns table (
  source text,
  source_id uuid,
  branch_id uuid,
  owner_id uuid,
  pet_id uuid,
  direction text,
  run_time time,
  status text,
  location_text text,
  location_lat double precision,
  location_lng double precision,
  note text,
  purpose text,
  kind text,
  deadline_min integer,
  window_start_min integer,
  window_end_min integer,
  moved_date date,
  struck text,
  transfer_from_branch_id uuid,
  transfer_to_branch_id uuid
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with allowed as (
    select b.id
    from public.branches b
    where (select auth.uid()) is not null
      and (p_branch_id is null or b.id = p_branch_id)
  ),
  dirs as (
    select * from (values ('pickup'), ('dropoff')) as d(dir)
  ),
  boarding as (
    select bp.pet_id,
           case when b.check_in_date = p_date then 'dropoff'
                when b.check_out_date = p_date then 'pickup'
                else 'all' end as dirs
    from public.bookings b
    join public.booking_pets bp on bp.booking_id = b.id
    where coalesce(b.booking_type::text, 'boarding') = 'boarding'
      and (b.status::text in ('confirmed', 'checked_in')
           or (b.status::text = 'checked_out' and b.check_out_date = p_date))
      and b.check_in_date < b.check_out_date
      and p_date between b.check_in_date and b.check_out_date
  ),
  at_vet as (
    select unnest(v.pet_ids) as pet_id, 'all'::text as dirs
    from public.transport_vet_visit v
    where v.status in ('planned', 'at_vet')
      and v.visit_mode = 'admitted'
      and p_date > v.appointment_date
      and (v.return_date is null or p_date < v.return_date)
    union all
    select unnest(v.pet_ids), 'pickup'
    from public.transport_vet_visit v
    where v.status in ('planned', 'at_vet')
      and v.visit_mode = 'admitted'
      and v.return_date = p_date
    union all
    select unnest(v.pet_ids), 'dropoff'
    from public.transport_vet_visit v
    where v.status in ('planned', 'at_vet')
      and v.appointment_date = p_date
      and (v.visit_mode = 'admitted' or v.return_to = 'owner_collects')
  )
  select 'regular', rg.id, rg.branch_id, rg.owner_id, rg.pet_id, d.dir,
         case d.dir when 'pickup' then rg.pickup_time else rg.dropoff_time end,
         'scheduled', null::text, null::double precision, null::double precision, rg.notes,
         case when rg.transfer_to_branch_id is not null then 'transfer' else 'regular' end,
         null::text, null::int,
         case d.dir when 'pickup' then rg.pickup_window_start_min else rg.dropoff_window_start_min end,
         case d.dir when 'pickup' then rg.pickup_window_end_min else rg.dropoff_window_end_min end,
         null::date,
         case
           when rg.paused_from is not null and p_date >= rg.paused_from
                and (rg.paused_until is null or p_date <= rg.paused_until) then 'Paused'
           when exists (select 1 from boarding x where x.pet_id = rg.pet_id and x.dirs in ('all', d.dir)) then 'Boarding'
           when exists (select 1 from at_vet a where a.pet_id = rg.pet_id and (a.dirs = 'all' or a.dirs = d.dir)) then 'At the vet'
         end,
         case when rg.transfer_to_branch_id is null then null::uuid
              when d.dir = 'pickup' then rg.branch_id else rg.transfer_to_branch_id end,
         case when rg.transfer_to_branch_id is null then null::uuid
              when d.dir = 'pickup' then rg.transfer_to_branch_id else rg.branch_id end
  from public.transport_regular rg
  join dirs d on rg.direction in (d.dir, 'both')
  where rg.is_active
    and rg.weekday = extract(dow from p_date)::int
    and rg.starts_on <= p_date
    and (rg.ends_on is null or rg.ends_on >= p_date)
    and rg.branch_id in (select id from allowed)
    and (p_branch_id is null or rg.branch_id = p_branch_id)

  union all
  select 'request', r.id, r.branch_id, r.owner_id, rp.pet_id, r.direction,
         coalesce(make_time(r.window_start_min / 60, r.window_start_min % 60, 0),
                  (select make_time(s.start_min / 60, s.start_min % 60, 0) from public.transport_slots s where s.id = r.requested_slot_id)),
         r.status, r.location_text, r.location_lat, r.location_lng, r.notes,
         r.purpose, r.kind, r.deadline_min, r.window_start_min, r.window_end_min,
         case when r.kind = 'change' then r.from_date end,
         case
           when r.status = 'cancelled' then 'Cancelled'
           when r.purpose = 'regular' and r.location_text is null
                and exists (select 1 from boarding x where x.pet_id = rp.pet_id and x.dirs in ('all', r.direction)) then 'Boarding'
         end,
         r.transfer_from_branch_id, r.transfer_to_branch_id
  from public.transport_request r
  join public.transport_request_pet rp on rp.request_id = r.id
  where r.service_date = p_date
    and r.kind in ('one_off', 'change')
    and (r.status in ('received', 'approved') or (r.status = 'cancelled' and r.purpose in ('vet', 'transfer')))
    and r.branch_id in (select id from allowed)
    and (p_branch_id is null or r.branch_id = p_branch_id)

  union all
  select 'skip', r.id, r.branch_id, r.owner_id, rp.pet_id, r.direction, null::time,
         r.status, null, null, null, r.notes,
         r.purpose, r.kind, null, null, null, null, null, null, null
  from public.transport_request r
  join public.transport_request_pet rp on rp.request_id = r.id
  where r.service_date = p_date
    and r.kind = 'cancel' and r.cadence = 'one_off' and r.status = 'approved'
    and r.branch_id in (select id from allowed)
    and (p_branch_id is null or r.branch_id = p_branch_id)

  union all
  select 'moved', r.id, r.branch_id, r.owner_id, rp.pet_id, r.direction, null::time,
         r.status, null, null, null, r.notes,
         r.purpose, r.kind, null, null, null, r.service_date, null, null, null
  from public.transport_request r
  join public.transport_request_pet rp on rp.request_id = r.id
  where r.from_date = p_date
    and r.kind = 'change' and r.status = 'approved'
    and r.branch_id in (select id from allowed)
    and (p_branch_id is null or r.branch_id = p_branch_id)

  union all
  select 'daycare', s.id, (select id from allowed limit 1), s.owner_id, s.pet_id, d.dir, null::time,
         'scheduled', null, null, null, null,
         'regular', null, null, null, null, null, null, null, null
  from public.daycare_sessions s
  join dirs d on (d.dir = 'pickup' and s.pickup_used) or (d.dir = 'dropoff' and s.dropoff_used)
  where s.session_date = p_date
    and (select id from allowed limit 1) is not null

  union all
  select 'boarding', b.id, (select id from allowed limit 1), b.owner_id, bp.pet_id, d.dir, null::time,
         'scheduled', null, null, null, b.booking_ref,
         'regular', null, null, null, null, null, null, null, null
  from public.bookings b
  join public.booking_pets bp on bp.booking_id = b.id
  join dirs d on (d.dir = 'pickup' and b.pickup_required and b.check_in_date = p_date)
              or (d.dir = 'dropoff' and b.dropoff_required and b.check_out_date = p_date)
  where b.status::text in ('confirmed', 'checked_in', 'checked_out')
    and (b.check_in_date = p_date or b.check_out_date = p_date)
    and (select id from allowed limit 1) is not null;
$$;

create or replace function public.transport_client_schedule(p_owner_id uuid, p_from date, p_days integer default 14)
returns table (
  service_date date,
  source text,
  source_id uuid,
  branch_id uuid,
  owner_id uuid,
  pet_id uuid,
  direction text,
  run_time time,
  status text,
  location_text text,
  location_lat double precision,
  location_lng double precision,
  note text,
  purpose text,
  kind text,
  deadline_min integer,
  window_start_min integer,
  window_end_min integer,
  moved_date date,
  struck text,
  transfer_from_branch_id uuid,
  transfer_to_branch_id uuid
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select d::date, x.*
  from generate_series(p_from, p_from + (least(greatest(p_days, 1), 60) - 1), interval '1 day') as d
  cross join lateral public.transport_day_demand(d::date, null) x
  where x.owner_id = p_owner_id;
$$;

create or replace function public.transport_vet_visit_write(p_visit jsonb, p_legs jsonb, p_actor text)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v public.transport_vet_visit;
  v_id uuid := nullif(p_visit->>'id', '')::uuid;
  role_name text;
  leg jsonb;
  existing uuid;
  existing_status text;
  leg_id uuid;
  pet uuid;
begin
  if v_id is null then
    insert into public.transport_vet_visit (
      branch_id, owner_id, pet_ids, vet_clinic_id, vet_label, vet_lat, vet_lng,
      appointment_date, appointment_time_min, arrive_buffer_min, visit_mode, expected_duration_min,
      return_to, return_date, ready_time_min, home_window_start_min, home_window_end_min,
      notes, created_by, updated_by)
    values (
      (p_visit->>'branch_id')::uuid, (p_visit->>'owner_id')::uuid,
      array(select jsonb_array_elements_text(p_visit->'pet_ids')::uuid),
      nullif(p_visit->>'vet_clinic_id', '')::uuid, p_visit->>'vet_label',
      (p_visit->>'vet_lat')::double precision, (p_visit->>'vet_lng')::double precision,
      (p_visit->>'appointment_date')::date, (p_visit->>'appointment_time_min')::int,
      coalesce((p_visit->>'arrive_buffer_min')::int, 15), p_visit->>'visit_mode',
      (p_visit->>'expected_duration_min')::int, coalesce(p_visit->>'return_to', 'facility'),
      (p_visit->>'return_date')::date, (p_visit->>'ready_time_min')::int,
      (p_visit->>'home_window_start_min')::int, (p_visit->>'home_window_end_min')::int,
      nullif(p_visit->>'notes', ''), p_actor, p_actor)
    returning * into v;
  else
    update public.transport_vet_visit set
      appointment_date = (p_visit->>'appointment_date')::date,
      appointment_time_min = (p_visit->>'appointment_time_min')::int,
      arrive_buffer_min = coalesce((p_visit->>'arrive_buffer_min')::int, 15),
      visit_mode = p_visit->>'visit_mode',
      expected_duration_min = (p_visit->>'expected_duration_min')::int,
      return_to = coalesce(p_visit->>'return_to', 'facility'),
      return_date = (p_visit->>'return_date')::date,
      ready_time_min = (p_visit->>'ready_time_min')::int,
      home_window_start_min = (p_visit->>'home_window_start_min')::int,
      home_window_end_min = (p_visit->>'home_window_end_min')::int,
      updated_by = p_actor
    where id = v_id and status <> 'cancelled'
    returning * into v;
    if v.id is null then
      raise exception 'That vet visit is not available';
    end if;
  end if;

  foreach role_name in array array['outbound', 'return', 'home'] loop
    leg := null;
    existing_status := null;
    select e.value into leg from jsonb_array_elements(p_legs) e where e.value->>'role' = role_name limit 1;
    existing := case role_name when 'outbound' then v.outbound_request_id when 'return' then v.return_request_id else v.home_request_id end;
    select status into existing_status from public.transport_request where id = existing;

    if leg is null then
      if existing is not null and existing_status is distinct from 'cancelled' then
        update public.transport_request set status = 'cancelled', decided_by = p_actor, decided_at = now(), updated_by = p_actor
        where id = existing;
      end if;
      continue;
    end if;

    if existing is not null and existing_status is distinct from 'cancelled' then
      update public.transport_request set
        service_date = (leg->>'service_date')::date,
        direction = leg->>'direction',
        deadline_min = (leg->>'deadline_min')::int,
        window_start_min = (leg->>'window_start_min')::int,
        window_end_min = (leg->>'window_end_min')::int,
        location_text = leg->>'location_text',
        location_lat = (leg->>'location_lat')::double precision,
        location_lng = (leg->>'location_lng')::double precision,
        notes = leg->>'notes',
        updated_by = p_actor
      where id = existing;
    else
      insert into public.transport_request (
        group_id, branch_id, owner_id, kind, direction, service_date, status, purpose, vet_visit_id,
        deadline_min, window_start_min, window_end_min, location_text, location_lat, location_lng,
        notes, created_by, updated_by, decided_by, decided_at)
      values (
        v.id, v.branch_id, v.owner_id, 'one_off', leg->>'direction', (leg->>'service_date')::date, 'approved', 'vet', v.id,
        (leg->>'deadline_min')::int, (leg->>'window_start_min')::int, (leg->>'window_end_min')::int,
        leg->>'location_text', (leg->>'location_lat')::double precision, (leg->>'location_lng')::double precision,
        leg->>'notes', p_actor, p_actor, p_actor, now())
      returning id into leg_id;
      foreach pet in array v.pet_ids loop
        insert into public.transport_request_pet (request_id, pet_id) values (leg_id, pet);
      end loop;
      if role_name = 'outbound' then
        update public.transport_vet_visit set outbound_request_id = leg_id where id = v.id;
      elsif role_name = 'return' then
        update public.transport_vet_visit set return_request_id = leg_id where id = v.id;
      else
        update public.transport_vet_visit set home_request_id = leg_id where id = v.id;
      end if;
    end if;
  end loop;

  return v.id;
end;
$$;

create or replace function public.transport_vet_visit_set_status(p_id uuid, p_status text, p_actor text)
returns void
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if p_status not in ('planned', 'at_vet', 'returned', 'cancelled') then
    raise exception 'Unknown vet visit status %', p_status;
  end if;
  update public.transport_vet_visit set status = p_status, updated_by = p_actor where id = p_id;
  if not found then
    raise exception 'That vet visit is not available';
  end if;
  if p_status = 'cancelled' then
    update public.transport_request
       set status = 'cancelled', decided_by = p_actor, decided_at = now(), updated_by = p_actor
     where vet_visit_id = p_id and status <> 'cancelled';
  end if;
end;
$$;

-- ── RLS ──

alter table public.transport_request enable row level security;
alter table public.transport_request_pet enable row level security;
alter table public.transport_request_event enable row level security;
alter table public.transport_regular enable row level security;
alter table public.transport_vet_visit enable row level security;
alter table public.transport_day_note enable row level security;
alter table public.transport_facility enable row level security;

drop policy if exists transport_request_staff on public.transport_request;
create policy transport_request_staff on public.transport_request
  for all to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

drop policy if exists transport_request_pet_staff on public.transport_request_pet;
create policy transport_request_pet_staff on public.transport_request_pet
  for all to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

drop policy if exists transport_request_event_staff on public.transport_request_event;
create policy transport_request_event_staff on public.transport_request_event
  for all to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

drop policy if exists transport_regular_staff on public.transport_regular;
create policy transport_regular_staff on public.transport_regular
  for all to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

drop policy if exists transport_vet_visit_staff on public.transport_vet_visit;
create policy transport_vet_visit_staff on public.transport_vet_visit
  for all to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

drop policy if exists transport_day_note_staff on public.transport_day_note;
create policy transport_day_note_staff on public.transport_day_note
  for all to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

drop policy if exists transport_facility_staff on public.transport_facility;
create policy transport_facility_staff on public.transport_facility
  for all to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

grant select, insert, update, delete on public.branches to authenticated;
grant select, insert, update, delete on public.transport_slots to authenticated;
grant select, insert, update, delete on public.transport_request to authenticated;
grant select, insert, update, delete on public.transport_request_pet to authenticated;
grant select, insert, update, delete on public.transport_request_event to authenticated;
grant select, insert, update, delete on public.transport_regular to authenticated;
grant select, insert, update, delete on public.transport_vet_visit to authenticated;
grant select, insert, update, delete on public.transport_day_note to authenticated;
grant select, insert, update, delete on public.transport_facility to authenticated;

revoke all on function public.transport_request_log() from public, anon;
revoke all on function public.transport_regular_split(uuid, text) from public, anon;
revoke all on function public.transport_request_decide(uuid[], text, text, text) from public, anon;
revoke all on function public.transport_day_demand(date, uuid) from public, anon;
revoke all on function public.transport_client_schedule(uuid, date, integer) from public, anon;
revoke all on function public.transport_vet_visit_write(jsonb, jsonb, text) from public, anon;
revoke all on function public.transport_vet_visit_set_status(uuid, text, text) from public, anon;

grant execute on function public.transport_request_log() to authenticated;
grant execute on function public.transport_regular_split(uuid, text) to authenticated;
grant execute on function public.transport_request_decide(uuid[], text, text, text) to authenticated;
grant execute on function public.transport_day_demand(date, uuid) to authenticated;
grant execute on function public.transport_client_schedule(uuid, date, integer) to authenticated;
grant execute on function public.transport_vet_visit_write(jsonb, jsonb, text) to authenticated;
grant execute on function public.transport_vet_visit_set_status(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- Verification. Expect one row: code woof, 30 slots, 1 facility.
select b.code, b.name, b.short_name,
       (select count(*) from public.transport_slots) as slots,
       (select count(*) from public.transport_facility) as facilities,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'owners' and column_name = 'pin_lat') as owner_pin,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pets' and column_name = 'driver_note') as pet_driver_note
from public.branches b
where b.code = 'woof';
