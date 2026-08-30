-- ===========================================================================
-- VideoAI · 0006 · Ownership visibility, storage accounting and the admin panel
-- ---------------------------------------------------------------------------
-- Two things live here:
--
--   1. Descriptions on every table and the columns that are not self-evident,
--      so browsing the data in the Supabase table editor tells you whose row
--      you are looking at without cross-referencing ids by hand.
--
--   2. Admin-only views and functions. Admin views deliberately run with the
--      view owner's rights so they can see across users, and each one ends in
--      `where public.is_admin()` — a non-admin selecting from them gets zero
--      rows, not an error and not somebody else's data.
-- ===========================================================================

/* -------------------------------------------------------------------------
   1. Human-readable descriptions
   ------------------------------------------------------------------------- */

comment on table public.profiles is
  'One row per signed-in user. Join to auth.users on user_id for the email address.';
comment on column public.profiles.user_id is 'Owner. References auth.users.id.';
comment on column public.profiles.is_admin is 'Grants access to the in-app admin panel and grant_credits().';

comment on table public.projects is 'A video project. owner_id is the user who created it.';
comment on column public.projects.owner_id is 'Owner. References auth.users.id. Deleting the user deletes the project.';
comment on column public.projects.duration_seconds is 'Length of the finished timeline, updated on every save.';
comment on column public.projects.is_demo is 'Seeded demo content. Never mixed with real user data.';

comment on table public.project_members is 'Sharing. The owner is an implicit member and is not listed here.';

comment on table public.media_assets is
  'An uploaded file. owner_id is who uploaded it, project_id is where it is used, storage_path is the object in the media bucket.';
comment on column public.media_assets.storage_path is
  'Path inside the media bucket: user/{ownerId}/projects/{projectId}/media/{assetId}.{ext}. Not unique: duplicating a project shares the file.';
comment on column public.media_assets.waveform is 'Normalised 0..1 peaks used to draw the timeline waveform.';
comment on column public.media_assets.analysis_status is
  'pending, basic (metadata + silences), transcribing, analyzed (has a transcript) or failed.';

comment on table public.media_analysis is 'Transcript, word timestamps and detected silences for one asset.';
comment on table public.timelines is 'One primary timeline per project.';
comment on table public.tracks is 'A layer on the timeline. layer_index 0 draws at the bottom.';
comment on table public.clips is
  'Every clip: video, audio, image and text. start_time and duration are timeline seconds; source_in is the in-point inside the asset.';
comment on table public.effects is 'One row per effect on a clip.';
comment on table public.keyframes is 'One row per keyframe. time_offset is seconds from the start of the clip.';
comment on table public.editor_history is
  'Audit trail of every committed change, from the UI (source = user) or the assistant (source = ai).';
comment on table public.ai_conversations is 'One assistant conversation per user per project.';
comment on table public.ai_messages is 'Chat messages, plus the editor commands each answer produced.';
comment on table public.exports is 'Render jobs.';
comment on table public.user_credits is 'The credit wallet. Edit balance, refill_amount or unlimited here to change what a user gets.';
comment on table public.credit_costs is 'What each kind of AI work costs. Editable without a deploy.';
comment on table public.credit_ledger is 'Every credit movement, including refills, spends, refunds and admin grants.';

/* -------------------------------------------------------------------------
   2. Storage accounting
   ------------------------------------------------------------------------- */

-- Bytes stored per project, from the asset rows rather than from the bucket,
-- so it stays cheap to query.
create or replace view public.project_storage as
  select
    p.id                                as project_id,
    p.owner_id,
    p.name                              as project_name,
    count(m.id)                         as asset_count,
    coalesce(sum(m.size_bytes), 0)      as bytes_used,
    pg_size_pretty(coalesce(sum(m.size_bytes), 0)) as size_pretty
  from public.projects p
  left join public.media_assets m on m.project_id = p.id
  group by p.id, p.owner_id, p.name;

alter view public.project_storage set (security_invoker = true);

/* -------------------------------------------------------------------------
   3. Admin views — "who owns what", across every user
   ------------------------------------------------------------------------- */

