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
