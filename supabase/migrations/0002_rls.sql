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
