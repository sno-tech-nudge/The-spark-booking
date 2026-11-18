-- the*spark centre — starting data (from "requirements for coworking mgmt s/w")
-- All prices INR, excluding GST. Safe to re-run.

insert into public.settings (id) values (true) on conflict (id) do nothing;

insert into public.plans (id, name, description, monthly_price, desk_days_included, room_hours_included,
                          room_access, after_hours_access, assigned_seat, self_serve, sort) values
  ('fixed',   'Fixed Desk',   'Assigned seat, full-time. Contract members only.', 15000, null, 5, true, true,  true,  false, 1),
  ('flexi',   'Flexi Desk',   'Hot desk, full-time access.',                     12000, null, 5, true, false, false, true,  2),
  ('limited', 'Limited Plan', '12 desk days a month.',                            9000, 12,   2, true, false, false, true,  3)
on conflict (id) do update set
  name = excluded.name, description = excluded.description, monthly_price = excluded.monthly_price,
  desk_days_included = excluded.desk_days_included, room_hours_included = excluded.room_hours_included,
  room_access = excluded.room_access, after_hours_access = excluded.after_hours_access,
  assigned_seat = excluded.assigned_seat, self_serve = excluded.self_serve, sort = excluded.sort;

-- 127 open-plan seats: zones A–C have 4 tables of 8, zone D has 3 tables of 8 and one of 7.
insert into public.resources (id, kind, category, name, zone, table_no, sort)
select z.zone || '-' || lpad(n::text, 2, '0'), 'desk', 'desk',
       'Seat ' || z.zone || '-' || lpad(n::text, 2, '0'), z.zone, ((n - 1) / 8) + 1,
       z.ord * 100 + n
from (values ('A', 1, 32), ('B', 2, 32), ('C', 3, 32), ('D', 4, 31)) as z(zone, ord, seats)
cross join lateral generate_series(1, z.seats) as n
on conflict (id) do nothing;

insert into public.resources (id, kind, category, name, capacity, hourly_rate, members_only, uses_credits, min_hours, amenities, sort) values
  ('LW-1',  'room', 'lounge',      'Lounge Workstation 1',     1,  0,    true,  false, 1, '{wifi}',                          10),
  ('LW-2',  'room', 'lounge',      'Lounge Workstation 2',     1,  0,    true,  false, 1, '{wifi}',                          11),
  ('MR4-1', 'room', 'meeting',     'Meeting Room · 4 PAX',     4,  500,  false, true,  1, '{screen}',                        20),
  ('MR6-1', 'room', 'meeting',     'Meeting Room · 6 PAX (1)', 6,  750,  false, true,  1, '{screen,whiteboard}',             21),
  ('MR6-2', 'room', 'meeting',     'Meeting Room · 6 PAX (2)', 6,  750,  false, true,  1, '{screen,whiteboard}',             22),
  ('MR10-1','room', 'meeting',     'Meeting Room · 8–10 PAX',  10, 1000, false, true,  1, '{screen,whiteboard,video}',       23),
  ('PB-1',  'room', 'phone_booth', 'Phone Booth 1',            1,  0,    true,  false, 1, '{video}',                         30),
  ('PB-2',  'room', 'phone_booth', 'Phone Booth 2',            1,  0,    true,  false, 1, '{video}',                         31),
  ('PB-3',  'room', 'phone_booth', 'Phone Booth 3',            1,  0,    true,  false, 1, '{video}',                         32),
  ('POD-1', 'room', 'podcast',     'Podcast Room',             4,  2500, false, false, 2, '{mics,soundproofing,video}',      40)
on conflict (id) do update set
  name = excluded.name, capacity = excluded.capacity, hourly_rate = excluded.hourly_rate,
  members_only = excluded.members_only, uses_credits = excluded.uses_credits,
  min_hours = excluded.min_hours, amenities = excluded.amenities, sort = excluded.sort;
