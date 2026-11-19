-- Announcements & closures: admin notices shown as a banner, optionally
-- closing the centre, all desks, all rooms, one zone, or one seat/room
-- for a date range. Bookings inside a closure are refused by the database.

create table if not exists public.announcements (
  id           uuid primary key default gen_random_uuid(),
  message      text not null check (length(trim(message)) between 3 and 200),
  starts_on    date not null,
  ends_on      date not null,
  closure      text not null default 'none'
               check (closure in ('none', 'centre', 'desks', 'rooms', 'zone', 'resource')),
  zone         text,
  resource_id  text references public.resources (id),
  active       boolean not null default true,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (closure <> 'zone' or zone is not null),
  check (closure <> 'resource' or resource_id is not null)
);
create index if not exists announcements_dates_idx on public.announcements (ends_on) where active;

alter table public.announcements enable row level security;
create policy "announcements readable" on public.announcements for select using (true);
create policy "announcements staff insert" on public.announcements for insert with check (public.is_admin());
create policy "announcements staff update" on public.announcements for update using (public.is_admin());
create policy "announcements staff delete" on public.announcements for delete using (public.is_admin());
grant select on public.announcements to anon, authenticated;
grant insert, update, delete on public.announcements to authenticated;
grant all on public.announcements to service_role;

-- "Tomorrow is 80% full" nudge threshold (admin-editable)
alter table public.settings add column if not exists busy_nudge_pct integer not null default 80;

create or replace function public.closure_message(p_resource text, p_date date)
returns text language sql stable security definer set search_path = public as $$
  select a.message
    from public.announcements a
    join public.resources r on r.id = p_resource
   where a.active
     and p_date between a.starts_on and a.ends_on
     and (a.closure = 'centre'
       or (a.closure = 'desks' and r.kind = 'desk')
       or (a.closure = 'rooms' and r.kind = 'room')
       or (a.closure = 'zone' and r.kind = 'desk' and r.zone = a.zone)
       or (a.closure = 'resource' and r.id = a.resource_id))
   order by a.created_at
   limit 1
$$;

create or replace function public.book_desk(p_resource_id text, p_date date, p_part text)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  v_closed   text;
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

  -- Admin closures (holiday, maintenance, zone closed): refuse with the notice text
  v_closed := public.closure_message(p_resource_id, p_date);
  if v_closed is not null then raise exception 'CLOSED|%', v_closed using errcode = 'P0001'; end if;

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
  v_closed   text;
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

  v_closed := public.closure_message(p_resource_id, v_date);
  if v_closed is not null then raise exception 'CLOSED|%', v_closed using errcode = 'P0001'; end if;

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

grant execute on function public.book_desk(text, date, text), public.book_room(text, timestamptz, integer) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.announcements;
  end if;
end $$;