create or replace view public.admin_users as
  select
    u.id                                          as user_id,
    u.email,
    pr.username,
    pr.display_name,
    pr.is_admin,
    pr.locale,
    c.balance                                     as credits,
    c.unlimited                                   as credits_unlimited,
    c.refill_amount,
    c.last_refill_at + c.refill_interval          as next_refill_at,
    c.lifetime_spent,
    (select count(*) from public.projects p where p.owner_id = u.id)        as project_count,
    (select count(*) from public.media_assets m where m.owner_id = u.id)    as asset_count,
    (select coalesce(sum(m.size_bytes), 0) from public.media_assets m where m.owner_id = u.id) as bytes_used,
    (select count(*) from public.ai_messages am where am.user_id = u.id and am.role = 'user')  as ai_requests,
    u.created_at                                  as signed_up_at,
    u.last_sign_in_at
  from auth.users u
  left join public.profiles pr on pr.user_id = u.id
  left join public.user_credits c on c.user_id = u.id
  where public.is_admin();

create or replace view public.admin_projects as
  select
    p.id                              as project_id,
    p.name                            as project_name,
    u.email                           as owner_email,
    pr.username                       as owner_username,
    p.owner_id,
    p.aspect_ratio,
    p.width || 'x' || p.height        as resolution,
    p.duration_seconds,
    (select count(*) from public.clips c where c.project_id = p.id)         as clip_count,
    (select count(*) from public.media_assets m where m.project_id = p.id)  as asset_count,
    (select coalesce(sum(m.size_bytes), 0) from public.media_assets m where m.project_id = p.id) as bytes_used,
    (select count(*) from public.editor_history h where h.project_id = p.id and h.source = 'ai') as ai_edits,
    p.is_demo,
    p.created_at,
    p.updated_at,
    p.last_opened_at
  from public.projects p
  join auth.users u on u.id = p.owner_id
  left join public.profiles pr on pr.user_id = p.owner_id
  where public.is_admin();

create or replace view public.admin_media as
  select
    m.id                    as asset_id,
    m.name                  as file_name,
    m.kind,
    m.mime_type,
    m.size_bytes,
    pg_size_pretty(m.size_bytes) as size_pretty,
    m.duration_seconds,
    m.analysis_status,
    m.storage_path,
    p.name                  as project_name,
    u.email                 as owner_email,
    m.project_id,
    m.owner_id,
    m.created_at
  from public.media_assets m
  join public.projects p on p.id = m.project_id
  join auth.users u on u.id = m.owner_id
  where public.is_admin();

create or replace view public.admin_credit_activity as
  select
    l.id,
    u.email       as user_email,
    pr.username,
    l.reason,
    l.delta,
    l.balance_after,
    p.name        as project_name,
    l.created_at
  from public.credit_ledger l
  join auth.users u on u.id = l.user_id
  left join public.profiles pr on pr.user_id = l.user_id
  left join public.projects p on p.id = l.project_id
  where public.is_admin();

comment on view public.admin_users is 'Admin only: every user with their credits, storage and activity. Empty for non-admins.';
comment on view public.admin_projects is 'Admin only: every project with its owner, size and AI usage. Empty for non-admins.';
comment on view public.admin_media is 'Admin only: every uploaded file with its owner and project. Empty for non-admins.';
comment on view public.admin_credit_activity is 'Admin only: the full credit ledger with names attached. Empty for non-admins.';

grant select on public.admin_users, public.admin_projects, public.admin_media,
                public.admin_credit_activity, public.project_storage to authenticated;

/* -------------------------------------------------------------------------
   4. Admin actions
   ------------------------------------------------------------------------- */

create or replace function public.admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users',        (select count(*) from auth.users),
    'admins',       (select count(*) from public.profiles where is_admin),
    'projects',     (select count(*) from public.projects),
    'assets',       (select count(*) from public.media_assets),
    'bytesUsed',    (select coalesce(sum(size_bytes), 0) from public.media_assets),
    'clips',        (select count(*) from public.clips),
    'aiRequests',   (select count(*) from public.ai_messages where role = 'user'),
    'aiEdits',      (select count(*) from public.editor_history where source = 'ai'),
    'exports',      (select count(*) from public.exports where status = 'completed'),
    'creditsSpent', (select coalesce(sum(-delta), 0) from public.credit_ledger where delta < 0),
    'activeToday',  (select count(distinct user_id) from public.editor_history
                     where created_at > now() - interval '24 hours'),
    'signupsWeek',  (select count(*) from auth.users where created_at > now() - interval '7 days')
  );
end;
$$;

