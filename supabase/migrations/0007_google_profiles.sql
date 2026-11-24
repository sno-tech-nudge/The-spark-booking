-- Google sign-in: fill name and photo from the Google account.
-- (Same email = same account: an invited member who signs in with Google
--  keeps their membership, because Supabase links identities by verified email.)

alter table public.profiles add column if not exists avatar_url text;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    lower(new.email),
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), ''),
    nullif(new.raw_user_meta_data->>'avatar_url', '')
  )
  on conflict (id) do nothing;

  update public.memberships
     set user_id = new.id
   where lower(email) = lower(new.email) and user_id is null;

  perform public.sync_role(new.id);
  return new;
end $$;

-- An existing email account that later signs in with Google: fill in the blanks.
create or replace function public.handle_user_updated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set full_name  = coalesce(full_name, nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), '')),
         avatar_url = coalesce(nullif(new.raw_user_meta_data->>'avatar_url', ''), avatar_url)
   where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of raw_user_meta_data on auth.users
  for each row execute function public.handle_user_updated();
