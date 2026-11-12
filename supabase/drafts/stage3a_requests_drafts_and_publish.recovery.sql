-- Stage 3a recovery. Use ONLY if the probe says 'PARTIAL', and only after explicit approval.
-- Returns public.requests to exactly its post-stage-2 shape. Safe to run after any prefix of the migration.
-- Refuses to run if any request rows exist: restoring the old "everyone can read" rule would expose
-- drafts, and published rows would lose their meaning. Such a case needs review by hand.
do $$
begin
  if exists (select 1 from public.requests) then
    raise exception 'public.requests has rows; stop and review by hand before any recovery';
  end if;
end $$;

drop function if exists public.publish_request(uuid);

-- A table-level revoke also removes every column-level update grant.
revoke update, delete on public.requests from authenticated;
revoke insert (
  description, item_kind, attributes, item_condition, budget_amount, budget_currency,
  origin_preference, needed_by, notes, preview_image_url
) on public.requests from authenticated;
grant insert (price_inr, reward_inr) on public.requests to authenticated;

drop policy if exists "Owners can delete their own drafts" on public.requests;
drop policy if exists "Owners can edit their own drafts" on public.requests;

-- Original rules from 20261027081632_create_requests.sql.
alter policy "Phone-verified users can create their own requests" on public.requests
  with check (
    shopper_id = (select auth.uid())
    and (select public.is_phone_verified())
  );
alter policy "Requests are visible to logged-in users" on public.requests
  using (true);
comment on policy "Requests are visible to logged-in users" on public.requests is null;

alter table public.requests
  drop constraint if exists requests_published_dates,
  alter column status set default 'open';
