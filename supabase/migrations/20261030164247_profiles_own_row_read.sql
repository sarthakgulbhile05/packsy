-- Profiles: each signed-in user reads only their own row. Applied to the dev project 2026-10-30 (approved).
-- The app only reads the signed-in user's own profile (src/app/profile/page.tsx, src/app/profile/actions.ts).
begin;

drop policy "Profiles are visible to logged-in users" on public.profiles;

create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

commit;
