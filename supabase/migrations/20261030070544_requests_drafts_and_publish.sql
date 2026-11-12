-- STAGE 3a DRAFT: requests_drafts_and_publish. NOT APPLIED anywhere. Kept outside supabase/migrations so no
-- tool can push it by accident. See docs/buyer-request-flow-plan.md §3.
--
-- Buyers' requests become private drafts until the owner publishes them:
--   draft            → readable by its owner only; editable and deletable by its owner only
--   open, unexpired  → readable by every signed-in user (travellers); no longer editable or deletable
--   anything else    → owner only (expired, matched, completed, cancelled)
-- Only publish_request() moves draft → open, and only it sets published_at and expires_at.
-- Photos (image_path) arrive with stage 5: until then clients can't set it and publishing refuses one.
-- Statement order: the table rule first, then narrowing changes, then new abilities, grants last.

-- 1. One statement: new requests are drafts, and anything not a draft must carry valid publication dates.
-- (Dev has 0 requests. If legacy open rows without dates existed, this statement fails and changes nothing.)
alter table public.requests
  alter column status set default 'draft',
  add constraint requests_published_dates
    check (status = 'draft' or (published_at is not null and expires_at > published_at));

-- 2. Deprecated prototype fields: no longer writable by clients.
revoke insert (price_inr, reward_inr) on public.requests from authenticated;

-- 3. Reading: your own requests in any status; other people's only while published and unexpired.
alter policy "Requests are visible to logged-in users" on public.requests
  using (
    shopper_id = (select auth.uid())
    or (status = 'open' and expires_at > now())
  );

-- 4. Creating: phone-verified, as yourself, and always an undated draft without a photo.
alter policy "Phone-verified users can create their own requests" on public.requests
  with check (
    shopper_id = (select auth.uid())
    and (select public.is_phone_verified())
    and status = 'draft'
    and published_at is null
    and expires_at is null
    and image_path is null
  );

-- 5. Editing: owners, drafts only, and the row must still be your undated draft afterwards.
create policy "Owners can edit their own drafts"
  on public.requests for update
  to authenticated
  using (shopper_id = (select auth.uid()) and status = 'draft')
  with check (
    shopper_id = (select auth.uid())
    and status = 'draft'
    and published_at is null
    and expires_at is null
    and image_path is null
  );

-- 6. Deleting: owners, drafts only. Published requests are cancelled in stage 4 instead.
create policy "Owners can delete their own drafts"
  on public.requests for delete
  to authenticated
  using (shopper_id = (select auth.uid()) and status = 'draft');

-- 7. The only way a request becomes visible to travellers.
create function public.publish_request(p_request_id uuid)
returns timestamptz
language plpgsql
security definer  -- needed to set status and dates, which clients are never granted
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_needed_by date;
  v_image_path text;
  v_expires timestamptz;
begin
  -- Lock the caller's own row; anyone else's request (or none) gets the same answer.
  select status, needed_by, image_path into v_status, v_needed_by, v_image_path
    from public.requests
    where id = p_request_id and shopper_id = v_uid
    for update;
  if v_uid is null or not found then
    raise exception 'Request not found or not allowed' using errcode = '42501';
  end if;
  if not public.is_phone_verified() then
    raise exception 'Verify your phone number before publishing' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only drafts can be published' using errcode = 'P0001';
  end if;
  if v_needed_by is not null and v_needed_by < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'The needed-by date has passed; change it before publishing' using errcode = 'P0001';
  end if;
  if v_image_path is not null then
    raise exception 'Photos can''t be published until image storage is set up' using errcode = 'P0001';
  end if;

  -- Open for 30 days, or until the end of the needed-by day in India if that's sooner (least ignores null).
  v_expires := least(now() + interval '30 days', ((v_needed_by + 1)::timestamp at time zone 'Asia/Kolkata'));

  update public.requests
    set status = 'open', published_at = now(), expires_at = v_expires
    where id = p_request_id;
  return v_expires;
end;
$$;

revoke execute on function public.publish_request(uuid) from public, anon;

grant execute on function public.publish_request(uuid) to authenticated;

-- 8. Last, so permissions only widen once every rule above exists: the fields the request form fills in.
-- Never granted: id, shopper_id, status, published_at, expires_at, created_at, updated_at, image_path,
-- listed_price_amount/currency (not in the form), price_inr and reward_inr (deprecated).
grant insert (
  description, item_kind, attributes, item_condition, budget_amount, budget_currency,
  origin_preference, needed_by, notes, preview_image_url
) on public.requests to authenticated;

grant update (
  title, description, product_url, item_kind, attributes, item_condition, quantity,
  budget_amount, budget_currency, origin_preference, delivery_city, needed_by, notes, preview_image_url
) on public.requests to authenticated;

grant delete on public.requests to authenticated;

comment on function public.publish_request(uuid) is
  'Owner with a verified phone publishes their own draft: status open, published_at now, expires_at the sooner of 30 days or the end of needed_by (IST). The only way a request becomes visible to other users.';

comment on policy "Requests are visible to logged-in users" on public.requests is
  'Owners see their own requests in any status. Other signed-in users see only published (open), unexpired requests.';
