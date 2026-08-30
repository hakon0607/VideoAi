-- ===========================================================================
-- VideoAI · 0007 · Media folders, markers, audio processing, project folders
-- ---------------------------------------------------------------------------
-- Everything here exists so a big shoot stays navigable: media goes in bins,
-- projects go in folders, the timeline gets named markers, and clips carry the
-- audio processing that used to live only in the mixer.
-- ===========================================================================

/* ------------------------------------------------------------------------ */
/* Media folders (bins)                                                     */
/* ------------------------------------------------------------------------ */
create table if not exists public.media_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.media_folders(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists media_folders_project_idx on public.media_folders(project_id);
create index if not exists media_folders_parent_idx on public.media_folders(parent_id);

comment on table public.media_folders is
  'Bins in a project''s media library. parent_id null means a top-level folder.';

alter table public.media_assets
  add column if not exists folder_id uuid references public.media_folders(id) on delete set null;

comment on column public.media_assets.folder_id is 'Which bin the file sits in. Null = top level.';

create index if not exists media_assets_folder_idx on public.media_assets(folder_id);

/* ------------------------------------------------------------------------ */
/* Timeline markers                                                         */
/* ------------------------------------------------------------------------ */
create table if not exists public.markers (
  id uuid primary key default gen_random_uuid(),
  timeline_id uuid not null references public.timelines(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  time_seconds numeric(12,4) not null check (time_seconds >= 0),
  label text not null default '',
  color text not null default '#6d6aff',
  created_at timestamptz not null default now()
);

create index if not exists markers_timeline_idx on public.markers(timeline_id, time_seconds);

comment on table public.markers is
  'Named points on the timeline. Used for navigation and as anchors the assistant can refer to.';

/* ------------------------------------------------------------------------ */
/* Per-clip audio processing                                                */
/* ------------------------------------------------------------------------ */
alter table public.clips
  add column if not exists audio_processing jsonb
  default '{"filter":"none","compression":0,"gainDb":0,"duckUnderTrackIds":[],"duckAmount":0.7}'::jsonb;

comment on column public.clips.audio_processing is
  'Filter chain, compression, gain and ducking. Applied identically in preview and export.';

/* ------------------------------------------------------------------------ */
/* Project folders                                                          */
/* ------------------------------------------------------------------------ */
create table if not exists public.project_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#6d6aff',
  created_at timestamptz not null default now()
);

create index if not exists project_folders_owner_idx on public.project_folders(owner_id);

comment on table public.project_folders is 'Folders on the dashboard, owned by one user.';

alter table public.projects
  add column if not exists folder_id uuid references public.project_folders(id) on delete set null;

comment on column public.projects.folder_id is 'Which dashboard folder the project is filed under.';

create index if not exists projects_folder_idx on public.projects(folder_id);

/* ------------------------------------------------------------------------ */
/* RLS                                                                      */
/* ------------------------------------------------------------------------ */
alter table public.media_folders   enable row level security;
alter table public.markers         enable row level security;
alter table public.project_folders enable row level security;

do $$
declare t text;
begin
  foreach t in array array['media_folders', 'markers'] loop
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

drop policy if exists "own project folders" on public.project_folders;
create policy "own project folders" on public.project_folders for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

/* ------------------------------------------------------------------------ */
/* save_timeline: markers, folders and audio processing                     */
/* ------------------------------------------------------------------------ */
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
  v_marker jsonb;
  v_track_ids uuid[] := '{}';
  v_clip_ids uuid[] := '{}';
  v_marker_ids uuid[] := '{}';
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
      v_track ->> 'kind', coalesce(v_track ->> 'name', 'Track'),
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
      text_content, text_style, text_animation, transition_in, transition_out, audio_processing
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
      case when v_clip -> 'crop' = 'null'::jsonb then null else v_clip -> 'crop' end,
      v_clip ->> 'text',
      v_clip -> 'style',
      v_clip ->> 'animation',
      case when v_clip -> 'transitionIn' = 'null'::jsonb then null else v_clip -> 'transitionIn' end,
      case when v_clip -> 'transitionOut' = 'null'::jsonb then null else v_clip -> 'transitionOut' end,
      coalesce(v_clip -> 'audio', '{}'::jsonb)
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
      transition_in = excluded.transition_in, transition_out = excluded.transition_out,
      audio_processing = excluded.audio_processing;
  end loop;

  delete from public.clips c
  where c.timeline_id = v_timeline_id and not (c.id = any(v_clip_ids));

  delete from public.effects e where e.clip_id = any(v_clip_ids);
  delete from public.keyframes k where k.clip_id = any(v_clip_ids);

  for v_clip in select * from jsonb_array_elements(coalesce(p_payload -> 'clips', '[]'::jsonb)) loop
    v_index := 0;
    for v_effect in select * from jsonb_array_elements(coalesce(v_clip -> 'effects', '[]'::jsonb)) loop
      insert into public.effects (id, clip_id, project_id, type, enabled, order_index, params)
      values ((v_effect ->> 'id')::uuid, (v_clip ->> 'id')::uuid, v_project_id,
              v_effect ->> 'type', coalesce((v_effect ->> 'enabled')::boolean, true), v_index,
              coalesce(v_effect -> 'params', '{}'::jsonb));
      v_index := v_index + 1;
    end loop;

    for v_keyframe in select * from jsonb_array_elements(coalesce(v_clip -> 'keyframes', '[]'::jsonb)) loop
      insert into public.keyframes (id, clip_id, project_id, property, time_offset, value, easing)
      values ((v_keyframe ->> 'id')::uuid, (v_clip ->> 'id')::uuid, v_project_id,
              v_keyframe ->> 'property', coalesce((v_keyframe ->> 'time')::numeric, 0),
              coalesce((v_keyframe ->> 'value')::double precision, 0),
              coalesce(v_keyframe ->> 'easing', 'ease_in_out'));
    end loop;
  end loop;

  -- Markers ------------------------------------------------------------------
  for v_marker in select * from jsonb_array_elements(coalesce(p_payload -> 'markers', '[]'::jsonb)) loop
    v_marker_ids := array_append(v_marker_ids, (v_marker ->> 'id')::uuid);
    insert into public.markers (id, timeline_id, project_id, time_seconds, label, color)
    values ((v_marker ->> 'id')::uuid, v_timeline_id, v_project_id,
            coalesce((v_marker ->> 'time')::numeric, 0),
            coalesce(v_marker ->> 'label', ''),
            coalesce(v_marker ->> 'color', '#6d6aff'))
    on conflict (id) do update set
      time_seconds = excluded.time_seconds, label = excluded.label, color = excluded.color;
  end loop;

  delete from public.markers m
  where m.timeline_id = v_timeline_id and not (m.id = any(v_marker_ids));

  update public.timelines
  set revision = revision + 1, updated_at = now()
  where id = v_timeline_id
  returning revision into v_revision;

  return jsonb_build_object('ok', true, 'revision', v_revision, 'savedAt', now());
end;
$$;

grant execute on function public.save_timeline(jsonb) to authenticated;

/* ------------------------------------------------------------------------ */
/* duplicate_project also copies bins and markers                           */
/* ------------------------------------------------------------------------ */
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
  v_folder_map jsonb := '{}'::jsonb;
  r record;
  v_new_id uuid;
begin
  if not public.is_project_member(p_project_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into public.projects (owner_id, name, description, aspect_ratio, width, height, fps,
                               background_color, sample_rate, export_format, export_quality,
                               duration_seconds, folder_id)
  select auth.uid(), coalesce(p_name, p.name || ' copy'), p.description, p.aspect_ratio, p.width, p.height,
         p.fps, p.background_color, p.sample_rate, p.export_format, p.export_quality, p.duration_seconds,
         p.folder_id
  from public.projects p where p.id = p_project_id
  returning id into v_new_project;

  select id into v_src_timeline from public.timelines where project_id = p_project_id and is_primary limit 1;

  insert into public.timelines (project_id, name, is_primary)
  values (v_new_project, 'Main', true)
  returning id into v_new_timeline;

  -- Bins first, so assets can point at the copies.
  for r in select * from public.media_folders where project_id = p_project_id order by created_at loop
    v_new_id := gen_random_uuid();
    v_folder_map := v_folder_map || jsonb_build_object(r.id::text, v_new_id::text);
    insert into public.media_folders (id, project_id, parent_id, name)
    values (v_new_id, v_new_project,
            case when r.parent_id is null then null else (v_folder_map ->> r.parent_id::text)::uuid end,
            r.name);
  end loop;

  for r in select * from public.media_assets where project_id = p_project_id loop
    v_new_id := gen_random_uuid();
    v_asset_map := v_asset_map || jsonb_build_object(r.id::text, v_new_id::text);
    insert into public.media_assets (id, project_id, owner_id, kind, name, storage_path, mime_type,
      size_bytes, duration_seconds, width, height, fps, has_audio, sample_rate, channels, waveform,
      thumbnail_url, analysis_status, folder_id)
    values (v_new_id, v_new_project, auth.uid(), r.kind, r.name, r.storage_path, r.mime_type,
      r.size_bytes, r.duration_seconds, r.width, r.height, r.fps, r.has_audio, r.sample_rate,
      r.channels, r.waveform, r.thumbnail_url, r.analysis_status,
      case when r.folder_id is null then null else (v_folder_map ->> r.folder_id::text)::uuid end);

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
      locked, transform, crop, text_content, text_style, text_animation, transition_in, transition_out, audio_processing)
    values (v_new_id, v_new_timeline, (v_track_map ->> r.track_id::text)::uuid, v_new_project,
      case when r.asset_id is null then null else (v_asset_map ->> r.asset_id::text)::uuid end,
      r.kind, r.role, r.group_id, r.name, r.start_time, r.duration, r.source_in, r.speed, r.reversed,
      r.freeze_frame, r.volume, r.muted, r.fade_in, r.fade_out, r.opacity, r.locked, r.transform, r.crop,
      r.text_content, r.text_style, r.text_animation, r.transition_in, r.transition_out, r.audio_processing);
  end loop;

  insert into public.effects (clip_id, project_id, type, enabled, order_index, params)
  select (v_clip_map ->> e.clip_id::text)::uuid, v_new_project, e.type, e.enabled, e.order_index, e.params
  from public.effects e join public.clips c on c.id = e.clip_id
  where c.timeline_id = v_src_timeline;

  insert into public.keyframes (clip_id, project_id, property, time_offset, value, easing)
  select (v_clip_map ->> k.clip_id::text)::uuid, v_new_project, k.property, k.time_offset, k.value, k.easing
  from public.keyframes k join public.clips c on c.id = k.clip_id
  where c.timeline_id = v_src_timeline;

  insert into public.markers (timeline_id, project_id, time_seconds, label, color)
  select v_new_timeline, v_new_project, m.time_seconds, m.label, m.color
  from public.markers m where m.timeline_id = v_src_timeline;

  return v_new_project;
end;
$$;

grant execute on function public.duplicate_project(uuid, text) to authenticated;