-- Set a user's wallet. Any argument left null is left alone.
create or replace function public.admin_set_credits(
  p_user_id uuid,
  p_balance integer default null,
  p_unlimited boolean default null,
  p_refill_amount integer default null,
  p_refill_hours integer default null
)
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
  set balance         = coalesce(p_balance, balance),
      unlimited       = coalesce(p_unlimited, unlimited),
      refill_amount   = coalesce(p_refill_amount, refill_amount),
      refill_interval = coalesce(make_interval(hours => p_refill_hours), refill_interval)
  where user_id = p_user_id
  returning * into v_row;

  insert into public.credit_ledger (user_id, delta, balance_after, reason, metadata)
  values (p_user_id, 0, v_row.balance, 'admin_update',
          jsonb_build_object('by', auth.uid(), 'balance', p_balance, 'unlimited', p_unlimited,
                             'refillAmount', p_refill_amount, 'refillHours', p_refill_hours));

  return jsonb_build_object('balance', v_row.balance, 'unlimited', v_row.unlimited,
                            'refillAmount', v_row.refill_amount);
end;
$$;

-- Promote or demote another user. An admin can never demote themselves, so the
-- last door out of the room cannot be locked by accident.
create or replace function public.admin_set_admin(p_user_id uuid, p_is_admin boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot_change_own_admin_flag' using errcode = 'P0001';
  end if;

  update public.profiles set is_admin = p_is_admin where user_id = p_user_id;
  return jsonb_build_object('userId', p_user_id, 'isAdmin', p_is_admin);
end;
$$;

create or replace function public.admin_set_credit_cost(p_key text, p_cost integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.credit_costs set cost = p_cost where key = p_key;
  return jsonb_build_object('key', p_key, 'cost', p_cost);
end;
$$;

-- Returns the storage paths that have to be removed from the buckets, then
-- deletes the rows. The caller deletes the objects; Postgres must not touch
-- storage.objects directly or the files are orphaned in the backing store.
create or replace function public.admin_delete_project(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paths text[];
  v_export_paths text[];
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select name into v_name from public.projects where id = p_project_id;
  if v_name is null then
    raise exception 'project_not_found';
  end if;

  -- Only paths no surviving project still references.
  select coalesce(array_agg(distinct m.storage_path), '{}')
  into v_paths
  from public.media_assets m
  where m.project_id = p_project_id
    and not exists (
      select 1 from public.media_assets o
      where o.storage_path = m.storage_path and o.project_id <> p_project_id
    );

  select coalesce(array_agg(e.output_path), '{}')
  into v_export_paths
  from public.exports e
  where e.project_id = p_project_id and e.output_path is not null;

  delete from public.projects where id = p_project_id;

  return jsonb_build_object('name', v_name, 'mediaPaths', v_paths, 'exportPaths', v_export_paths);
end;
$$;

-- The same information for a project the caller owns, used by the normal
-- delete flow so it can clean the buckets before the rows disappear.
create or replace function public.project_storage_paths(p_project_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_paths text[];
  v_export_paths text[];
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct m.storage_path), '{}')
  into v_paths
  from public.media_assets m
  where m.project_id = p_project_id
    and not exists (
      select 1 from public.media_assets o
      where o.storage_path = m.storage_path and o.project_id <> p_project_id
    );

  select coalesce(array_agg(e.output_path), '{}')
  into v_export_paths
  from public.exports e
  where e.project_id = p_project_id and e.output_path is not null;

  return jsonb_build_object('mediaPaths', v_paths, 'exportPaths', v_export_paths);
end;
$$;

-- Storage paths whose asset row is gone: leftovers from an interrupted delete.
create or replace function public.admin_orphaned_paths()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name, 'size',
                                         (o.metadata ->> 'size')::bigint))
     from storage.objects o
     where o.bucket_id in ('media', 'exports')
       and not exists (select 1 from public.media_assets m where m.storage_path = o.name)
       and not exists (select 1 from public.exports e where e.output_path = o.name)),
    '[]'::jsonb);
end;
$$;

grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_set_credits(uuid, integer, boolean, integer, integer) to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;
grant execute on function public.admin_set_credit_cost(text, integer) to authenticated;
grant execute on function public.admin_delete_project(uuid) to authenticated;
grant execute on function public.admin_orphaned_paths() to authenticated;
grant execute on function public.project_storage_paths(uuid) to authenticated;
