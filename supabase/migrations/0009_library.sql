/* ------------------------------------------------------------------------ */
/* VideoAI · 0009 · A shared media library                                   */
/*                                                                          */
/* Uploads now stay on the editor's own machine, which frees the project's   */
/* storage for something everyone benefits from: one shared shelf of music,  */
/* sound effects, backgrounds and stock clips that every user can pull from  */
/* without uploading anything.                                              */
/*                                                                          */
/* One copy serves every account, so a hundred megabytes of music costs a    */
/* hundred megabytes — not a hundred megabytes per user.                     */
/*                                                                          */
/* Licence and attribution are columns, not an afterthought: most "free"     */
/* catalogues forbid re-hosting their files inside another product, so what  */
/* goes on this shelf has to be something you have the right to hand on —    */
/* CC0, public domain, your own recordings, or CC-BY with the credit shown.  */
/* ------------------------------------------------------------------------ */

create table if not exists public.library_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('video', 'audio', 'image')),
  name text not null,
  /* Free-text tags, searched together with the name. */
  tags text[] not null default '{}',
  category text not null default 'other',
  storage_path text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  duration_seconds numeric not null default 0,
  width integer,
  height integer,
  has_audio boolean not null default false,
  thumbnail_url text,
  /* Where it came from and what you may do with it. */
  license text not null default 'CC0',
  attribution text,
  source_url text,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists library_assets_kind_idx on public.library_assets(kind);
create index if not exists library_assets_category_idx on public.library_assets(category);
create index if not exists library_assets_tags_idx on public.library_assets using gin(tags);

comment on table public.library_assets is
  'The shared media shelf: one copy of each file, readable by every signed-in user, curated by admins.';
comment on column public.library_assets.license is
  'What the file may be used for. Only put things here you have the right to redistribute — CC0, public domain, your own work, or CC-BY with attribution filled in.';
comment on column public.library_assets.attribution is
  'Credit line to show in the app and to include with an export when the licence requires it.';

alter table public.library_assets enable row level security;

drop policy if exists "library is readable by signed-in users" on public.library_assets;
create policy "library is readable by signed-in users"
  on public.library_assets for select
  to authenticated
  using (true);

drop policy if exists "only admins add to the library" on public.library_assets;
create policy "only admins add to the library"
  on public.library_assets for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "only admins change the library" on public.library_assets;
create policy "only admins change the library"
  on public.library_assets for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "only admins remove from the library" on public.library_assets;
create policy "only admins remove from the library"
  on public.library_assets for delete
  to authenticated
  using (public.is_admin());

/* ------------------------------------------------------------------------ */
/* The bucket                                                               */
/* ------------------------------------------------------------------------ */
insert into storage.buckets (id, name, public, file_size_limit)
values ('library', 'library', true, null)
on conflict (id) do update set public = true, file_size_limit = null;

drop policy if exists "library files are public" on storage.objects;
create policy "library files are public"
  on storage.objects for select
  using (bucket_id = 'library');

drop policy if exists "admins upload library files" on storage.objects;
create policy "admins upload library files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'library' and public.is_admin());

drop policy if exists "admins replace library files" on storage.objects;
create policy "admins replace library files"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'library' and public.is_admin());

drop policy if exists "admins delete library files" on storage.objects;
create policy "admins delete library files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'library' and public.is_admin());

/* ------------------------------------------------------------------------ */
/* Admin view                                                               */
/* ------------------------------------------------------------------------ */
create or replace view public.admin_library
with (security_invoker = true) as
select
  l.id,
  l.kind,
  l.name,
  l.category,
  l.tags,
  l.license,
  l.attribution,
  l.source_url,
  l.size_bytes,
  l.duration_seconds,
  l.created_at,
  u.email as added_by_email
from public.library_assets l
left join auth.users u on u.id = l.added_by
where public.is_admin();

comment on view public.admin_library is 'Everything on the shared shelf, with who put it there. Admins only.';

/* ------------------------------------------------------------------------ */
/* Media assets may now point at a local file or the library                */
/* ------------------------------------------------------------------------ */
comment on column public.media_assets.storage_path is
  'Where the bytes are. A plain path lives in the media bucket; "local:<id>" is on the editor''s own machine; "library:<path>" is the shared shelf; "sfx:<name>" and "music:<name>" are synthesised in the browser and stored nowhere.';
