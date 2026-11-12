-- Stage 3b probe (read-only). Says whether profiles_owner_only is 'applied', 'not applied' or 'PARTIAL'.
with s as (
  select
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT') as select_policies,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
       and policyname = 'Profiles are visible to logged-in users' and qual = 'true') as old_rule,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
       and policyname = 'Users can see their own profile' and qual like '%auth.uid()%' and qual like '%= id%') as new_rule,
    (select count(*) from supabase_migrations.schema_migrations where name = 'profiles_owner_only') as history
)
select *, case
  when select_policies = 1 and new_rule = 1 then 'applied'
  when select_policies = 1 and old_rule = 1 then 'not applied'
  else 'PARTIAL' end as state
from s;
