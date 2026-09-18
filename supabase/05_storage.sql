-- =====================================================
-- Badr Grappling — storage
-- One public bucket for images on appeals and updates.
-- Anyone can view; only admins can upload or remove.
-- =====================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists media_public_read  on storage.objects;
drop policy if exists media_admin_insert on storage.objects;
drop policy if exists media_admin_update on storage.objects;
drop policy if exists media_admin_delete on storage.objects;

create policy media_public_read on storage.objects
  for select using (bucket_id = 'media');

create policy media_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'media' and public.is_admin());

create policy media_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'media' and public.is_admin());

create policy media_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'media' and public.is_admin());

-- Videos stay on unlisted YouTube for now (see js/video-source.js).
-- When they move to storage, create a *private* 'videos' bucket with a
-- select policy of public.is_active_member() and serve signed URLs.
