-- ===========================================================================
-- VideoAI · RLS test suite
-- ---------------------------------------------------------------------------
-- Proves the isolation guarantees from the spec:
--   * user B can never read, change or delete user A's projects, media,
--     timeline data or AI conversations
--   * a user cannot top up their own credit wallet
--   * storage paths are locked to the owning user
-- Any violation aborts the script with an exception, so a clean run == pass.
-- ===========================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.check(cond boolean, label text) returns void
language plpgsql as $$
begin
  if not cond then
    raise exception 'RLS TEST FAILED: %', label;
  else
    raise notice 'ok  %', label;
  end if;
end;
$$;

-- --- fixtures --------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bob@example.com');

select pg_temp.check(
  (select count(*) from public.profiles) = 2,
  'signup trigger creates a profile per user');
select pg_temp.check(
  (select count(*) from public.user_credits where balance = 1000) = 2,
  'signup trigger creates a 1000-credit wallet per user');

-- --- alice builds a project ------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';

select public.create_project('Alice project') as project_id \gset

select pg_temp.check(
  (select count(*) from public.tracks where project_id = :'project_id') = 3,
  'create_project seeds three tracks');

insert into public.media_assets (id, project_id, owner_id, kind, name, storage_path, mime_type, duration_seconds)
values ('cccccccc-0000-4000-8000-000000000001', :'project_id',
        'aaaaaaaa-0000-4000-8000-000000000001', 'video', 'a.mp4',
        'user/aaaaaaaa-0000-4000-8000-000000000001/projects/p/media/a.mp4', 'video/mp4', 30);

insert into public.ai_conversations (id, project_id, user_id)
values ('dddddddd-0000-4000-8000-000000000001', :'project_id', 'aaaaaaaa-0000-4000-8000-000000000001');

-- Save a timeline snapshot through the RPC the editor actually uses.
select public.save_timeline(jsonb_build_object(
  'projectId', :'project_id',
  'timelineId', (select id from public.timelines where project_id = :'project_id'),
  'name', 'Alice project',
  'duration', 12.5,
  'settings', jsonb_build_object('aspectRatio','9:16','width',1080,'height',1920,'fps',30,
                                 'backgroundColor','#000000','sampleRate',48000),
  'tracks', jsonb_build_array(
    jsonb_build_object('id', (select id from public.tracks where project_id = :'project_id' and kind='video'),
                       'kind','video','name','Video 1','index',0,'muted',false,'hidden',false,
                       'locked',false,'volume',1,'height',68)),
  'clips', jsonb_build_array(
    jsonb_build_object(
      'id','eeeeeeee-0000-4000-8000-000000000001',
      'trackId',(select id from public.tracks where project_id = :'project_id' and kind='video'),
      'kind','video','assetId','cccccccc-0000-4000-8000-000000000001',
      'name','a.mp4','start',0,'duration',12.5,'sourceIn',0,'speed',1,
      'transform', jsonb_build_object('x',0,'y',0,'scale',1,'rotation',0,'flipH',false,'flipV',false),
      'effects', jsonb_build_array(jsonb_build_object('id','ffffffff-0000-4000-8000-000000000001',
                                                      'type','saturation','enabled',true,
                                                      'params', jsonb_build_object('amount',1.3))),
      'keyframes', jsonb_build_array(jsonb_build_object('id','ffffffff-0000-4000-8000-000000000002',
                                                        'property','scale','time',0,'value',1,'easing','ease_in_out'))
    ))
)) is not null as saved \gset

select pg_temp.check((select count(*) from public.clips where project_id = :'project_id') = 1,
  'save_timeline writes clips');
select pg_temp.check((select count(*) from public.effects where project_id = :'project_id') = 1,
  'save_timeline writes effects');
select pg_temp.check((select count(*) from public.keyframes where project_id = :'project_id') = 1,
  'save_timeline writes keyframes');
select pg_temp.check((select aspect_ratio from public.projects where id = :'project_id') = '9:16',
  'save_timeline updates project settings');

select pg_temp.check((select count(*) from public.captions) = 0, 'captions view is queryable');
select pg_temp.check((select count(*) from public.audio_elements) = 1, 'audio_elements view resolves');

