-- Table privileges for the API roles. Newer Supabase projects don't grant these
-- by default; row level security (0001) still decides which rows each person sees.

grant usage on schema public to anon, authenticated, service_role;

-- public reference data + the anonymous live seat map
grant select on public.plans, public.settings, public.resources, public.occupancy to anon, authenticated;

-- signed-in people (RLS limits them to their own rows; staff see all)
grant select on public.profiles, public.memberships, public.bookings, public.payments, public.admin_emails to authenticated;
grant update (full_name, phone, organisation) on public.profiles to authenticated;

-- staff-only writes (RLS policies require is_admin())
grant insert, update on public.memberships to authenticated;
grant update on public.plans, public.settings, public.resources to authenticated;
grant insert, delete on public.admin_emails to authenticated;

-- server routes
grant all on all tables in schema public to service_role;

-- booking API
grant execute on function
  public.book_desk(text, date, text),
  public.book_room(text, timestamptz, integer),
  public.cancel_booking(uuid),
  public.check_in(uuid),
  public.check_out(uuid),
  public.admin_block(text, date, text),
  public.my_usage(date)
to authenticated;
