-- STAGE 4 RECOVERY: undoes supabase/drafts/stage4_two_way_marketplace.sql.
-- DESTRUCTIVE: drops trips, marketplace history and the request route/eligibility columns. Only safe before the
-- marketplace holds real data; afterwards, export first. One transaction: it either fully undoes stage 4 or
-- changes nothing. Tested in tests/db/marketplace-stage4.test.ts.
begin;

-- Offers: back to the stage 2 rule (no trip), before the trip column and matching rule go.
alter policy "Phone-verified travellers can offer on others' open requests" on public.offers
  with check (
    traveller_id = (select auth.uid())
    and (select public.is_phone_verified())
    and arrival_date >= current_date
    and exists (
      select 1
      from public.requests r
      where r.id = request_id
        and r.shopper_id <> (select auth.uid())
        and r.status = 'open'
        and (r.expires_at is null or r.expires_at > now())
    )
  );
drop trigger offers_log_submitted on public.offers;
drop function public.log_offer_submitted();
drop table public.marketplace_events;

drop function public.accept_offer(uuid), public.decline_offer(uuid), public.withdraw_offer(uuid),
  public.cancel_request(uuid), public.complete_request(uuid), public.matching_requests(uuid), public.matching_trips(uuid);
drop function public.trip_can_offer(uuid, uuid);

-- Reading: back to the stage 3a rule (owners, plus everyone for open, unexpired requests).
alter policy "Owners see their own requests" on public.requests rename to "Requests are visible to logged-in users";
alter policy "Requests are visible to logged-in users" on public.requests
  using (
    shopper_id = (select auth.uid())
    or (status = 'open' and expires_at > now())
  );
comment on policy "Requests are visible to logged-in users" on public.requests is
  'Owners see their own requests in any status. Other signed-in users see only published (open), unexpired requests.';
alter table public.offers drop column trip_id;
drop function public.trip_matches_request(public.trips, public.requests);
drop table public.trips;

-- Publishing: the stage 3a function, unchanged.
create or replace function public.publish_request(p_request_id uuid)
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

alter table public.requests
  drop constraint requests_route_pair,
  drop column source_country,
  drop column destination_country,
  drop column eligibility_status;

commit;