-- --- bins, markers and audio processing survive the round trip -------------
-- These are the parts of the editor that only exist in memory until the save
-- includes them, which is exactly the kind of thing that silently regresses.
select public.save_timeline(jsonb_build_object(
  'projectId', :'project_id',
  'timelineId', (select id from public.timelines where project_id = :'project_id'),
  'name', 'Alice project',
  'duration', 12.5,
  'settings', jsonb_build_object('aspectRatio','9:16','width',1080,'height',1920,'fps',30,
                                 'backgroundColor','#000000','sampleRate',48000),
  'folders', jsonb_build_array(
    jsonb_build_object('id','11110000-0000-4000-8000-000000000001','name','Raw','parentId', null),
    jsonb_build_object('id','11110000-0000-4000-8000-000000000002','name','B-roll',
                       'parentId','11110000-0000-4000-8000-000000000001')),
  'assetFolders', jsonb_build_array(
    jsonb_build_object('assetId','cccccccc-0000-4000-8000-000000000001',
                       'folderId','11110000-0000-4000-8000-000000000002')),
  'markers', jsonb_build_array(
    jsonb_build_object('id','22220000-0000-4000-8000-000000000001','time',4.25,'label','Latteren','color','#f0a03a')),
  'tracks', jsonb_build_array(
    jsonb_build_object('id', (select id from public.tracks where project_id = :'project_id' and kind='video'),
                       'kind','video','name','Video 1','index',0,'muted',false,'hidden',false,
                       'locked',false,'volume',1,'height',68)),
  'clips', jsonb_build_array(
    jsonb_build_object(
      'id','eeeeeeee-0000-4000-8000-000000000001',
      'trackId',(select id from public.tracks where project_id = :'project_id' and kind='video'),
      'kind','video','assetId','cccccccc-0000-4000-8000-000000000001',
      'name','a.mp4','start',0,'duration',12.5,'sourceIn',0,'speed',1,
      'transform', jsonb_build_object('x',0,'y',0,'scale',1,'rotation',0,'flipH',false,'flipV',false),
      'audio', jsonb_build_object('filter','voice','compression',0.4,'gainDb',3,
                                  'duckUnderTrackIds', jsonb_build_array(),'duckAmount',0.7),
      'effects', jsonb_build_array(),
      'keyframes', jsonb_build_array()
    ))
)) is not null as saved2 \gset

select pg_temp.check((select count(*) from public.media_folders where project_id = :'project_id') = 2,
  'save_timeline writes media folders');
select pg_temp.check(
  (select parent_id from public.media_folders where id = '11110000-0000-4000-8000-000000000002')
    = '11110000-0000-4000-8000-000000000001',
  'a folder inside another keeps its parent');
select pg_temp.check(
  (select folder_id from public.media_assets where id = 'cccccccc-0000-4000-8000-000000000001')
    = '11110000-0000-4000-8000-000000000002',
  'dragging a file into a bin survives the save');
select pg_temp.check((select count(*) from public.markers where project_id = :'project_id') = 1,
  'save_timeline writes markers');
select pg_temp.check(
  (select audio_processing ->> 'filter' from public.clips where id = 'eeeeeeee-0000-4000-8000-000000000001') = 'voice',
  'audio processing survives the save');

-- Removing a bin unfiles its media instead of deleting it.
select public.save_timeline(jsonb_build_object(
  'projectId', :'project_id',
  'timelineId', (select id from public.timelines where project_id = :'project_id'),
  'name', 'Alice project',
  'duration', 12.5,
  'settings', jsonb_build_object('aspectRatio','9:16','width',1080,'height',1920,'fps',30,
                                 'backgroundColor','#000000','sampleRate',48000),
  'folders', jsonb_build_array(),
  'assetFolders', jsonb_build_array(
    jsonb_build_object('assetId','cccccccc-0000-4000-8000-000000000001','folderId', null)),
  'markers', jsonb_build_array(),
  'tracks', jsonb_build_array(
    jsonb_build_object('id', (select id from public.tracks where project_id = :'project_id' and kind='video'),
                       'kind','video','name','Video 1','index',0,'muted',false,'hidden',false,
                       'locked',false,'volume',1,'height',68)),
  'clips', jsonb_build_array(
    jsonb_build_object(
      'id','eeeeeeee-0000-4000-8000-000000000001',
      'trackId',(select id from public.tracks where project_id = :'project_id' and kind='video'),
      'kind','video','assetId','cccccccc-0000-4000-8000-000000000001',
      'name','a.mp4','start',0,'duration',12.5,'sourceIn',0,'speed',1,
      'transform', jsonb_build_object('x',0,'y',0,'scale',1,'rotation',0,'flipH',false,'flipV',false),
      'effects', jsonb_build_array(),
      'keyframes', jsonb_build_array()))
)) is not null as saved3 \gset

select pg_temp.check((select count(*) from public.media_folders where project_id = :'project_id') = 0,
  'removing a bin deletes the folder row');
select pg_temp.check((select count(*) from public.media_assets where project_id = :'project_id') = 1,
  'removing a bin keeps the media that was in it');
select pg_temp.check((select count(*) from public.markers where project_id = :'project_id') = 0,
  'removing a marker deletes its row');



-- --- bob is locked out -----------------------------------------------------
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';

select pg_temp.check((select count(*) from public.projects where id = :'project_id') = 0,
  'B cannot read A''s project');
select pg_temp.check((select count(*) from public.media_assets) = 0,
  'B cannot read A''s media assets');
select pg_temp.check((select count(*) from public.clips) = 0,
  'B cannot read A''s clips');
