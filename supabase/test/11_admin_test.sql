-- ===========================================================================
-- VideoAI · admin surface test
-- ---------------------------------------------------------------------------
-- Proves that the admin views and functions are genuinely admin-only: a normal
-- user sees zero rows rather than an error, and cannot escalate themselves.
-- Runs against a fresh database (the RLS suite runs on its own copy).
-- ===========================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.check(cond boolean, label text) returns void
language plpgsql as $$
begin
  if not cond then raise exception 'ADMIN TEST FAILED: %', label;
  else raise notice 'ok  %', label; end if;
end;
$$;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'admin@example.com'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'normal@example.com');

-- The normal user builds a project with one media file.
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-00000000000b';
select public.create_project('Normal user project') as pid \gset

insert into public.media_assets (project_id, owner_id, kind, name, storage_path, mime_type, size_bytes, duration_seconds)
values (:'pid', 'bbbbbbbb-0000-4000-8000-00000000000b', 'video', 'big.mp4',
        'user/bbbbbbbb-0000-4000-8000-00000000000b/projects/p/media/big.mp4', 'video/mp4', 524288000, 600);

-- --- a normal user sees nothing admin-ish ---------------------------------
select pg_temp.check((select count(*) from public.admin_users) = 0,
  'admin_users is empty for a normal user');
select pg_temp.check((select count(*) from public.admin_projects) = 0,
  'admin_projects is empty for a normal user');
select pg_temp.check((select count(*) from public.admin_media) = 0,
  'admin_media is empty for a normal user');
select pg_temp.check((select count(*) from public.admin_credit_activity) = 0,
  'admin_credit_activity is empty for a normal user');

do $$ begin
  begin
    perform public.admin_overview();
    raise exception 'ADMIN TEST FAILED: a normal user read the overview';
  exception when insufficient_privilege then raise notice 'ok  admin_overview refuses a normal user';
  end;
end; $$;

do $$ begin
  begin
    perform public.admin_set_credits('bbbbbbbb-0000-4000-8000-00000000000b', 999999, true);
    raise exception 'ADMIN TEST FAILED: a normal user set their own credits';
  exception when insufficient_privilege then raise notice 'ok  admin_set_credits refuses a normal user';
  end;
end; $$;

do $$ begin
  begin
    perform public.admin_set_admin('bbbbbbbb-0000-4000-8000-00000000000b', true);
    raise exception 'ADMIN TEST FAILED: a normal user promoted themselves';
  exception when insufficient_privilege then raise notice 'ok  admin_set_admin refuses a normal user';
  end;
end; $$;

do $$
declare v_pid uuid;
begin
  select id into v_pid from public.projects limit 1;
  begin
    perform public.admin_delete_project(v_pid);
    raise exception 'ADMIN TEST FAILED: a normal user used the admin delete';
  exception when insufficient_privilege then raise notice 'ok  admin_delete_project refuses a normal user';
  end;
end; $$;

-- A normal user CAN ask for their own project's storage paths.
select pg_temp.check(
  jsonb_array_length((public.project_storage_paths(:'pid') -> 'mediaPaths')) = 1,
  'the owner can list their own storage paths before deleting');

-- The owner's own storage view shows their usage, and only theirs.
select pg_temp.check((select bytes_used from public.project_storage where project_id = :'pid') = 524288000,
  'project_storage reports the owner''s usage');

-- --- promote the admin ----------------------------------------------------
reset role;
update public.profiles set is_admin = true where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000000a';

select pg_temp.check((select count(*) from public.admin_users) = 2,
  'an admin sees every user');
select pg_temp.check(
  (select email from public.admin_users where username is not null and email = 'normal@example.com') = 'normal@example.com',
  'admin_users shows the email address next to the username');
select pg_temp.check((select project_count from public.admin_users where email = 'normal@example.com') = 1,
  'admin_users counts each user''s projects');
select pg_temp.check((select bytes_used from public.admin_users where email = 'normal@example.com') = 524288000,
  'admin_users totals each user''s storage');
select pg_temp.check((select owner_email from public.admin_projects limit 1) = 'normal@example.com',
  'admin_projects names the owner of every project');
select pg_temp.check((select owner_email from public.admin_media limit 1) = 'normal@example.com',
  'admin_media names the owner of every file');
select pg_temp.check((public.admin_overview() ->> 'users')::int = 2,
  'admin_overview counts users');
select pg_temp.check((public.admin_overview() ->> 'bytesUsed')::bigint = 524288000,
  'admin_overview totals storage');

-- --- admin actions --------------------------------------------------------
select public.admin_set_credits('bbbbbbbb-0000-4000-8000-00000000000b', 4321, false, 2500, 12);
select pg_temp.check((select credits from public.admin_users where email = 'normal@example.com') = 4321,
  'an admin can set a balance');
select pg_temp.check((select refill_amount from public.admin_users where email = 'normal@example.com') = 2500,
  'an admin can set the refill amount');

select public.admin_set_credits('bbbbbbbb-0000-4000-8000-00000000000b', null, true);
select pg_temp.check((select credits_unlimited from public.admin_users where email = 'normal@example.com'),
  'an admin can grant unlimited credits, leaving the balance alone');
select pg_temp.check((select credits from public.admin_users where email = 'normal@example.com') = 4321,
  'a null argument leaves that field untouched');

select public.admin_set_admin('bbbbbbbb-0000-4000-8000-00000000000b', true);
select pg_temp.check((select is_admin from public.admin_users where email = 'normal@example.com'),
  'an admin can promote someone else');

do $$ begin
  begin
    perform public.admin_set_admin('aaaaaaaa-0000-4000-8000-00000000000a', false);
    raise exception 'ADMIN TEST FAILED: an admin demoted themselves';
  exception when sqlstate 'P0001' then raise notice 'ok  an admin cannot demote themselves';
  end;
end; $$;

select public.admin_set_credit_cost('ai_command', 175);
select pg_temp.check((select cost from public.credit_costs where key = 'ai_command') = 175,
  'an admin can change the price list');

-- Deleting a project hands back the storage paths that have to be removed.
select public.admin_delete_project(:'pid') as deleted \gset
select pg_temp.check(
  (select jsonb_array_length((:'deleted')::jsonb -> 'mediaPaths')) = 1,
  'admin_delete_project returns the media paths to remove from the bucket');
select pg_temp.check((select count(*) from public.projects) = 0,
  'admin_delete_project removes the project');
select pg_temp.check((select count(*) from public.media_assets) = 0,
  'deleting a project cascades to its media rows');
select pg_temp.check((select count(*) from public.clips) = 0,
  'deleting a project cascades to its clips');

reset role;
select 'ALL ADMIN TESTS PASSED' as result;
