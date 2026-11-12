-- A1: Is the current user's phone verified? Supabase Auth's own record is the only
-- source of truth; nothing is copied into our tables.
create function public.is_phone_verified()
returns boolean
language sql
stable
security definer  -- needed to read auth.users, which normal users cannot see
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where id = (select auth.uid())   -- only ever the caller's own row
      and phone is not null
      and phone <> ''
      and phone_confirmed_at is not null
  );
$$;

-- Logged-in users may ask about themselves; logged-out visitors may not call it.
revoke execute on function public.is_phone_verified() from public, anon;
grant execute on function public.is_phone_verified() to authenticated;
