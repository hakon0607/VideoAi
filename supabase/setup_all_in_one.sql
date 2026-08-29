-- ===========================================================================
-- VideoAI · complete setup
-- ---------------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL editor and run it.
-- It is every migration in supabase/migrations/ concatenated in order, and it
-- is safe to run more than once.
-- ===========================================================================


-- ==================== 0001_schema.sql ====================

-- ===========================================================================
-- VideoAI · 0001 · Core schema
-- ---------------------------------------------------------------------------
-- Design notes
--   * Everything is keyed by UUID and carries created_at / updated_at.
--   * Structured, queryable data lives in real columns and real tables.
--   * Genuinely free-form data (transforms, text styles, effect parameters,
--     transcripts) lives in JSONB, because those shapes evolve with the editor
--     and would otherwise need a migration per feature.
--   * Views (text_elements, audio_elements, captions, transitions) expose the
--     clip table through the vocabulary of the editor.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  avatar_url text,
  locale text not null default 'en' check (locale in ('en', 'nb')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_.-]{3,32}$')
);

create index if not exists profiles_user_id_idx on public.profiles(user_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled project',
  description text,
  aspect_ratio text not null default '16:9'
    check (aspect_ratio in ('16:9', '9:16', '1:1', '4:5', '4:3', '21:9')),
  width integer not null default 1920 check (width between 64 and 7680),
  height integer not null default 1080 check (height between 64 and 4320),
  fps numeric(6,3) not null default 30 check (fps between 1 and 120),
  background_color text not null default '#000000',
  sample_rate integer not null default 48000,
  export_format text not null default 'mp4' check (export_format in ('mp4', 'webm')),
  export_quality text not null default 'high'
    check (export_quality in ('low', 'medium', 'high', 'very_high')),
  thumbnail_path text,
  duration_seconds numeric(12,3) not null default 0,
  is_demo boolean not null default false,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_idx on public.projects(owner_id, updated_at desc);
create index if not exists projects_name_idx on public.projects using gin (to_tsvector('simple', name));

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- project_members  (collaboration; the owner is always an implicit member)
-- ---------------------------------------------------------------------------
create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists project_members_user_idx on public.project_members(user_id);

-- ---------------------------------------------------------------------------
-- media_assets
-- ---------------------------------------------------------------------------
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('video', 'audio', 'image')),
  name text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  duration_seconds numeric(12,3) not null default 0,
  width integer,
  height integer,
  fps numeric(6,3),
  has_audio boolean not null default false,
  sample_rate integer,
  channels integer,
  -- Normalised 0..1 peaks used to draw the waveform in the timeline.
  waveform jsonb,
  thumbnail_url text,
  analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'basic', 'transcribing', 'analyzed', 'failed')),
  analysis_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_assets_project_idx on public.media_assets(project_id, created_at desc);
-- Duplicated projects share the same storage object, so this is not unique.
create index if not exists media_assets_storage_idx on public.media_assets(storage_path);

drop trigger if exists media_assets_set_updated_at on public.media_assets;
create trigger media_assets_set_updated_at
  before update on public.media_assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- media_analysis  (transcript, silences, loudness)
