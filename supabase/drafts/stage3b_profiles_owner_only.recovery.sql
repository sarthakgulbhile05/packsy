-- Stage 3b recovery. Use ONLY if the probe says 'PARTIAL', and only after explicit approval.
-- Returns the profiles read rule to its exact pre-3b state from 20261027070000_create_profiles.sql.
-- No data changes, so no row guard is needed. Safe after any prefix of the migration.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
             and policyname = 'Users can see their own profile') then
    alter policy "Users can see their own profile" on public.profiles rename to "Profiles are visible to logged-in users";
  end if;
end $$;

alter policy "Profiles are visible to logged-in users" on public.profiles
  using (true);
