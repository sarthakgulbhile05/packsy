-- Stage 2 probe (read-only). Says whether offers_cost_breakdown is 'applied', 'not applied' or 'PARTIAL'.
with s as (
  select
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'offers'
       and column_name in ('product_price_amount', 'product_currency', 'fx_rate_to_inr', 'product_price_fixed',
         'customs_estimate_inr', 'customs_note', 'delivery_inr', 'other_costs_inr', 'other_costs_note',
         'arrival_date', 'handoff_method', 'declares_lawful_import',
         'product_price_inr', 'agreed_total_inr', 'estimated_total_inr')) as new_columns,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'offers'
       and column_name = 'service_fee_inr') as renamed_fee,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'offers'
       and column_name = 'reward_inr') as old_fee,
    (select count(*) from pg_constraint where conrelid = 'public.offers'::regclass
       and conname in ('offers_product_price_inr_range', 'offers_inr_rate_is_one', 'offers_other_costs_explained', 'offers_complete')) as new_checks,
    (select count(*) from pg_constraint where conrelid = 'public.offers'::regclass
       and conname = 'offers_status_check' and pg_get_constraintdef(oid) like '%closed%') as new_status_check,
    (select count(*) from pg_constraint where conrelid = 'public.offers'::regclass and conname = 'offers_status_check') as any_status_check,
    (select count(*) from pg_constraint where conrelid = 'public.offers'::regclass and conname = 'offers_service_fee_inr_check') as renamed_fee_check,
    (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'offers_one_accepted_per_request') as accepted_idx,
    (select count(*) from pg_policies where tablename = 'offers' and cmd = 'INSERT' and with_check like '%expires_at%') as new_insert_policy,
    (select count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'offers'
       and grantee = 'authenticated' and privilege_type = 'INSERT') as insert_grants,
    (select count(*) from pg_attribute where attrelid = 'public.offers'::regclass and not attisdropped
       and col_description('public.offers'::regclass, attnum) is not null) as comments,
    (select count(*) from supabase_migrations.schema_migrations where name = 'offers_cost_breakdown') as history,
    (select count(*) from public.offers) as rows
)
select *, case
  when new_columns = 15 and renamed_fee = 1 and old_fee = 0 and new_checks = 4 and new_status_check = 1
    and renamed_fee_check = 1 and accepted_idx = 1 and new_insert_policy = 1 and insert_grants = 15 and comments = 5 then 'applied'
  when new_columns = 0 and renamed_fee = 0 and old_fee = 1 and new_checks = 0 and new_status_check = 0 and any_status_check = 1
    and renamed_fee_check = 0 and accepted_idx = 0 and new_insert_policy = 0 and insert_grants = 3 and comments = 0 then 'not applied'
  else 'PARTIAL' end as state
from s;
