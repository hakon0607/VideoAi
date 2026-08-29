-- ===========================================================================
-- VideoAI · optional demo project
-- ---------------------------------------------------------------------------
-- Creates one empty demo project for a specific user, so a fresh account has
-- something to open. It is flagged is_demo = true, which keeps it out of any
-- future analytics and makes it trivial to remove:
--
--     delete from public.projects where is_demo;
--
-- Demo data is never created automatically and never mixes with real projects:
-- it is owned by the user you name below and subject to the same RLS.
--
-- Usage: replace the email, then run in the Supabase SQL editor.
-- ===========================================================================

do $$
declare
  v_user uuid;
  v_project uuid;
  v_timeline uuid;
  v_text_track uuid;
begin
  select id into v_user from auth.users where email = 'you@example.com';
  if v_user is null then
    raise exception 'No user with that email. Sign up first, then edit this file.';
  end if;

  insert into public.projects (owner_id, name, aspect_ratio, width, height, fps, is_demo, last_opened_at)
  values (v_user, 'Welcome to VideoAI', '16:9', 1920, 1080, 30, true, now())
  returning id into v_project;

  insert into public.timelines (project_id, name, is_primary)
  values (v_project, 'Main', true)
  returning id into v_timeline;

  insert into public.tracks (timeline_id, project_id, kind, name, layer_index, height)
  values
    (v_timeline, v_project, 'video', 'Video 1', 0, 68),
    (v_timeline, v_project, 'audio', 'Audio 1', 1, 56),
    (v_timeline, v_project, 'text',  'Text 1',  2, 56);

  select id into v_text_track from public.tracks where timeline_id = v_timeline and kind = 'text';

  -- A single title card, so the project is not blank. No media is seeded,
  -- because there is nothing honest to put there until the user uploads a file.
  insert into public.clips (
    timeline_id, track_id, project_id, kind, name, start_time, duration,
    text_content, text_animation,
    text_style, transform
  )
  values (
    v_timeline,
    v_text_track,
    v_project, 'text', 'Welcome', 0, 4,
    'Upload a video, then ask the assistant', 'fade',
    '{"fontFamily":"Inter, system-ui, sans-serif","fontSize":0.06,"fontWeight":700,"italic":false,
      "color":"#ffffff","align":"center","lineHeight":1.2,"letterSpacing":0,
      "backgroundColor":"rgba(0,0,0,0)","backgroundPadding":0.02,"backgroundRadius":0.01,
      "strokeColor":"#000000","strokeWidth":0,"shadowColor":"rgba(0,0,0,0.55)","shadowBlur":0.01,
      "shadowOffsetY":0.004,"maxWidth":0.8,"uppercase":false}'::jsonb,
    '{"x":0,"y":0,"scale":1,"rotation":0,"flipH":false,"flipV":false}'::jsonb
  );

  raise notice 'Created demo project %', v_project;
end;
$$;