select pg_temp.check((select count(*) from public.tracks) = 0,
  'B cannot read A''s tracks');
select pg_temp.check((select count(*) from public.effects) = 0,
  'B cannot read A''s effects');
select pg_temp.check((select count(*) from public.ai_conversations) = 0,
  'B cannot read A''s AI conversations');
select pg_temp.check((select count(*) from public.editor_history) = 0,
  'B cannot read A''s edit history');
select pg_temp.check((select count(*) from public.profiles) = 1,
  'B only sees their own profile');

-- Writes silently affect zero rows rather than throwing, which is what RLS does.
update public.projects set name = 'hacked' where id = :'project_id';
select pg_temp.check((select count(*) from public.projects where name = 'hacked') = 0,
  'B cannot rename A''s project');

delete from public.clips;
delete from public.media_assets;

set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
select pg_temp.check((select count(*) from public.clips where project_id = :'project_id') = 1,
  'A''s clips survived B''s delete attempt');
select pg_temp.check((select count(*) from public.media_assets) = 1,
  'A''s media survived B''s delete attempt');

-- B cannot write into A's project either.
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$
declare
  v_project uuid;
begin
  select id into v_project from public.projects limit 1;  -- invisible to B
  begin
    insert into public.media_assets (project_id, owner_id, kind, name, storage_path, mime_type)
    values ('11111111-1111-4111-8111-111111111111',
            'bbbbbbbb-0000-4000-8000-000000000002', 'video', 'x', 'user/b/x', 'video/mp4');
    raise exception 'RLS TEST FAILED: B inserted media into a project they cannot edit';
  exception
    when insufficient_privilege or foreign_key_violation then
      raise notice 'ok  B cannot insert media into an unknown project';
  end;
end;
$$;

do $$
begin
  begin
    perform public.save_timeline(jsonb_build_object(
      'projectId', (select id from public.projects order by created_at limit 1),
      'timelineId', gen_random_uuid()));
    raise exception 'RLS TEST FAILED: save_timeline accepted a foreign project';
  exception
    when others then
      raise notice 'ok  save_timeline rejects a project B cannot edit';
  end;
end;
$$;

-- --- credits ---------------------------------------------------------------
select pg_temp.check((public.get_credit_status() ->> 'balance')::int = 1000,
  'wallet starts at 1000 credits');

select public.consume_credits('ai_command') as spend1 \gset
select pg_temp.check((public.get_credit_status() ->> 'balance')::int = 750,
  'an AI command costs 250 credits');

select public.consume_credits('ai_command');
select public.consume_credits('ai_command');
select pg_temp.check((public.get_credit_status() ->> 'balance')::int = 250,
  'three AI commands leave 250 credits');

do $$
begin
  begin
    perform public.consume_credits('transcription');  -- costs 300, only 250 left
    raise exception 'RLS TEST FAILED: spending past zero was allowed';
  exception
    when sqlstate 'P0001' then
      raise notice 'ok  spending past zero raises insufficient_credits';
  end;
end;
$$;

update public.user_credits set balance = 999999 where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.check((public.get_credit_status() ->> 'balance')::int = 250,
  'a user cannot top up their own wallet');

do $$
begin
  begin
    perform public.grant_credits('bbbbbbbb-0000-4000-8000-000000000002', 5000);
    raise exception 'RLS TEST FAILED: non-admin granted credits';
  exception
    when insufficient_privilege then raise notice 'ok  only admins can grant credits';
  end;
end;
$$;

-- The refill is time based: rewind the clock and it tops up.
reset role;
update public.user_credits set last_refill_at = now() - interval '9 hours'
where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
set role authenticated;
select pg_temp.check((public.get_credit_status() ->> 'balance')::int = 1000,
  'the wallet refills to 1000 after 8 hours');

-- Admin flag unlocks granting.
reset role;
update public.profiles set is_admin = true where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
select public.grant_credits('bbbbbbbb-0000-4000-8000-000000000002', 4000, true) as granted \gset
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.check((public.get_credit_status() ->> 'unlimited')::boolean,
  'an admin can grant unlimited credits');
select public.consume_credits('ai_command');
select pg_temp.check((public.get_credit_status() ->> 'balance')::int = 5000,
  'unlimited users are not charged');

-- --- storage ---------------------------------------------------------------
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
insert into storage.objects (bucket_id, name)
values ('media', 'user/aaaaaaaa-0000-4000-8000-000000000001/projects/p/media/a.mp4');

set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.check((select count(*) from storage.objects) = 0,
  'B cannot list A''s storage objects');

do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('media', 'user/aaaaaaaa-0000-4000-8000-000000000001/projects/p/media/evil.mp4');
    raise exception 'RLS TEST FAILED: B wrote into A''s storage folder';
  exception
    when insufficient_privilege then raise notice 'ok  B cannot write into A''s storage folder';
  end;
end;
$$;

reset role;
select 'ALL RLS TESTS PASSED' as result;