-- ---------------------------------------------------------------------------
create table if not exists public.media_analysis (
  asset_id uuid primary key references public.media_assets(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  language text,
  transcript_text text,
  -- [{ word, start, end }]
  words jsonb not null default '[]'::jsonb,
  -- [{ id, start, end, text }]
  segments jsonb not null default '[]'::jsonb,
  -- [{ start, end }] detected locally from the decoded waveform
  silences jsonb not null default '[]'::jsonb,
  loudness_db numeric(8,3),
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists media_analysis_set_updated_at on public.media_analysis;
create trigger media_analysis_set_updated_at
  before update on public.media_analysis
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- timelines / tracks / clips
-- ---------------------------------------------------------------------------
create table if not exists public.timelines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null default 'Main',
  is_primary boolean not null default true,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists timelines_primary_idx
  on public.timelines(project_id) where is_primary;

drop trigger if exists timelines_set_updated_at on public.timelines;
create trigger timelines_set_updated_at
  before update on public.timelines
  for each row execute function public.set_updated_at();

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  timeline_id uuid not null references public.timelines(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('video', 'audio', 'text', 'overlay')),
  name text not null,
  layer_index integer not null default 0,
  muted boolean not null default false,
  hidden boolean not null default false,
  locked boolean not null default false,
  volume numeric(5,3) not null default 1 check (volume between 0 and 4),
  height integer not null default 68,
  created_at timestamptz not null default now()
);

create index if not exists tracks_timeline_idx on public.tracks(timeline_id, layer_index);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  timeline_id uuid not null references public.timelines(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_id uuid references public.media_assets(id) on delete cascade,
  kind text not null check (kind in ('video', 'audio', 'image', 'text')),
  role text not null default 'default' check (role in ('default', 'caption')),
  group_id uuid,
  name text not null default 'Clip',
  start_time numeric(12,4) not null default 0 check (start_time >= 0),
  duration numeric(12,4) not null check (duration > 0),
  source_in numeric(12,4) not null default 0,
  speed numeric(8,4) not null default 1 check (speed > 0),
  reversed boolean not null default false,
  freeze_frame boolean not null default false,
  volume numeric(5,3) not null default 1 check (volume between 0 and 4),
  muted boolean not null default false,
  fade_in numeric(8,3) not null default 0,
  fade_out numeric(8,3) not null default 0,
  opacity numeric(5,3) not null default 1 check (opacity between 0 and 1),
  locked boolean not null default false,
  -- { x, y, scale, rotation, flipH, flipV }
  transform jsonb not null default '{"x":0,"y":0,"scale":1,"rotation":0,"flipH":false,"flipV":false}'::jsonb,
  -- { left, top, right, bottom } or null
  crop jsonb,
  -- text clips only
  text_content text,
  text_style jsonb,
  text_animation text,
  -- { id, type, duration, params } or null
  transition_in jsonb,
  transition_out jsonb,
  created_at timestamptz not null default now(),
  constraint media_clips_need_asset
    check (kind = 'text' or asset_id is not null),
  constraint text_clips_need_content
    check (kind <> 'text' or text_content is not null)
);

create index if not exists clips_timeline_idx on public.clips(timeline_id, start_time);
create index if not exists clips_track_idx on public.clips(track_id, start_time);
create index if not exists clips_group_idx on public.clips(group_id) where group_id is not null;
create index if not exists clips_asset_idx on public.clips(asset_id);

-- ---------------------------------------------------------------------------
-- effects / keyframes
-- ---------------------------------------------------------------------------
create table if not exists public.effects (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null,
  enabled boolean not null default true,
  order_index integer not null default 0,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists effects_clip_idx on public.effects(clip_id, order_index);
create index if not exists effects_type_idx on public.effects(project_id, type);

create table if not exists public.keyframes (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  property text not null,
  time_offset numeric(12,4) not null check (time_offset >= 0),
  value double precision not null,
  easing text not null default 'ease_in_out'
    check (easing in ('linear', 'ease_in', 'ease_out', 'ease_in_out', 'hold')),
  created_at timestamptz not null default now()
);

create index if not exists keyframes_clip_idx on public.keyframes(clip_id, property, time_offset);

-- ---------------------------------------------------------------------------
-- Editor-vocabulary views over the clip table
-- ---------------------------------------------------------------------------
create or replace view public.text_elements as
  select id, project_id, timeline_id, track_id, name, start_time, duration,
         text_content, text_style, text_animation, transform, opacity, role, group_id
  from public.clips
  where kind = 'text';

create or replace view public.captions as
  select id, project_id, timeline_id, track_id, group_id, start_time, duration,
         start_time + duration as end_time, text_content, text_style
  from public.clips
  where kind = 'text' and role = 'caption';

create or replace view public.audio_elements as
  select id, project_id, timeline_id, track_id, asset_id, name, start_time, duration,
         source_in, speed, volume, muted, fade_in, fade_out
  from public.clips
  where kind in ('audio', 'video');

create or replace view public.transitions as
  select id as clip_id, project_id, timeline_id, track_id, 'in' as edge,
         transition_in ->> 'type' as type,
         (transition_in ->> 'duration')::numeric as duration,
         transition_in -> 'params' as params
  from public.clips where transition_in is not null
  union all
  select id as clip_id, project_id, timeline_id, track_id, 'out' as edge,
         transition_out ->> 'type' as type,
         (transition_out ->> 'duration')::numeric as duration,
         transition_out -> 'params' as params
  from public.clips where transition_out is not null;

-- ---------------------------------------------------------------------------
-- editor_history  (audit trail; in-session undo/redo lives in the client)
-- ---------------------------------------------------------------------------
create table if not exists public.editor_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  timeline_id uuid references public.timelines(id) on delete cascade,
  label text not null,
  source text not null default 'user' check (source in ('user', 'ai', 'system')),
  -- The exact validated commands that were executed, in order.
  actions jsonb not null default '[]'::jsonb,
  descriptions jsonb not null default '[]'::jsonb,
  ai_message_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists editor_history_project_idx
  on public.editor_history(project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- AI conversations
-- ---------------------------------------------------------------------------
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Assistant',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_project_idx
  on public.ai_conversations(project_id, updated_at desc);

drop trigger if exists ai_conversations_set_updated_at on public.ai_conversations;
create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row execute function public.set_updated_at();

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null default '',
  -- The validated editor actions this message produced, for the AI change log.
  actions jsonb not null default '[]'::jsonb,
  descriptions jsonb not null default '[]'::jsonb,
  status text not null default 'complete' check (status in ('complete', 'failed', 'needs_confirmation')),
  error text,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  credits_charged integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_idx
  on public.ai_messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- exports
-- ---------------------------------------------------------------------------
create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'rendering', 'completed', 'failed', 'cancelled')),
  progress numeric(5,4) not null default 0 check (progress between 0 and 1),
  engine text not null default 'browser' check (engine in ('browser', 'server')),
  settings jsonb not null default '{}'::jsonb,
  output_path text,
  size_bytes bigint,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists exports_project_idx on public.exports(project_id, created_at desc);

-- ==================== 0002_rls.sql ====================

-- ===========================================================================
-- VideoAI · 0002 · Row Level Security
-- ---------------------------------------------------------------------------
-- Every table that holds user data is locked down here. The frontend is never
-- trusted: even with a stolen anon key, a user can only ever reach rows that
-- belong to a project they own or have been explicitly added to.
--
-- Access is decided by two SECURITY DEFINER helpers. They are SECURITY DEFINER
-- on purpose: project_members policies would otherwise recurse into themselves.
-- ===========================================================================

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.owner_id = auth.uid()
  ) or exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_project(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.owner_id = auth.uid()
  ) or exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'editor')
  );
