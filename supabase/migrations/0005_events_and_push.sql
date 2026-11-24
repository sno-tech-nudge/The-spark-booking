-- ============================================================================
-- Events & RSVPs (with capacity, member/guest prices, paid tickets, waitlist)
-- and Web Push subscriptions.
--
-- Capacity is enforced inside rsvp_event(): it locks the event row, so two
-- people can never take the last spot at the same time.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Push notifications
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "own push subs read"   on public.push_subscriptions for select using (user_id = auth.uid());
create policy "own push subs add"    on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy "own push subs update" on public.push_subscriptions for update using (user_id = auth.uid());
create policy "own push subs remove" on public.push_subscriptions for delete using (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- every notification sent, keyed so the same reminder is never sent twice
create table if not exists public.notification_log (
  key      text primary key,
  user_id  uuid references public.profiles (id) on delete cascade,
  title    text,
  body     text,
  url      text,
  sent_at  timestamptz not null default now()
);
alter table public.notification_log enable row level security;
create policy "own notifications" on public.notification_log for select using (user_id = auth.uid());
grant select on public.notification_log to authenticated;
grant all on public.notification_log to service_role;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9-]{3,90}$'),
  title           text not null check (length(trim(title)) between 3 and 120),
  tagline         text,
  description     text not null default '',
  category        text not null default 'Community'
                  check (category in ('Networking', 'Workshop', 'Talk', 'Community', 'Showcase', 'Wellness')),
  host_name       text not null,
  host_org        text,
  image_url       text,
  venue           text not null default 'Event space · the*spark Pullur Centre',
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  capacity        integer not null check (capacity between 1 and 500),
  member_price    integer not null default 0 check (member_price >= 0),
  guest_price     integer not null default 0 check (guest_price >= 0),
  rsvp_closes_at  timestamptz,
  status          text not null default 'published' check (status in ('draft', 'published', 'cancelled')),
  going_count     integer not null default 0,    -- going + held (spots taken)
  waitlist_count  integer not null default 0,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists events_starts_idx on public.events (starts_at) where status = 'published';

