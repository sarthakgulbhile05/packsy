-- One profile per auth user, created automatically on sign-up.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 100),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Logged-in users can see everyone's profile (shoppers need to see travellers).
create policy "Profiles are visible to logged-in users"
  on public.profiles for select
  to authenticated
  using (true);

-- Users can edit only their own profile.
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Only full_name is user-editable; id and created_at stay fixed.
revoke update on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(new.raw_user_meta_data ->> 'full_name', 100));
  return new;
end;
$$;

-- Only the trigger should call this, never the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