$$;

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.owner_id = auth.uid()
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce((select pr.is_admin from public.profiles pr where pr.user_id = auth.uid()), false);
$$;

revoke all on function public.is_project_member(uuid) from public;
revoke all on function public.can_edit_project(uuid) from public;
revoke all on function public.is_project_owner(uuid) from public;
grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.can_edit_project(uuid) to authenticated;
grant execute on function public.is_project_owner(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.projects           enable row level security;
alter table public.project_members    enable row level security;
alter table public.media_assets       enable row level security;
alter table public.media_analysis     enable row level security;
alter table public.timelines          enable row level security;
alter table public.tracks             enable row level security;
alter table public.clips              enable row level security;
alter table public.effects            enable row level security;
alter table public.keyframes          enable row level security;
alter table public.editor_history     enable row level security;
alter table public.ai_conversations   enable row level security;
alter table public.ai_messages        enable row level security;
alter table public.exports            enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists "profiles are readable by their owner" on public.profiles;
create policy "profiles are readable by their owner"
  on public.profiles for select
  using (user_id = auth.uid());

drop policy if exists "users insert their own profile" on public.profiles;
create policy "users insert their own profile"
  on public.profiles for insert
  with check (user_id = auth.uid());

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- projects ------------------------------------------------------------------
drop policy if exists "read own or shared projects" on public.projects;
create policy "read own or shared projects"
  on public.projects for select
  using (owner_id = auth.uid() or public.is_project_member(id));

drop policy if exists "create own projects" on public.projects;
create policy "create own projects"
  on public.projects for insert
  with check (owner_id = auth.uid());

drop policy if exists "update own or shared projects" on public.projects;
create policy "update own or shared projects"
  on public.projects for update
  using (owner_id = auth.uid() or public.can_edit_project(id))
  with check (owner_id = auth.uid() or public.can_edit_project(id));

drop policy if exists "only the owner deletes a project" on public.projects;
create policy "only the owner deletes a project"
  on public.projects for delete
  using (owner_id = auth.uid());

-- project_members -----------------------------------------------------------
drop policy if exists "members are visible to the project" on public.project_members;
create policy "members are visible to the project"
  on public.project_members for select
  using (user_id = auth.uid() or public.is_project_owner(project_id));

drop policy if exists "owners manage members" on public.project_members;
create policy "owners manage members"
  on public.project_members for all
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- ---------------------------------------------------------------------------
-- Project-scoped content. One pattern, applied consistently.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'media_assets', 'media_analysis', 'timelines', 'tracks',
    'clips', 'effects', 'keyframes', 'exports'
  ] loop
    execute format('drop policy if exists "read project %1$s" on public.%1$I', t);
    execute format(
      'create policy "read project %1$s" on public.%1$I for select using (public.is_project_member(project_id))', t);

    execute format('drop policy if exists "write project %1$s" on public.%1$I', t);
    execute format(
      'create policy "write project %1$s" on public.%1$I for insert with check (public.can_edit_project(project_id))', t);

    execute format('drop policy if exists "update project %1$s" on public.%1$I', t);
    execute format(
      'create policy "update project %1$s" on public.%1$I for update using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id))', t);

    execute format('drop policy if exists "delete project %1$s" on public.%1$I', t);
    execute format(
      'create policy "delete project %1$s" on public.%1$I for delete using (public.can_edit_project(project_id))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- AI data is private to the user who wrote it, on top of project access.
-- ---------------------------------------------------------------------------
drop policy if exists "read own conversations" on public.ai_conversations;
create policy "read own conversations"
  on public.ai_conversations for select
  using (user_id = auth.uid() and public.is_project_member(project_id));

drop policy if exists "write own conversations" on public.ai_conversations;
create policy "write own conversations"
  on public.ai_conversations for insert
  with check (user_id = auth.uid() and public.can_edit_project(project_id));

drop policy if exists "update own conversations" on public.ai_conversations;
create policy "update own conversations"
  on public.ai_conversations for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "delete own conversations" on public.ai_conversations;
create policy "delete own conversations"
  on public.ai_conversations for delete
  using (user_id = auth.uid());

drop policy if exists "read own ai messages" on public.ai_messages;
create policy "read own ai messages"
  on public.ai_messages for select
  using (user_id = auth.uid() and public.is_project_member(project_id));

drop policy if exists "write own ai messages" on public.ai_messages;
create policy "write own ai messages"
  on public.ai_messages for insert
  with check (user_id = auth.uid() and public.can_edit_project(project_id));

drop policy if exists "delete own ai messages" on public.ai_messages;
create policy "delete own ai messages"
  on public.ai_messages for delete
  using (user_id = auth.uid());

-- editor_history ------------------------------------------------------------
drop policy if exists "read project history" on public.editor_history;
create policy "read project history"
  on public.editor_history for select
  using (public.is_project_member(project_id));

drop policy if exists "write project history" on public.editor_history;
create policy "write project history"
  on public.editor_history for insert
  with check (user_id = auth.uid() and public.can_edit_project(project_id));

drop policy if exists "delete project history" on public.editor_history;
create policy "delete project history"
  on public.editor_history for delete
  using (public.is_project_owner(project_id));

-- ---------------------------------------------------------------------------
-- Views inherit the RLS of the underlying table when they are invoker-rights.
-- ---------------------------------------------------------------------------
alter view public.text_elements  set (security_invoker = true);
alter view public.captions       set (security_invoker = true);
alter view public.audio_elements set (security_invoker = true);
alter view public.transitions    set (security_invoker = true);

-- ==================== 0003_functions.sql ====================

-- ===========================================================================
-- VideoAI · 0003 · Server-side functions
-- ---------------------------------------------------------------------------
-- The editor never issues raw table writes for the timeline. It sends one
-- snapshot to save_timeline(), which applies it atomically. That keeps autosave
-- to a single round trip and makes a half-written timeline impossible.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- New user bootstrap: profile + credit wallet
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_username text;
  candidate text;
  suffix integer := 0;
begin
  base_username := coalesce(
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[^A-Za-z0-9_.-]', '', 'g'), ''),
    nullif(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^A-Za-z0-9_.-]', '', 'g'), ''),
    'creator'
  );
  base_username := left(base_username, 24);
  if length(base_username) < 3 then
    base_username := base_username || 'user';
  end if;

  candidate := base_username;
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := left(base_username, 24) || suffix::text;
  end loop;

  insert into public.profiles (user_id, username, display_name, locale)
  values (
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data ->> 'display_name', candidate),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'en')
  )
  on conflict (user_id) do nothing;

  insert into public.user_credits (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Project creation, with its primary timeline and three starter tracks
-- ---------------------------------------------------------------------------
create or replace function public.create_project(
  p_name text default 'Untitled project',
  p_aspect_ratio text default '16:9',
  p_width integer default 1920,
  p_height integer default 1080,
  p_fps numeric default 30
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_timeline_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.projects (owner_id, name, aspect_ratio, width, height, fps, last_opened_at)
  values (auth.uid(), coalesce(nullif(trim(p_name), ''), 'Untitled project'),
          p_aspect_ratio, p_width, p_height, p_fps, now())
  returning id into v_project_id;

  insert into public.timelines (project_id, name, is_primary)
  values (v_project_id, 'Main', true)
  returning id into v_timeline_id;

  insert into public.tracks (timeline_id, project_id, kind, name, layer_index, height)
  values
    (v_timeline_id, v_project_id, 'video', 'Video 1', 0, 68),
    (v_timeline_id, v_project_id, 'audio', 'Audio 1', 1, 56),
    (v_timeline_id, v_project_id, 'text',  'Text 1',  2, 56);

  return v_project_id;
end;
$$;

grant execute on function public.create_project(text, text, integer, integer, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- save_timeline: atomic snapshot write
-- ---------------------------------------------------------------------------
create or replace function public.save_timeline(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid := (p_payload ->> 'projectId')::uuid;
  v_timeline_id uuid := (p_payload ->> 'timelineId')::uuid;
  v_settings jsonb := coalesce(p_payload -> 'settings', '{}'::jsonb);
  v_track jsonb;
  v_clip jsonb;
  v_effect jsonb;
  v_keyframe jsonb;
  v_track_ids uuid[] := '{}';
  v_clip_ids uuid[] := '{}';
  v_index integer;
  v_revision bigint;
begin
  if v_project_id is null or v_timeline_id is null then
    raise exception 'projectId and timelineId are required';
  end if;
  if not public.can_edit_project(v_project_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.timelines t where t.id = v_timeline_id and t.project_id = v_project_id) then
    raise exception 'timeline_not_found';
  end if;

  -- Project-level settings ---------------------------------------------------
  update public.projects
  set name = coalesce(nullif(p_payload ->> 'name', ''), name),
      aspect_ratio = coalesce(v_settings ->> 'aspectRatio', aspect_ratio),
      width = coalesce((v_settings ->> 'width')::integer, width),
      height = coalesce((v_settings ->> 'height')::integer, height),
      fps = coalesce((v_settings ->> 'fps')::numeric, fps),
      background_color = coalesce(v_settings ->> 'backgroundColor', background_color),
      sample_rate = coalesce((v_settings ->> 'sampleRate')::integer, sample_rate),
      duration_seconds = coalesce((p_payload ->> 'duration')::numeric, duration_seconds),
      thumbnail_path = coalesce(p_payload ->> 'thumbnailPath', thumbnail_path),
      updated_at = now()
  where id = v_project_id;

  -- Tracks -------------------------------------------------------------------
  v_index := 0;
  for v_track in select * from jsonb_array_elements(coalesce(p_payload -> 'tracks', '[]'::jsonb)) loop
    v_track_ids := array_append(v_track_ids, (v_track ->> 'id')::uuid);
    insert into public.tracks (id, timeline_id, project_id, kind, name, layer_index, muted, hidden, locked, volume, height)
    values (
      (v_track ->> 'id')::uuid, v_timeline_id, v_project_id,
      v_track ->> 'kind',
      coalesce(v_track ->> 'name', 'Track'),
      coalesce((v_track ->> 'index')::integer, v_index),
      coalesce((v_track ->> 'muted')::boolean, false),
      coalesce((v_track ->> 'hidden')::boolean, false),
      coalesce((v_track ->> 'locked')::boolean, false),
      coalesce((v_track ->> 'volume')::numeric, 1),
      coalesce((v_track ->> 'height')::integer, 68)
    )
    on conflict (id) do update set
      kind = excluded.kind, name = excluded.name, layer_index = excluded.layer_index,
      muted = excluded.muted, hidden = excluded.hidden, locked = excluded.locked,
      volume = excluded.volume, height = excluded.height;
    v_index := v_index + 1;
  end loop;

  delete from public.tracks t
  where t.timeline_id = v_timeline_id and not (t.id = any(v_track_ids));

  -- Clips --------------------------------------------------------------------
  for v_clip in select * from jsonb_array_elements(coalesce(p_payload -> 'clips', '[]'::jsonb)) loop
    v_clip_ids := array_append(v_clip_ids, (v_clip ->> 'id')::uuid);
    insert into public.clips (
      id, timeline_id, track_id, project_id, asset_id, kind, role, group_id, name,
      start_time, duration, source_in, speed, reversed, freeze_frame, volume, muted,
      fade_in, fade_out, opacity, locked, transform, crop,
      text_content, text_style, text_animation, transition_in, transition_out
    ) values (
      (v_clip ->> 'id')::uuid, v_timeline_id, (v_clip ->> 'trackId')::uuid, v_project_id,
      nullif(v_clip ->> 'assetId', '')::uuid,
      v_clip ->> 'kind',
      coalesce(v_clip ->> 'role', 'default'),
      nullif(v_clip ->> 'groupId', '')::uuid,
      coalesce(v_clip ->> 'name', 'Clip'),
      coalesce((v_clip ->> 'start')::numeric, 0),
      greatest(coalesce((v_clip ->> 'duration')::numeric, 0.02), 0.001),
      coalesce((v_clip ->> 'sourceIn')::numeric, 0),
      coalesce((v_clip ->> 'speed')::numeric, 1),
      coalesce((v_clip ->> 'reversed')::boolean, false),
      coalesce((v_clip ->> 'freeze')::boolean, false),
      coalesce((v_clip ->> 'volume')::numeric, 1),
      coalesce((v_clip ->> 'muted')::boolean, false),
      coalesce((v_clip ->> 'fadeIn')::numeric, 0),
      coalesce((v_clip ->> 'fadeOut')::numeric, 0),
      coalesce((v_clip ->> 'opacity')::numeric, 1),
      coalesce((v_clip ->> 'locked')::boolean, false),
      coalesce(v_clip -> 'transform', '{}'::jsonb),
      v_clip -> 'crop',
      v_clip ->> 'text',
      v_clip -> 'style',
      v_clip ->> 'animation',
      case when v_clip -> 'transitionIn' = 'null'::jsonb then null else v_clip -> 'transitionIn' end,
      case when v_clip -> 'transitionOut' = 'null'::jsonb then null else v_clip -> 'transitionOut' end
    )
    on conflict (id) do update set
      track_id = excluded.track_id, asset_id = excluded.asset_id, kind = excluded.kind,
      role = excluded.role, group_id = excluded.group_id, name = excluded.name,
      start_time = excluded.start_time, duration = excluded.duration, source_in = excluded.source_in,
      speed = excluded.speed, reversed = excluded.reversed, freeze_frame = excluded.freeze_frame,
      volume = excluded.volume, muted = excluded.muted, fade_in = excluded.fade_in,
      fade_out = excluded.fade_out, opacity = excluded.opacity, locked = excluded.locked,
      transform = excluded.transform, crop = excluded.crop, text_content = excluded.text_content,
      text_style = excluded.text_style, text_animation = excluded.text_animation,
      transition_in = excluded.transition_in, transition_out = excluded.transition_out;
  end loop;

  delete from public.clips c
  where c.timeline_id = v_timeline_id and not (c.id = any(v_clip_ids));

  -- Effects and keyframes are fully replaced; they are small and clip-scoped.
  delete from public.effects e where e.clip_id = any(v_clip_ids);
  delete from public.keyframes k where k.clip_id = any(v_clip_ids);

  for v_clip in select * from jsonb_array_elements(coalesce(p_payload -> 'clips', '[]'::jsonb)) loop
    v_index := 0;
    for v_effect in select * from jsonb_array_elements(coalesce(v_clip -> 'effects', '[]'::jsonb)) loop
      insert into public.effects (id, clip_id, project_id, type, enabled, order_index, params)
      values (
        (v_effect ->> 'id')::uuid, (v_clip ->> 'id')::uuid, v_project_id,
        v_effect ->> 'type',
        coalesce((v_effect ->> 'enabled')::boolean, true),
        v_index,
        coalesce(v_effect -> 'params', '{}'::jsonb)
      );
      v_index := v_index + 1;
    end loop;

    for v_keyframe in select * from jsonb_array_elements(coalesce(v_clip -> 'keyframes', '[]'::jsonb)) loop
      insert into public.keyframes (id, clip_id, project_id, property, time_offset, value, easing)
      values (
        (v_keyframe ->> 'id')::uuid, (v_clip ->> 'id')::uuid, v_project_id,
        v_keyframe ->> 'property',
        coalesce((v_keyframe ->> 'time')::numeric, 0),
        coalesce((v_keyframe ->> 'value')::double precision, 0),
        coalesce(v_keyframe ->> 'easing', 'ease_in_out')
      );
    end loop;
  end loop;

  update public.timelines
  set revision = revision + 1, updated_at = now()
  where id = v_timeline_id
  returning revision into v_revision;

  return jsonb_build_object('ok', true, 'revision', v_revision, 'savedAt', now());
end;
$$;

grant execute on function public.save_timeline(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- duplicate_project: deep copy of a project the caller can read
-- ---------------------------------------------------------------------------
create or replace function public.duplicate_project(p_project_id uuid, p_name text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new_project uuid;
  v_src_timeline uuid;
  v_new_timeline uuid;
  v_track_map jsonb := '{}'::jsonb;
  v_clip_map jsonb := '{}'::jsonb;
  v_asset_map jsonb := '{}'::jsonb;
  r record;
  v_new_id uuid;
begin
  if not public.is_project_member(p_project_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into public.projects (owner_id, name, description, aspect_ratio, width, height, fps,
                               background_color, sample_rate, export_format, export_quality, duration_seconds)
  select auth.uid(), coalesce(p_name, p.name || ' copy'), p.description, p.aspect_ratio, p.width, p.height,
         p.fps, p.background_color, p.sample_rate, p.export_format, p.export_quality, p.duration_seconds
  from public.projects p where p.id = p_project_id
  returning id into v_new_project;

  select id into v_src_timeline from public.timelines where project_id = p_project_id and is_primary limit 1;

  insert into public.timelines (project_id, name, is_primary)
  values (v_new_project, 'Main', true)
  returning id into v_new_timeline;

  -- Media rows point at the same storage objects; the copy shares the files.
  for r in select * from public.media_assets where project_id = p_project_id loop
    v_new_id := gen_random_uuid();
    v_asset_map := v_asset_map || jsonb_build_object(r.id::text, v_new_id::text);
    insert into public.media_assets (id, project_id, owner_id, kind, name, storage_path, mime_type,
      size_bytes, duration_seconds, width, height, fps, has_audio, sample_rate, channels, waveform,
      thumbnail_url, analysis_status)
    values (v_new_id, v_new_project, auth.uid(), r.kind, r.name,
      r.storage_path, r.mime_type, r.size_bytes, r.duration_seconds, r.width,
      r.height, r.fps, r.has_audio, r.sample_rate, r.channels, r.waveform, r.thumbnail_url, r.analysis_status);

    insert into public.media_analysis (asset_id, project_id, language, transcript_text, words, segments, silences, loudness_db, model)
    select v_new_id, v_new_project, a.language, a.transcript_text, a.words, a.segments, a.silences, a.loudness_db, a.model
    from public.media_analysis a where a.asset_id = r.id;
  end loop;

  for r in select * from public.tracks where timeline_id = v_src_timeline order by layer_index loop
    v_new_id := gen_random_uuid();
    v_track_map := v_track_map || jsonb_build_object(r.id::text, v_new_id::text);
    insert into public.tracks (id, timeline_id, project_id, kind, name, layer_index, muted, hidden, locked, volume, height)
    values (v_new_id, v_new_timeline, v_new_project, r.kind, r.name, r.layer_index, r.muted, r.hidden, r.locked, r.volume, r.height);
  end loop;

  for r in select * from public.clips where timeline_id = v_src_timeline loop
    v_new_id := gen_random_uuid();
    v_clip_map := v_clip_map || jsonb_build_object(r.id::text, v_new_id::text);
    insert into public.clips (id, timeline_id, track_id, project_id, asset_id, kind, role, group_id, name,
      start_time, duration, source_in, speed, reversed, freeze_frame, volume, muted, fade_in, fade_out, opacity,
      locked, transform, crop, text_content, text_style, text_animation, transition_in, transition_out)
    values (v_new_id, v_new_timeline, (v_track_map ->> r.track_id::text)::uuid, v_new_project,
      case when r.asset_id is null then null else (v_asset_map ->> r.asset_id::text)::uuid end,
      r.kind, r.role, r.group_id, r.name, r.start_time, r.duration, r.source_in, r.speed, r.reversed,
      r.freeze_frame, r.volume, r.muted, r.fade_in, r.fade_out, r.opacity, r.locked, r.transform, r.crop,
      r.text_content, r.text_style, r.text_animation, r.transition_in, r.transition_out);
  end loop;

  insert into public.effects (clip_id, project_id, type, enabled, order_index, params)
  select (v_clip_map ->> e.clip_id::text)::uuid, v_new_project, e.type, e.enabled, e.order_index, e.params
  from public.effects e
  join public.clips c on c.id = e.clip_id
  where c.timeline_id = v_src_timeline;

  insert into public.keyframes (clip_id, project_id, property, time_offset, value, easing)
  select (v_clip_map ->> k.clip_id::text)::uuid, v_new_project, k.property, k.time_offset, k.value, k.easing
  from public.keyframes k
  join public.clips c on c.id = k.clip_id
  where c.timeline_id = v_src_timeline;

  return v_new_project;
end;
$$;

grant execute on function public.duplicate_project(uuid, text) to authenticated;

-- ==================== 0004_credits.sql ====================

-- ===========================================================================
-- VideoAI · 0004 · Credit ("token") system
-- ---------------------------------------------------------------------------
-- Every user has a wallet that refills to `refill_amount` once `refill_interval`
-- has passed. AI work costs credits; the price list lives in credit_costs so it
-- can be tuned from the Supabase dashboard without a deploy.
--
-- To give someone more credits:
--     update public.user_credits set balance = 5000 where user_id = '<uuid>';
-- To give yourself unlimited credits:
--     update public.user_credits set unlimited = true where user_id = '<uuid>';
-- To change what everyone gets per period:
--     update public.user_credits set refill_amount = 2000;
-- ===========================================================================

create table if not exists public.user_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 1000 check (balance >= 0),
  refill_amount integer not null default 1000 check (refill_amount >= 0),
  refill_interval interval not null default '8 hours',
  unlimited boolean not null default false,
  lifetime_spent bigint not null default 0,
  last_refill_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_credits_set_updated_at on public.user_credits;
create trigger user_credits_set_updated_at
  before update on public.user_credits
  for each row execute function public.set_updated_at();

create table if not exists public.credit_costs (
  key text primary key,
  cost integer not null check (cost >= 0),
  description text not null
);

insert into public.credit_costs (key, cost, description) values
  ('ai_command',    250, 'One AI assistant request, including all editor actions it performs'),
  ('ai_question',    60, 'An AI request that only reads the project and answers, without editing'),
  ('transcription', 300, 'Transcribing one media asset, including word-level timestamps'),
  ('export',          0, 'Rendering and exporting a video (runs in the browser, so it is free)')
on conflict (key) do nothing;

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  balance_after integer not null,
  reason text not null,
  project_id uuid references public.projects(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_idx on public.credit_ledger(user_id, created_at desc);

alter table public.user_credits  enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.credit_costs  enable row level security;

-- Users may read their own wallet and history, but never write to them.
drop policy if exists "read own credits" on public.user_credits;
create policy "read own credits" on public.user_credits for select using (user_id = auth.uid());

drop policy if exists "read own ledger" on public.credit_ledger;
create policy "read own ledger" on public.credit_ledger for select using (user_id = auth.uid());

drop policy if exists "read cost table" on public.credit_costs;
create policy "read cost table" on public.credit_costs for select using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- Lazy refill. Called by every read and every spend, so there is no cron job.
-- ---------------------------------------------------------------------------
create or replace function public.refill_credits(p_user_id uuid)
returns public.user_credits
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.user_credits;
  v_before integer;
begin
  insert into public.user_credits (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_row from public.user_credits where user_id = p_user_id for update;
  v_before := v_row.balance;

  if now() - v_row.last_refill_at >= v_row.refill_interval then
    -- Top up to the allowance without clipping a manual grant that is larger.
    update public.user_credits
    set balance = greatest(balance, refill_amount),
        last_refill_at = now()
    where user_id = p_user_id
    returning * into v_row;

    if v_row.balance <> v_before then
      insert into public.credit_ledger (user_id, delta, balance_after, reason)
      values (p_user_id, v_row.balance - v_before, v_row.balance, 'refill');
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.get_credit_status()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.user_credits;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  v_row := public.refill_credits(auth.uid());
  return jsonb_build_object(
    'balance', v_row.balance,
    'unlimited', v_row.unlimited,
    'refillAmount', v_row.refill_amount,
    'refillIntervalSeconds', extract(epoch from v_row.refill_interval),
    'nextRefillAt', v_row.last_refill_at + v_row.refill_interval,
    'lifetimeSpent', v_row.lifetime_spent,
    'costs', (select jsonb_object_agg(key, cost) from public.credit_costs)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Spend. Raises `insufficient_credits` when the wallet is empty.
-- ---------------------------------------------------------------------------
create or replace function public.consume_credits(
  p_reason text,
  p_amount integer default null,
  p_project_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.user_credits;
  v_cost integer;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  v_cost := coalesce(p_amount, (select cost from public.credit_costs where key = p_reason), 0);
  v_row := public.refill_credits(v_user);

  if v_row.unlimited then
    insert into public.credit_ledger (user_id, delta, balance_after, reason, project_id, metadata)
    values (v_user, 0, v_row.balance, p_reason, p_project_id, p_metadata || '{"unlimited":true}'::jsonb);
    return jsonb_build_object('charged', 0, 'balance', v_row.balance, 'unlimited', true);
  end if;

  if v_row.balance < v_cost then
    raise exception 'insufficient_credits'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'balance', v_row.balance,
              'required', v_cost,
              'nextRefillAt', v_row.last_refill_at + v_row.refill_interval
            )::text;
  end if;

  update public.user_credits
  set balance = balance - v_cost,
      lifetime_spent = lifetime_spent + v_cost
  where user_id = v_user
  returning * into v_row;

  insert into public.credit_ledger (user_id, delta, balance_after, reason, project_id, metadata)
  values (v_user, -v_cost, v_row.balance, p_reason, p_project_id, p_metadata);

  return jsonb_build_object('charged', v_cost, 'balance', v_row.balance, 'unlimited', false);
end;
$$;

-- Refunds a charge when the work it paid for could not be delivered.
create or replace function public.refund_credits(p_reason text, p_amount integer, p_project_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.user_credits;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_amount <= 0 then
    return jsonb_build_object('refunded', 0);
  end if;

  update public.user_credits
  set balance = balance + p_amount,
      lifetime_spent = greatest(0, lifetime_spent - p_amount)
  where user_id = v_user
  returning * into v_row;

  insert into public.credit_ledger (user_id, delta, balance_after, reason, project_id)
  values (v_user, p_amount, v_row.balance, p_reason || '_refund', p_project_id);

  return jsonb_build_object('refunded', p_amount, 'balance', v_row.balance);
end;
$$;

-- Admin grant, usable from the app by a user whose profile has is_admin = true.
create or replace function public.grant_credits(p_user_id uuid, p_amount integer, p_unlimited boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.user_credits;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into public.user_credits (user_id) values (p_user_id) on conflict (user_id) do nothing;

  update public.user_credits
  set balance = greatest(0, balance + p_amount),
      unlimited = coalesce(p_unlimited, unlimited)
  where user_id = p_user_id
  returning * into v_row;

  insert into public.credit_ledger (user_id, delta, balance_after, reason, metadata)
  values (p_user_id, p_amount, v_row.balance, 'admin_grant',
          jsonb_build_object('grantedBy', auth.uid()));

  return jsonb_build_object('balance', v_row.balance, 'unlimited', v_row.unlimited);
end;
$$;

revoke all on function public.refill_credits(uuid) from public;
grant execute on function public.get_credit_status() to authenticated;
grant execute on function public.consume_credits(text, integer, uuid, jsonb) to authenticated;
grant execute on function public.refund_credits(text, integer, uuid) to authenticated;
grant execute on function public.grant_credits(uuid, integer, boolean) to authenticated;

-- Backfill wallets for users that existed before this migration.
insert into public.user_credits (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ==================== 0005_storage.sql ====================

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
