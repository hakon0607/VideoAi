-- Minimal stand-in for the parts of Supabase the migrations touch, so the whole
-- schema can be applied and exercised against a plain Postgres in CI.
-- This file is NEVER run against a real Supabase project.
create schema if not exists auth;
create schema if not exists storage;
create extension if not exists "pgcrypto";

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

-- The current user is carried in a GUC, exactly like Supabase does with the JWT.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

do $$ begin
  create role authenticated;
exception when duplicate_object then null; end $$;
do $$ begin
  create role anon;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role;
exception when duplicate_object then null; end $$;

grant usage on schema public to authenticated, anon, service_role;
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema storage to authenticated, anon, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;

grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant select, insert, update, delete on auth.users to service_role;
