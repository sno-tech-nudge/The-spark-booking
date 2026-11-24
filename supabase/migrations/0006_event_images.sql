-- Public bucket for event posters. Anyone can view; only staff can upload/replace.
-- (Supabase-only: uses the storage schema, so it isn't part of the PGlite tests.)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-images', 'event-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "event images staff upload" on storage.objects;
drop policy if exists "event images staff update" on storage.objects;
drop policy if exists "event images staff delete" on storage.objects;
create policy "event images staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-images' and public.is_admin());
create policy "event images staff update" on storage.objects for update to authenticated
  using (bucket_id = 'event-images' and public.is_admin());
create policy "event images staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-images' and public.is_admin());
