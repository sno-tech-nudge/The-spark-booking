-- ============================================================================
-- the*spark centre — booking core (v1 prototype)
--
-- The one rule that matters most: a seat or room can never be double booked.
-- That is enforced by Postgres itself (EXCLUDE constraints below), not by app
-- code, so it holds no matter how many people click at the same moment.
-- ============================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table public.plans (
  id                   text primary key,
  name                 text not null,
  description          text,
  monthly_price        integer not null,          -- INR, excl. GST
  desk_days_included   numeric,                   -- null = unlimited
  room_hours_included  integer not null default 0,
  room_access          boolean not null default true,
  after_hours_access   boolean not null default false,
  assigned_seat        boolean not null default false,
  self_serve           boolean not null default true,  -- false = contract / CRM only
  sort                 integer not null default 0
);

create table public.settings (
  id                   boolean primary key default true check (id),
  day_pass_price       integer not null default 500,
  half_day_price       integer not null default 300,
  hold_minutes         integer not null default 8,
  open_hour            integer not null default 9,
  close_hour           integer not null default 18,
  after_hours_open     integer not null default 8,
  after_hours_close    integer not null default 22,
  gst_rate             numeric not null default 18,
  booking_window_days  integer not null default 30
);

create table public.resources (
  id             text primary key,
  kind           text not null check (kind in ('desk', 'room')),
  category       text not null check (category in ('desk', 'lounge', 'meeting', 'phone_booth', 'podcast')),
  name           text not null,
  zone           text,
  table_no       integer,
  capacity       integer not null default 1,
  hourly_rate    integer not null default 0,      -- INR / hour, excl. GST
  members_only   boolean not null default false,
  uses_credits   boolean not null default false,  -- draws from plan room hours first
  min_hours      integer not null default 1,
  amenities      text[] not null default '{}',
  assigned_membership uuid,                       -- fixed desk holder
  is_active      boolean not null default true,
  sort           integer not null default 0
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table public.admin_emails (
  email text primary key
);

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null unique,
  full_name     text,
  phone         text,
  organisation  text,
  role          text not null default 'guest' check (role in ('admin', 'member', 'guest')),
  created_at    timestamptz not null default now()
);

create table public.memberships (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  user_id           uuid references public.profiles (id) on delete set null,
  plan_id           text not null references public.plans (id),
  status            text not null default 'active' check (status in ('active', 'paused', 'ended')),
  starts_on         date not null default current_date,
  ends_on           date,
  organisation      text,
  assigned_seat_id  text references public.resources (id),
  notes             text,
  created_at        timestamptz not null default now()
);

create unique index memberships_one_active_per_email
  on public.memberships (lower(email)) where status = 'active';
create unique index memberships_one_holder_per_seat
  on public.memberships (assigned_seat_id) where status = 'active' and assigned_seat_id is not null;

alter table public.resources
  add constraint resources_assigned_membership_fk
  foreign key (assigned_membership) references public.memberships (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Bookings — the inventory ledger
-- ---------------------------------------------------------------------------

create table public.bookings (
  id               uuid primary key default gen_random_uuid(),
  resource_id      text not null references public.resources (id),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  kind             text not null check (kind in ('desk', 'room', 'block')),
  part             text check (part in ('morning', 'afternoon', 'full')),
  booking_date     date not null,
  slot             tstzrange not null,
  status           text not null check (status in ('held', 'confirmed', 'cancelled', 'expired')),
  hold_expires_at  timestamptz,
  units            numeric not null default 0,   -- plan credits used (desk days or room hours)
  amount           integer not null default 0,   -- INR excl. GST: paid, or overage to invoice
  billing          text not null default 'included'
                   check (billing in ('included', 'overage', 'free', 'pending_payment', 'paid', 'refund_due', 'none')),
  payment_ref      text,
  checked_in_at    timestamptz,
  checked_out_at   timestamptz,
  note             text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- No two live bookings (held or confirmed) may overlap on the same seat/room.
  constraint no_double_booking
    exclude using gist (resource_id with =, slot with &&)
    where (status in ('held', 'confirmed')),

  -- One person can't sit at two desks at once.
  constraint one_desk_per_person
    exclude using gist (user_id with =, slot with &&)
    where (status in ('held', 'confirmed') and kind = 'desk')
);

create index bookings_user_idx on public.bookings (user_id, booking_date);
create index bookings_date_idx on public.bookings (booking_date);
create index bookings_held_idx on public.bookings (hold_expires_at) where status = 'held';

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  provider     text not null check (provider in ('razorpay', 'demo')),
  order_id     text,
  payment_id   text,
  amount       integer not null,            -- INR excl. GST
  gst_amount   integer not null default 0,
  status       text not null check (status in ('created', 'captured', 'failed', 'refund_due')),
  created_at   timestamptz not null default now()
);

