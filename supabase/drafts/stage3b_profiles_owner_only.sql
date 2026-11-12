-- STAGE 3b DRAFT: profiles_owner_only. NOT APPLIED anywhere. Kept outside supabase/migrations so no
-- tool can push it by accident. See docs/buyer-request-flow-plan.md.
--
-- Today any signed-in user can read every profile's full name ("Profiles are visible to logged-in
-- users", using (true)). Nothing in the app needs that: the profile page reads only your own row, and
-- request and offer screens show no names yet. Showing a traveller's first name to a buyer comes later
-- through a narrow, reviewed function (decision D8), not by reopening this table.
-- Foreign keys from requests/offers to profiles are unaffected (constraint checks ignore RLS), and
-- handle_new_user (security definer) still creates profiles.

-- 1. Narrow the rule first, so there is never a moment with the old reach.
alter policy "Profiles are visible to logged-in users" on public.profiles
  using ((select auth.uid()) = id);

-- 2. Then give it an accurate name.
alter policy "Profiles are visible to logged-in users" on public.profiles
  rename to "Users can see their own profile";
