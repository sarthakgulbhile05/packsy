-- Stage 3a probe (read-only). Says whether requests_drafts_and_publish is 'applied', 'not applied' or 'PARTIAL'.
with s as (
  select
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'requests'
       and column_name = 'status' and column_default like '''draft''%') as default_draft,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'requests'
       and column_name = 'status' and column_default like '''open''%') as default_open,
    (select count(*) from pg_constraint where conrelid = 'public.requests'::regclass and conname = 'requests_published_dates') as dates_check,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'requests' and cmd = 'SELECT' and qual = 'true') as read_policy_old,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'requests' and cmd = 'SELECT' and qual like '%expires_at%') as read_policy_new,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'requests' and cmd = 'INSERT' and with_check like '%draft%') as insert_policy_new,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'requests' and cmd = 'UPDATE') as update_policy,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'requests' and cmd = 'DELETE') as delete_policy,
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'publish_request') as publish_fn,
    (select count(*) from pg_proc p where pronamespace = 'public'::regnamespace and proname = 'publish_request'
       and has_function_privilege('anon', p.oid, 'execute')) as publish_fn_anon,
    (select count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'requests'
       and grantee = 'authenticated' and privilege_type = 'INSERT') as insert_grants,
    (select count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'requests'
       and grantee = 'authenticated' and privilege_type = 'INSERT' and column_name in ('price_inr', 'reward_inr')) as legacy_insert_grants,
    (select count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'requests'
       and grantee = 'authenticated' and privilege_type = 'UPDATE') as update_grants,
    (select count(*) from information_schema.table_privileges where table_schema = 'public' and table_name = 'requests'
       and grantee = 'authenticated' and privilege_type = 'DELETE') as delete_grant,
    (select count(*) from pg_policy where polrelid = 'public.requests'::regclass
       and obj_description(oid, 'pg_policy') is not null) as policy_comments,
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'publish_request'
       and obj_description(oid, 'pg_proc') is not null) as function_comments,
    (select count(*) from supabase_migrations.schema_migrations where name = 'requests_drafts_and_publish') as history,
    (select count(*) from public.requests) as rows
)
select *, case
  when default_draft = 1 and dates_check = 1 and read_policy_new = 1 and insert_policy_new = 1 and update_policy = 1
    and delete_policy = 1 and publish_fn = 1 and publish_fn_anon = 0 and insert_grants = 14 and legacy_insert_grants = 0
    and update_grants = 14 and delete_grant = 1 and policy_comments = 1 and function_comments = 1 then 'applied'
  when default_open = 1 and dates_check = 0 and read_policy_old = 1 and insert_policy_new = 0 and update_policy = 0
    and delete_policy = 0 and publish_fn = 0 and insert_grants = 6 and legacy_insert_grants = 2
    and update_grants = 0 and delete_grant = 0 and policy_comments = 0 then 'not applied'
  else 'PARTIAL' end as state
from s;
