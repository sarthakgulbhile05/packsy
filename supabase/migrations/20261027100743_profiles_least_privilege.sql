-- Least privilege for profiles, matching requests and offers.
-- Supabase's defaults gave anon and authenticated INSERT, DELETE, TRUNCATE, REFERENCES
-- and TRIGGER on this table. RLS already blocked inserts and deletes, but TRUNCATE ignores
-- RLS, so remove everything users don't need. Profiles are still created by the
-- handle_new_user trigger (security definer) and removed by "on delete cascade".
revoke all on public.profiles from anon, authenticated;

-- Keep exactly what the app uses: logged-in users read profiles and edit their own name.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
