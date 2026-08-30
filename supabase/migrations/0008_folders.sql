/* ------------------------------------------------------------------------ */
/* VideoAI · 0008 · Media bins are part of the timeline save                 */
/*                                                                          */
/* 0007 added the media_folders table and media_assets.folder_id, but the    */
/* only writer was the client's in-memory state: creating a bin, renaming    */
/* one or dragging a file into it survived until the page was reloaded and   */
/* no further. save_timeline is the single atomic write the editor makes, so */
/* the bins belong in it, beside the tracks, clips and markers.              */
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
  v_folder jsonb;
  v_assignment jsonb;
  v_track_ids uuid[] := '{}';
  v_clip_ids uuid[] := '{}';
  v_marker_ids uuid[] := '{}';
  v_folder_ids uuid[] := '{}';
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

  -- Media bins ---------------------------------------------------------------
  -- Two passes: every folder is inserted without its parent first, so a child
  -- listed before its parent cannot trip the self-reference.
  for v_folder in select * from jsonb_array_elements(coalesce(p_payload -> 'folders', '[]'::jsonb)) loop
    v_folder_ids := array_append(v_folder_ids, (v_folder ->> 'id')::uuid);
    insert into public.media_folders (id, project_id, name, parent_id)
    values ((v_folder ->> 'id')::uuid, v_project_id, coalesce(v_folder ->> 'name', 'Folder'), null)
    on conflict (id) do update set name = excluded.name;
  end loop;

  for v_folder in select * from jsonb_array_elements(coalesce(p_payload -> 'folders', '[]'::jsonb)) loop
    update public.media_folders
    set parent_id = nullif(v_folder ->> 'parentId', '')::uuid
    where id = (v_folder ->> 'id')::uuid;
  end loop;

  -- Which bin each file sits in. Files the payload does not mention keep their
  -- place, so an upload from another tab is never unfiled behind your back.
  for v_assignment in select * from jsonb_array_elements(coalesce(p_payload -> 'assetFolders', '[]'::jsonb)) loop
    update public.media_assets
    set folder_id = nullif(v_assignment ->> 'folderId', '')::uuid
    where id = (v_assignment ->> 'assetId')::uuid and project_id = v_project_id;
  end loop;

  -- Deleting a bin only unfiles what was in it: media_assets.folder_id is
  -- "on delete set null", so no file is ever lost with its folder.
  delete from public.media_folders f
  where f.project_id = v_project_id and not (f.id = any(v_folder_ids));

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
