-- B1: DEVELOPMENT PROJECT ONLY. Never run this on production.
-- Kept outside supabase/migrations/ so it is never applied to production by accident.
--
-- Supabase calls this instead of an SMS company ("Send SMS" auth hook). It sends nothing
-- and does not store or log the code. Only the dashboard's test phone numbers (fixed
-- codes) can complete verification; any real number simply never receives a code.
create function public.dev_discard_sms(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  return '{}'::jsonb;
end;
$$;

-- Only Supabase Auth may call it; it is not reachable through the public API.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.dev_discard_sms(jsonb) to supabase_auth_admin;
revoke execute on function public.dev_discard_sms(jsonb) from public, anon, authenticated;
