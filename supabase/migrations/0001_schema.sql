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