-- Public, PII-free mirror of live bookings. Seat maps read this and subscribe
-- to it over Supabase Realtime, so everyone sees seats change instantly
-- without anyone seeing who booked what.
create table public.occupancy (
  booking_id       uuid primary key references public.bookings (id) on delete cascade,
  resource_id      text not null,
  kind             text not null,
  part             text,
  booking_date     date not null,
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  status           text not null,
  hold_expires_at  timestamptz
);
create index occupancy_date_idx on public.occupancy (booking_date);
alter table public.occupancy replica identity full;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.ist(d date, h numeric)
returns timestamptz language sql immutable as $$
  select (d + make_interval(mins => (h * 60)::int)) at time zone 'Asia/Kolkata'
$$;

create or replace function public.today_ist()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create or replace function public.desk_slot(d date, p text)
returns tstzrange language sql immutable as $$
  select case p
    when 'morning'   then tstzrange(public.ist(d, 9),    public.ist(d, 13.5), '[)')
    when 'afternoon' then tstzrange(public.ist(d, 13.5), public.ist(d, 18),   '[)')
    when 'full'      then tstzrange(public.ist(d, 9),    public.ist(d, 18),   '[)')
  end
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- The caller's active membership (with its plan) on a given date.
create or replace function public.active_membership(uid uuid, on_date date)
returns table (membership_id uuid, plan_id text, desk_days_included numeric,
               room_hours_included integer, room_access boolean,
               after_hours_access boolean, assigned_seat_id text)
language sql stable security definer set search_path = public as $$
  select m.id, p.id, p.desk_days_included, p.room_hours_included, p.room_access,
         p.after_hours_access, m.assigned_seat_id
  from public.memberships m
  join public.plans p on p.id = m.plan_id
  where m.user_id = uid
    and m.status = 'active'
    and m.starts_on <= on_date
    and (m.ends_on is null or m.ends_on >= on_date)
  limit 1
$$;