create table if not exists public.event_rsvps (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  status           text not null check (status in ('going', 'held', 'waitlist', 'cancelled', 'expired')),
  ticket_type      text not null check (ticket_type in ('member', 'guest')),
  amount           integer not null default 0,
  billing          text not null default 'free' check (billing in ('free', 'pending_payment', 'paid', 'refund_due')),
  hold_expires_at  timestamptz,
  payment_ref      text,
  promoted_at      timestamptz,
  checked_in_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists event_rsvps_one_live
  on public.event_rsvps (event_id, user_id) where status in ('going', 'held', 'waitlist');
create index if not exists event_rsvps_event_idx on public.event_rsvps (event_id, status, created_at);
create index if not exists event_rsvps_user_idx on public.event_rsvps (user_id);

alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
create policy "events readable" on public.events for select using (status <> 'draft' or public.is_admin());
create policy "events staff insert" on public.events for insert with check (public.is_admin());
create policy "events staff update" on public.events for update using (public.is_admin());
create policy "events staff delete" on public.events for delete using (public.is_admin());
create policy "own rsvps" on public.event_rsvps for select using (user_id = auth.uid() or public.is_admin());
grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;
grant select on public.event_rsvps to authenticated;
grant all on public.events, public.event_rsvps to service_role;

-- tickets can be paid for like seats
alter table public.payments alter column booking_id drop not null;
alter table public.payments add column if not exists rsvp_id uuid references public.event_rsvps (id) on delete cascade;
do $$ begin
  alter table public.payments add constraint payments_target check (booking_id is not null or rsvp_id is not null);
exception when duplicate_object then null; end $$;

-- keep the public counters on events in step (they drive "12 spots left" live)
create or replace function public.refresh_event_counts(p_event uuid)
returns void language sql security definer set search_path = public as $$
  update public.events e set
    going_count    = (select count(*) from public.event_rsvps r where r.event_id = e.id and r.status in ('going', 'held')),
    waitlist_count = (select count(*) from public.event_rsvps r where r.event_id = e.id and r.status = 'waitlist')
  where e.id = p_event
$$;

create or replace function public.event_rsvps_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_event_counts(coalesce(new.event_id, old.event_id));
  return null;
end $$;

drop trigger if exists event_rsvps_after on public.event_rsvps;
create trigger event_rsvps_after
  after insert or update or delete on public.event_rsvps
  for each row execute function public.event_rsvps_after();

-- Fill free spots from the waitlist, oldest first. Free tickets go straight to
-- "going"; paid ones get a 2-hour hold to pay (the app pushes "you're in").
create or replace function public.promote_waitlist(p_event uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  e public.events;
  w public.event_rsvps;
  v_taken integer;
  v_price integer;
  n integer := 0;
begin
  select * into e from public.events where id = p_event for update;
  if not found or e.status <> 'published' or e.starts_at <= now() then return 0; end if;
  loop
    select count(*) into v_taken from public.event_rsvps
     where event_id = p_event and status in ('going', 'held');
    exit when v_taken >= e.capacity;
    select * into w from public.event_rsvps
     where event_id = p_event and status = 'waitlist'
     order by created_at limit 1 for update;
    exit when not found;
    v_price := case w.ticket_type when 'member' then e.member_price else e.guest_price end;
    if v_price = 0 then
      update public.event_rsvps set status = 'going', billing = 'free', amount = 0,
             promoted_at = now(), updated_at = now() where id = w.id;
    else
      update public.event_rsvps set status = 'held', billing = 'pending_payment', amount = v_price,
             hold_expires_at = least(now() + interval '2 hours', e.starts_at),
             promoted_at = now(), updated_at = now() where id = w.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Lapsed ticket holds free their spot (and the waitlist moves up).
create or replace function public.expire_event_holds(p_event uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_ev uuid;
  n integer := 0;
begin
  for v_ev in
    update public.event_rsvps set status = 'expired', updated_at = now()
     where status = 'held' and hold_expires_at < now() and (p_event is null or event_id = p_event)
    returning event_id
  loop
    n := n + 1;
  end loop;
  for v_ev in
    select distinct event_id from public.event_rsvps
     where status = 'waitlist' and (p_event is null or event_id = p_event)
  loop
    perform public.promote_waitlist(v_ev);
  end loop;
  return n;
end $$;

create or replace function public.rsvp_event(p_event_id uuid)
returns public.event_rsvps
language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  e        public.events;
  s        public.settings;
  v_row    public.event_rsvps;
  v_member boolean;
  v_type   text;
  v_price  integer;
  v_taken  integer;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  -- one at a time per event: this lock is what makes "no overselling" exact
  select * into e from public.events where id = p_event_id for update;
  if not found or e.status <> 'published' then raise exception 'EVENT_UNAVAILABLE' using errcode = 'P0001'; end if;
  if e.starts_at <= now() then raise exception 'EVENT_STARTED' using errcode = 'P0001'; end if;
  if e.rsvp_closes_at is not null and now() > e.rsvp_closes_at then raise exception 'RSVP_CLOSED' using errcode = 'P0001'; end if;

  perform public.expire_event_holds(p_event_id);

  select * into v_row from public.event_rsvps
   where event_id = p_event_id and user_id = uid and status in ('going', 'held', 'waitlist');
  if found then return v_row; end if;   -- already in: idempotent

  select * into s from public.settings;
  v_member := exists (select 1 from public.active_membership(uid, (e.starts_at at time zone 'Asia/Kolkata')::date));
  v_type := case when v_member then 'member' else 'guest' end;
  v_price := case when v_member then e.member_price else e.guest_price end;

  select count(*) into v_taken from public.event_rsvps
   where event_id = p_event_id and status in ('going', 'held');

  if v_taken < e.capacity then
    if v_price = 0 then
      insert into public.event_rsvps (event_id, user_id, status, ticket_type, amount, billing)
      values (p_event_id, uid, 'going', v_type, 0, 'free') returning * into v_row;
    else
      insert into public.event_rsvps (event_id, user_id, status, ticket_type, amount, billing, hold_expires_at)
      values (p_event_id, uid, 'held', v_type, v_price, 'pending_payment',
              least(now() + make_interval(mins => s.hold_minutes), e.starts_at))
      returning * into v_row;
    end if;
  else
    insert into public.event_rsvps (event_id, user_id, status, ticket_type, amount, billing)
    values (p_event_id, uid, 'waitlist', v_type, v_price, case when v_price = 0 then 'free' else 'pending_payment' end)
    returning * into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.cancel_rsvp(p_id uuid)
returns public.event_rsvps
language plpgsql security definer set search_path = public as $$
declare
  v_row public.event_rsvps;
  v_event uuid;
begin
  select event_id into v_event from public.event_rsvps where id = p_id;
  if v_event is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform 1 from public.events where id = v_event for update;   -- same lock order as rsvp_event
  select * into v_row from public.event_rsvps where id = p_id for update;
  if v_row.user_id <> auth.uid() and not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = 'P0001'; end if;
  if v_row.status not in ('going', 'held', 'waitlist') then raise exception 'NOT_ACTIVE' using errcode = 'P0001'; end if;
  update public.event_rsvps
     set status = 'cancelled',
         billing = case when billing = 'paid' then 'refund_due' else billing end,
         updated_at = now()
   where id = p_id returning * into v_row;
  perform public.promote_waitlist(v_event);
  return v_row;
end $$;

-- Server only (after Razorpay / demo payment): held ticket → going.
create or replace function public.confirm_paid_rsvp(p_id uuid, p_provider text, p_order_id text, p_payment_id text)
returns public.event_rsvps
language plpgsql security definer set search_path = public as $$
declare
  v_row public.event_rsvps;
  s public.settings;
  v_pay text;
begin
  select * into s from public.settings;
  select * into v_row from public.event_rsvps where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.status = 'going' then return v_row; end if;
  if v_row.status = 'held' then
    update public.event_rsvps set status = 'going', billing = 'paid', hold_expires_at = null,
           payment_ref = p_payment_id, updated_at = now()
     where id = p_id returning * into v_row;
    v_pay := 'captured';
  else
    -- hold lapsed and the spot moved on: refund
    update public.event_rsvps set billing = 'refund_due', payment_ref = p_payment_id, updated_at = now()
     where id = p_id returning * into v_row;
    v_pay := 'refund_due';
  end if;
  update public.payments set status = v_pay, payment_id = p_payment_id
   where rsvp_id = p_id and order_id = p_order_id;
  if not found then
    insert into public.payments (rsvp_id, user_id, provider, order_id, payment_id, amount, gst_amount, status)
    values (p_id, v_row.user_id, p_provider, p_order_id, p_payment_id, v_row.amount,
            round(v_row.amount * s.gst_rate / 100), v_pay);
  end if;
  return v_row;
end $$;

create or replace function public.event_check_in(p_id uuid, p_in boolean default true)
returns public.event_rsvps
language plpgsql security definer set search_path = public as $$
declare v_row public.event_rsvps;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = 'P0001'; end if;
  update public.event_rsvps set checked_in_at = case when p_in then coalesce(checked_in_at, now()) end, updated_at = now()
   where id = p_id and status = 'going' returning * into v_row;
  if not found then raise exception 'NOT_ACTIVE' using errcode = 'P0001'; end if;
  return v_row;
end $$;

revoke execute on function public.promote_waitlist(uuid) from public, anon, authenticated;
revoke execute on function public.expire_event_holds(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_event_counts(uuid) from public, anon, authenticated;
revoke execute on function public.confirm_paid_rsvp(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_paid_rsvp(uuid, text, text, text) to service_role;
grant execute on function public.expire_event_holds(uuid) to service_role;
grant execute on function public.rsvp_event(uuid), public.cancel_rsvp(uuid), public.event_check_in(uuid, boolean) to authenticated;

-- live "spots left" everywhere
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.events;
  end if;
exception when duplicate_object then null;
end $$;
