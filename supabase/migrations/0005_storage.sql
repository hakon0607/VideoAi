-- ===========================================================================
-- VideoAI · 0005 · Storage buckets and policies
-- ---------------------------------------------------------------------------
-- Layout, enforced by both the app and these policies:
--   media/user/{userId}/projects/{projectId}/media/{assetId}.{ext}
--   exports/user/{userId}/projects/{projectId}/{exportId}.mp4
--   avatars/{userId}/{filename}
--
-- The first two buckets are private; the app hands out short-lived signed URLs.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', false, 2147483648,
  array[
    'video/mp4','video/quicktime','video/webm','video/x-msvideo','video/avi','video/x-matroska',
    'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/x-m4a','audio/aac','audio/ogg','audio/webm',
    'image/png','image/jpeg','image/gif','image/webp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('exports', 'exports', false, 5368709120)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = excluded.public;

-- ---------------------------------------------------------------------------
-- media + exports: a user only ever touches their own user/{uid}/ prefix
-- ---------------------------------------------------------------------------
do $$
declare
  b text;
begin
  foreach b in array array['media', 'exports'] loop
    execute format('drop policy if exists "%s read own" on storage.objects', b);
    execute format($p$
      create policy "%1$s read own" on storage.objects for select to authenticated
      using (
        bucket_id = %1$L
        and (storage.foldername(name))[1] = 'user'
        and (storage.foldername(name))[2] = auth.uid()::text
      )$p$, b);

    execute format('drop policy if exists "%s insert own" on storage.objects', b);
    execute format($p$
      create policy "%1$s insert own" on storage.objects for insert to authenticated
      with check (
        bucket_id = %1$L
        and (storage.foldername(name))[1] = 'user'
        and (storage.foldername(name))[2] = auth.uid()::text
      )$p$, b);

    execute format('drop policy if exists "%s update own" on storage.objects', b);
    execute format($p$
      create policy "%1$s update own" on storage.objects for update to authenticated
      using (
        bucket_id = %1$L
        and (storage.foldername(name))[1] = 'user'
        and (storage.foldername(name))[2] = auth.uid()::text
      )$p$, b);

    execute format('drop policy if exists "%s delete own" on storage.objects', b);
    execute format($p$
      create policy "%1$s delete own" on storage.objects for delete to authenticated
      using (
        bucket_id = %1$L
        and (storage.foldername(name))[1] = 'user'
        and (storage.foldername(name))[2] = auth.uid()::text
      )$p$, b);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- avatars: world readable, writable only inside your own folder
-- ---------------------------------------------------------------------------
drop policy if exists "avatars are public" on storage.objects;
create policy "avatars are public" on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars write own" on storage.objects;
create policy "avatars write own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
