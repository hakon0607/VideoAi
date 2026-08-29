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