create or replace function public.expire_stale_holds(p_resource text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.bookings
     set status = 'expired', updated_at = now()
   where status = 'held'
     and hold_expires_at < now()
     and (p_resource is null or resource_id = p_resource);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers: keep profiles, roles, seats and occupancy in sync
-- ---------------------------------------------------------------------------

create or replace function public.sync_role(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select email into v_email from public.profiles where id = uid;
  if v_email is null then return; end if;
  update public.profiles
     set role = case
       when exists (select 1 from public.admin_emails a where lower(a.email) = lower(v_email)) then 'admin'
       when exists (select 1 from public.memberships m where m.user_id = uid and m.status = 'active') then 'member'
       else 'guest' end
   where id = uid;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, lower(new.email))
  on conflict (id) do nothing;

  update public.memberships
     set user_id = new.id
   where lower(email) = lower(new.email) and user_id is null;

  perform public.sync_role(new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.memberships_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  if new.user_id is null then
    select id into new.user_id from public.profiles where email = new.email;
  end if;
  return new;
end $$;

create trigger memberships_before
  before insert or update on public.memberships
  for each row execute function public.memberships_before();

create or replace function public.memberships_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.user_id is not null then
    perform public.sync_role(old.user_id);
  end if;
  if new.user_id is not null then
    perform public.sync_role(new.user_id);
  end if;

  -- fixed-desk seat assignment
  update public.resources set assigned_membership = null
   where assigned_membership = new.id
     and (new.status <> 'active' or new.assigned_seat_id is distinct from id);
  if new.status = 'active' and new.assigned_seat_id is not null then
    update public.resources set assigned_membership = new.id where id = new.assigned_seat_id;
  end if;
  return new;
end $$;

create trigger memberships_after
  after insert or update on public.memberships
  for each row execute function public.memberships_after();

create or replace function public.admin_emails_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from public.profiles
   where email = lower(coalesce(new.email, old.email));
  if uid is not null then perform public.sync_role(uid); end if;
  return null;
end $$;

create trigger admin_emails_after
  after insert or delete on public.admin_emails
  for each row execute function public.admin_emails_after();

-- Members may edit their own name/phone/org, never their role.
create or replace function public.protect_profile()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and current_user in ('anon', 'authenticated') then
    raise exception 'role can only be changed by staff';
  end if;
  if new.email is distinct from old.email and current_user in ('anon', 'authenticated') then
    raise exception 'email cannot be changed here';
  end if;
  return new;
end $$;

create trigger protect_profile
  before update on public.profiles
  for each row execute function public.protect_profile();

create or replace function public.mirror_occupancy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('held', 'confirmed') then
    insert into public.occupancy (booking_id, resource_id, kind, part, booking_date,
                                  start_at, end_at, status, hold_expires_at)
    values (new.id, new.resource_id, new.kind, new.part, new.booking_date,
            lower(new.slot), upper(new.slot), new.status, new.hold_expires_at)
    on conflict (booking_id) do update
      set status = excluded.status,
          hold_expires_at = excluded.hold_expires_at,
          start_at = excluded.start_at,
          end_at = excluded.end_at;
  else
    delete from public.occupancy where booking_id = new.id;
  end if;
  return null;
end $$;

create trigger mirror_occupancy
  after insert or update of status, slot, hold_expires_at on public.bookings
  for each row execute function public.mirror_occupancy();

-- ---------------------------------------------------------------------------
-- Booking API (called from the app via supabase.rpc)
-- Errors are raised with short codes the app turns into friendly messages.
-- ---------------------------------------------------------------------------

create or replace function public.raise_booking_conflict(v_constraint text)
returns void language plpgsql as $$
begin
  if v_constraint = 'one_desk_per_person' then
    raise exception 'ALREADY_HAVE_DESK' using errcode = 'P0001';
  end if;
  raise exception 'TAKEN' using errcode = 'P0001';
end $$;

create or replace function public.book_desk(p_resource_id text, p_date date, p_part text)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  s          public.settings;
  r          public.resources;
  m          record;
  v_slot     tstzrange;
  v_units    numeric;
  v_used     numeric;
  v_row      public.bookings;
  v_status   text;
  v_billing  text;
  v_amount   integer := 0;
  v_expires  timestamptz;
  v_constraint text;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  if p_part not in ('morning', 'afternoon', 'full') then raise exception 'BAD_PART' using errcode = 'P0001'; end if;

  select * into s from public.settings;
  select * into r from public.resources where id = p_resource_id and kind = 'desk' and is_active;
  if not found then raise exception 'UNKNOWN_SEAT' using errcode = 'P0001'; end if;

  if p_date < public.today_ist() then raise exception 'PAST_DATE' using errcode = 'P0001'; end if;
  if p_date > public.today_ist() + s.booking_window_days then raise exception 'TOO_FAR' using errcode = 'P0001'; end if;
  if extract(isodow from p_date) = 7 then raise exception 'CLOSED_SUNDAY' using errcode = 'P0001'; end if;

  v_slot := public.desk_slot(p_date, p_part);
  if upper(v_slot) <= now() then raise exception 'SLOT_OVER' using errcode = 'P0001'; end if;

  -- serialize each person's own bookings (keeps plan-credit counting exact)
  perform pg_advisory_xact_lock(hashtext(uid::text));

  select * into m from public.active_membership(uid, p_date);

  if r.assigned_membership is not null and (m.membership_id is null or m.membership_id <> r.assigned_membership) then
    raise exception 'SEAT_ASSIGNED' using errcode = 'P0001';
  end if;

  perform public.expire_stale_holds(p_resource_id);

  v_units := case when p_part = 'full' then 1 else 0.5 end;

  if m.membership_id is not null then
    v_status := 'confirmed';
    if m.desk_days_included is null then
      v_billing := 'included';
    else
      select coalesce(sum(units), 0) into v_used
        from public.bookings
       where user_id = uid and kind = 'desk' and status = 'confirmed'
         and billing in ('included', 'overage')
         and date_trunc('month', booking_date) = date_trunc('month', p_date);
      if v_used + v_units > m.desk_days_included then
        v_billing := 'overage';
        v_amount := case when p_part = 'full' then s.day_pass_price else s.half_day_price end;
      else
        v_billing := 'included';
      end if;
    end if;
  else
    -- non-member: hold the seat while they pay
    v_status  := 'held';
    v_billing := 'pending_payment';
    v_amount  := case when p_part = 'full' then s.day_pass_price else s.half_day_price end;
    v_expires := now() + make_interval(mins => s.hold_minutes);
    v_units   := 0;
    -- only one seat on hold per person at a time
    update public.bookings set status = 'expired', updated_at = now()
     where user_id = uid and status = 'held';
  end if;

  begin
    insert into public.bookings (resource_id, user_id, kind, part, booking_date, slot, status,
                                 hold_expires_at, units, amount, billing, created_by)
    values (p_resource_id, uid, 'desk', p_part, p_date, v_slot, v_status,
            v_expires, v_units, v_amount, v_billing, uid)
    returning * into v_row;
  exception when exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    perform public.raise_booking_conflict(v_constraint);
  end;

  return v_row;
end $$;

create or replace function public.book_room(p_resource_id text, p_start timestamptz, p_hours integer)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  s          public.settings;
  r          public.resources;
  m          record;
  v_admin    boolean := public.is_admin();
  v_local    timestamp := p_start at time zone 'Asia/Kolkata';
  v_date     date := (p_start at time zone 'Asia/Kolkata')::date;
  v_start_h  numeric := extract(hour from (p_start at time zone 'Asia/Kolkata'));
  v_open     integer;
  v_close    integer;
  v_used     numeric;
  v_incl     numeric := 0;
  v_amount   integer := 0;
  v_billing  text;
  v_row      public.bookings;
  v_constraint text;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  select * into s from public.settings;
  select * into r from public.resources where id = p_resource_id and kind = 'room' and is_active;
  if not found then raise exception 'UNKNOWN_ROOM' using errcode = 'P0001'; end if;

  if p_hours is null or p_hours < 1 or p_hours > 9 then raise exception 'BAD_DURATION' using errcode = 'P0001'; end if;
  if p_hours < r.min_hours then raise exception 'MIN_HOURS_%', r.min_hours using errcode = 'P0001'; end if;
  if extract(minute from v_local) <> 0 or extract(second from v_local) <> 0 then
    raise exception 'ON_THE_HOUR' using errcode = 'P0001';
  end if;
  if p_start <= now() then raise exception 'SLOT_OVER' using errcode = 'P0001'; end if;
  if v_date > public.today_ist() + s.booking_window_days then raise exception 'TOO_FAR' using errcode = 'P0001'; end if;
  if extract(isodow from v_date) = 7 then raise exception 'CLOSED_SUNDAY' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtext(uid::text));
  select * into m from public.active_membership(uid, v_date);

  if not v_admin then
    -- Plan-based restrictions: rooms are for members; day passes have no room access.
    if m.membership_id is null or not m.room_access then
      raise exception 'MEMBERS_ONLY' using errcode = 'P0001';
    end if;
  end if;

  -- After-hours restriction: standard hours unless the plan includes after-hours access.
  if v_admin or coalesce(m.after_hours_access, false) then
    v_open := s.after_hours_open; v_close := s.after_hours_close;
  else
    v_open := s.open_hour; v_close := s.close_hour;
  end if;
  if v_start_h < v_open or v_start_h + p_hours > v_close then
    raise exception 'OUTSIDE_HOURS_%_%', v_open, v_close using errcode = 'P0001';
  end if;

  perform public.expire_stale_holds(p_resource_id);

  -- Pricing: free rooms cost nothing; credit rooms use plan hours first, then overage.
  if r.hourly_rate = 0 then
    v_billing := 'free';
  elsif r.uses_credits and m.membership_id is not null then
    select coalesce(sum(units), 0) into v_used
      from public.bookings
     where user_id = uid and kind = 'room' and status = 'confirmed'
       and date_trunc('month', booking_date) = date_trunc('month', v_date);
    v_incl := least(p_hours, greatest(m.room_hours_included - v_used, 0));
    v_amount := ((p_hours - v_incl) * r.hourly_rate)::integer;
    v_billing := case when v_amount > 0 then 'overage' else 'included' end;
  else
    v_amount := p_hours * r.hourly_rate;
    v_billing := 'overage';   -- billed on the member's next invoice
  end if;

  begin
    insert into public.bookings (resource_id, user_id, kind, booking_date, slot, status,
                                 units, amount, billing, created_by)
    values (p_resource_id, uid, 'room', v_date,
            tstzrange(p_start, p_start + make_interval(hours => p_hours), '[)'),
            'confirmed', v_incl, v_amount, v_billing, uid)
    returning * into v_row;
  exception when exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    perform public.raise_booking_conflict(v_constraint);
  end;

  return v_row;
end $$;

create or replace function public.cancel_booking(p_id uuid)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare v_row public.bookings;
begin
  select * into v_row from public.bookings where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if v_row.status not in ('held', 'confirmed') then raise exception 'NOT_ACTIVE' using errcode = 'P0001'; end if;
  if not public.is_admin() and upper(v_row.slot) <= now() then
    raise exception 'SLOT_OVER' using errcode = 'P0001';
  end if;
  update public.bookings
     set status = 'cancelled',
         billing = case when billing = 'paid' then 'refund_due' else billing end,
         updated_at = now()
   where id = p_id
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.check_in(p_id uuid)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare v_row public.bookings;
begin
  select * into v_row from public.bookings where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.user_id <> auth.uid() and not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = 'P0001'; end if;
  if v_row.status <> 'confirmed' then raise exception 'NOT_CONFIRMED' using errcode = 'P0001'; end if;
  if v_row.booking_date <> public.today_ist() then raise exception 'NOT_TODAY' using errcode = 'P0001'; end if;
  update public.bookings set checked_in_at = coalesce(checked_in_at, now()), updated_at = now()
   where id = p_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.check_out(p_id uuid)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare v_row public.bookings;
begin
  select * into v_row from public.bookings where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.user_id <> auth.uid() and not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = 'P0001'; end if;
  if v_row.checked_in_at is null then raise exception 'NOT_CHECKED_IN' using errcode = 'P0001'; end if;
  update public.bookings set checked_out_at = now(), updated_at = now()
   where id = p_id returning * into v_row;
  return v_row;
end $$;

-- Staff: block a seat/room (maintenance, private event). Uses the same
-- no-overlap rule, so it fails if someone already holds that time.
create or replace function public.admin_block(p_resource_id text, p_date date, p_note text default null)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare v_row public.bookings; v_constraint text;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = 'P0001'; end if;
  begin
    insert into public.bookings (resource_id, user_id, kind, booking_date, slot, status, billing, note, created_by)
    values (p_resource_id, auth.uid(), 'block', p_date,
            tstzrange(public.ist(p_date, 0), public.ist(p_date, 24), '[)'),
            'confirmed', 'none', p_note, auth.uid())
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'HAS_BOOKINGS' using errcode = 'P0001';
  end;
  return v_row;
end $$;

-- Server-only: called after a payment is verified (Razorpay or demo).
create or replace function public.confirm_paid_booking(p_id uuid, p_provider text, p_order_id text, p_payment_id text)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_row public.bookings;
  s public.settings;
begin
  select * into s from public.settings;
  select * into v_row from public.bookings where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.status = 'confirmed' then return v_row; end if;   -- idempotent

  begin
    update public.bookings
       set status = 'confirmed', billing = 'paid', hold_expires_at = null,
           payment_ref = p_payment_id, updated_at = now()
     where id = p_id
    returning * into v_row;
    insert into public.payments (booking_id, user_id, provider, order_id, payment_id, amount, gst_amount, status)
    values (p_id, v_row.user_id, p_provider, p_order_id, p_payment_id, v_row.amount,
            round(v_row.amount * s.gst_rate / 100), 'captured');
  exception when exclusion_violation then
    -- hold had lapsed and someone else took the seat: flag for refund
    update public.bookings set billing = 'refund_due', payment_ref = p_payment_id, updated_at = now()
     where id = p_id returning * into v_row;
    insert into public.payments (booking_id, user_id, provider, order_id, payment_id, amount, gst_amount, status)
    values (p_id, v_row.user_id, p_provider, p_order_id, p_payment_id, v_row.amount,
            round(v_row.amount * s.gst_rate / 100), 'refund_due');
  end;
  return v_row;
end $$;

create or replace function public.my_usage(p_month date default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d date := coalesce(p_month, public.today_ist());
  m record;
  v_plan public.plans;
begin
  select * into m from public.active_membership(uid, d);
  if m.membership_id is not null then
    select * into v_plan from public.plans where id = m.plan_id;
  end if;
  return json_build_object(
    'plan_id', m.plan_id,
    'plan_name', v_plan.name,
    'assigned_seat_id', m.assigned_seat_id,
    'desk_days_included', m.desk_days_included,
    'room_hours_included', m.room_hours_included,
    'desk_days_used', (select coalesce(sum(units), 0) from public.bookings
                        where user_id = uid and kind = 'desk' and status = 'confirmed'
                          and billing in ('included', 'overage')
                          and date_trunc('month', booking_date) = date_trunc('month', d)),
    'room_hours_used', (select coalesce(sum(units), 0) from public.bookings
                         where user_id = uid and kind = 'room' and status = 'confirmed'
                           and date_trunc('month', booking_date) = date_trunc('month', d)),
    'overage_amount', (select coalesce(sum(amount), 0) from public.bookings
                        where user_id = uid and status = 'confirmed' and billing = 'overage'
                          and date_trunc('month', booking_date) = date_trunc('month', d))
  );
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.plans        enable row level security;
alter table public.settings     enable row level security;
alter table public.resources    enable row level security;
alter table public.admin_emails enable row level security;
alter table public.profiles     enable row level security;
alter table public.memberships  enable row level security;
alter table public.bookings     enable row level security;
alter table public.payments     enable row level security;
alter table public.occupancy    enable row level security;

create policy "plans readable"      on public.plans     for select using (true);
create policy "plans staff write"   on public.plans     for update using (public.is_admin());
create policy "settings readable"   on public.settings  for select using (true);
create policy "settings staff write" on public.settings for update using (public.is_admin());
create policy "resources readable"  on public.resources for select using (true);
create policy "resources staff write" on public.resources for update using (public.is_admin());
create policy "occupancy readable"  on public.occupancy for select using (true);

create policy "admin emails staff" on public.admin_emails for all
  using (public.is_admin()) with check (public.is_admin());

create policy "own profile"        on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "edit own profile"   on public.profiles for update using (id = auth.uid() or public.is_admin());

create policy "own membership"     on public.memberships for select using (user_id = auth.uid() or public.is_admin());
create policy "staff memberships"  on public.memberships for insert with check (public.is_admin());
create policy "staff memberships u" on public.memberships for update using (public.is_admin());

create policy "own bookings"       on public.bookings for select using (user_id = auth.uid() or public.is_admin());
create policy "own payments"       on public.payments for select using (user_id = auth.uid() or public.is_admin());
-- (no insert/update policies on bookings/payments: all writes go through the functions above)

-- Function permissions
revoke execute on function public.confirm_paid_booking(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.expire_stale_holds(text) from public, anon, authenticated;
revoke execute on function public.sync_role(uuid) from public, anon, authenticated;
grant execute on function public.confirm_paid_booking(uuid, text, text, text) to service_role;
grant execute on function public.expire_stale_holds(text) to service_role;

-- Realtime: broadcast occupancy changes to every open seat map
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.occupancy;
  end if;
end $$;

-- Sweep lapsed payment holds every minute (bookings also sweep on demand)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('expire-seat-holds', '* * * * *', 'select public.expire_stale_holds()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end $$;
