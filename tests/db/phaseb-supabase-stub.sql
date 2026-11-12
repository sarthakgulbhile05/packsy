-- Extra pieces of Supabase the Phase B draft relies on, for the local test databases only (PGlite and the throwaway
-- Postgres in phaseb-concurrency.mjs). Loaded after tests/db/local-supabase.ts's stub and the migrations, before the
-- draft. Shapes follow Supabase's: auth.jwt() reads the request's claims; storage.objects has owner_id (text) and
-- storage.foldername() returns the folders of a path. NOT a copy of Supabase's code; verify against the real project.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant execute on function auth.jwt() to anon, authenticated;

create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner_id text,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to anon, authenticated;
