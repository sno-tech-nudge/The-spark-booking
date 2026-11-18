-- 10-minute checkout window (like BookMyShow / District) and private calendar feeds.

alter table public.settings alter column hold_minutes set default 10;
update public.settings set hold_minutes = 10 where hold_minutes < 10;

-- One secret feed URL per person: /api/calendar/<token>  (Google / Apple "subscribe by URL")
create table if not exists public.calendar_tokens (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  token      text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table public.calendar_tokens enable row level security;
-- no policies: read only through the function below or the server (service role)
grant all on public.calendar_tokens to service_role;

create or replace function public.my_calendar_token(p_reset boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  if p_reset then delete from public.calendar_tokens where user_id = auth.uid(); end if;
  insert into public.calendar_tokens (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select token into t from public.calendar_tokens where user_id = auth.uid();
  return t;
end $$;

revoke execute on function public.my_calendar_token(boolean) from public, anon;
grant execute on function public.my_calendar_token(boolean) to authenticated;
