-- STAGE 4 DRAFT: two_way_marketplace. NOT APPLIED anywhere. Kept outside supabase/migrations so no tool can
-- push it by accident. Tested in tests/db/marketplace-stage4.test.ts on top of every applied migration.
--
-- One marketplace, any direction: requests and trips both carry a route (ISO 3166-1 alpha-2 country codes).
-- A trip matches a request only when the route is identical in the same direction, the dates work, both are
-- live, and the item isn't marked restricted or prohibited. That rule lives in ONE place:
-- public.trip_matches_request(), used by the offer policy and by both discovery functions.
--
-- Privacy: trips and requests are both readable only by their owner. Buyers see only trips that match their own
-- published request (matching_trips: no traveller id or notes); travellers see only requests that match their own
-- trip (matching_requests: no buyer id). Nobody can list everyone's requests or read who posted one.
-- Lifecycle changes (accept, decline, withdraw, cancel, complete) go through functions that lock the row and
-- re-check who is asking. Clients are never granted status, eligibility or verification columns.
-- Statement order: columns and tables, the shared rule, policies, functions, grants last. One transaction: all or nothing.
begin;

-- 1. Routes on requests. Both set, or both empty (drafts may be unfinished); never the same country twice.
-- eligibility_status is set by Orbitly review only; 'unknown' until someone reviews it.
alter table public.requests
  add column source_country text check (source_country ~ '^[A-Z]{2}$'),
  add column destination_country text check (destination_country ~ '^[A-Z]{2}$'),
  add column eligibility_status text not null default 'unknown'
    check (eligibility_status in ('unknown', 'eligible', 'review_required', 'restricted', 'prohibited')),
  add constraint requests_route_pair check (
    (source_country is null) = (destination_country is null)
    and (source_country is null or source_country <> destination_country)
  );

create index requests_open_route_idx on public.requests (source_country, destination_country)
  where status = 'open';

-- 2. Trips: a traveller's journey between two countries.
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  traveller_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  departure_country text not null check (departure_country ~ '^[A-Z]{2}$'),
  destination_country text not null check (destination_country ~ '^[A-Z]{2}$'),
  departure_date date not null,
  arrival_date date not null,
  capacity_kg numeric(5, 1) check (capacity_kg > 0 and capacity_kg <= 100),
  notes text check (char_length(notes) <= 500),
  status text not null default 'active' check (status in ('active', 'cancelled', 'completed')),
  -- Nothing verifies trips yet, so every trip is 'unverified' until a real check exists.
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_route check (departure_country <> destination_country),
  constraint trips_dates check (arrival_date >= departure_date and arrival_date <= departure_date + 30)
);

create index trips_traveller_id_idx on public.trips (traveller_id);
create index trips_active_route_idx on public.trips (departure_country, destination_country, arrival_date)
  where status = 'active';

create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

alter table public.trips enable row level security;

-- 3. The one matching rule. SECURITY INVOKER: it only compares the two rows it is given.
create function public.trip_matches_request(t public.trips, r public.requests)
returns boolean
language sql
stable
set search_path = ''
as $$
  select t.status = 'active'
    and r.status = 'open'
    and r.expires_at > now()
    and t.departure_country = r.source_country
    and t.destination_country = r.destination_country
    and t.traveller_id <> r.shopper_id
    and t.arrival_date >= current_date
    and (r.needed_by is null or t.arrival_date <= r.needed_by)
    and r.eligibility_status not in ('restricted', 'prohibited');
$$;
-- Only called inside the functions below, never by clients.
revoke execute on function public.trip_matches_request(public.trips, public.requests) from public, anon, authenticated;

-- 4. Trip rules: owners only. New trips are active, unverified, phone-verified, and not in the past.
create policy "Travellers see their own trips"
  on public.trips for select
  to authenticated
  using (traveller_id = (select auth.uid()));

create policy "Phone-verified travellers can add their own trips"
  on public.trips for insert
  to authenticated
  with check (
    traveller_id = (select auth.uid())
    and (select public.is_phone_verified())
    and status = 'active'
    and verification_status = 'unverified'
    and departure_date >= current_date
  );

-- Editing: your own active trip; afterwards it must be active or cancelled (never completed or verified).
create policy "Travellers can edit or cancel their own active trips"
  on public.trips for update
  to authenticated
  using (traveller_id = (select auth.uid()) and status = 'active')
  with check (
    traveller_id = (select auth.uid())
    and status in ('active', 'cancelled')
    and verification_status = 'unverified'
  );

-- 5. Offers now come from a trip that matches the request (same rule as discovery).
alter table public.offers
  add column trip_id uuid references public.trips (id) on delete set null;
create index offers_trip_id_idx on public.offers (trip_id);

-- Requests are owner-only from now on (section 5b), so the offer check reads the request through a helper.
create function public.trip_can_offer(p_trip_id uuid, p_request_id uuid)
returns boolean
language sql
stable
security definer  -- reads someone else's open request, which the caller can no longer select directly
set search_path = ''
as $$
  select exists (
    select 1
    from public.trips t
    join public.requests r on r.id = p_request_id
    where t.id = p_trip_id
      and t.traveller_id = (select auth.uid())
      and public.trip_matches_request(t, r)
  );
$$;
revoke execute on function public.trip_can_offer(uuid, uuid) from public, anon;
grant execute on function public.trip_can_offer(uuid, uuid) to authenticated;

alter policy "Phone-verified travellers can offer on others' open requests" on public.offers
  with check (
    traveller_id = (select auth.uid())
    and (select public.is_phone_verified())
    and arrival_date >= current_date
    and public.trip_can_offer(trip_id, request_id)
  );

-- 5b. Audit I3: until now any signed-in user could select every open request, every column, including the
-- buyer's account id. Requests become owner-only; travellers reach open requests only through
-- matching_requests() below, which returns named columns and never shopper_id.
alter policy "Requests are visible to logged-in users" on public.requests
  using (shopper_id = (select auth.uid()));
alter policy "Requests are visible to logged-in users" on public.requests rename to "Owners see their own requests";
comment on policy "Owners see their own requests" on public.requests is
  'Owners see their own requests in any status. Other users never select requests directly: travellers see matching open requests through matching_requests(), without the buyer''s id.';

-- 6. Publishing now also needs a route. Same function as stage 3a, plus the route check.
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
  v_source text;
  v_expires timestamptz;
begin
  select status, needed_by, image_path, source_country into v_status, v_needed_by, v_image_path, v_source
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
  if v_source is null then
    raise exception 'Choose where the item is coming from and going to before publishing' using errcode = 'P0001';
  end if;
  if v_needed_by is not null and v_needed_by < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'The needed-by date has passed; change it before publishing' using errcode = 'P0001';
  end if;
  if v_image_path is not null then
    raise exception 'Photos can''t be published until image storage is set up' using errcode = 'P0001';
  end if;

  v_expires := least(now() + interval '30 days', ((v_needed_by + 1)::timestamp at time zone 'Asia/Kolkata'));

  update public.requests
    set status = 'open', published_at = now(), expires_at = v_expires
    where id = p_request_id;
  insert into public.marketplace_events (request_id, actor_id, event) values (p_request_id, v_uid, 'request_published');
  return v_expires;
end;
$$;

-- 7. Discovery. Both start from a row the caller owns.
-- Requests that match one of my trips: only what a traveller needs to decide, never the buyer's id.
-- SECURITY DEFINER because requests are owner-only; it starts from the caller's own trip.
create function public.matching_requests(p_trip_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  product_url text,
  preview_image_url text,
  item_kind text,
  item_condition text,
  quantity integer,
  budget_amount numeric,
  budget_currency text,
  source_country text,
  destination_country text,
  delivery_city text,
  needed_by date,
  eligibility_status text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.title, r.description, r.product_url, r.preview_image_url, r.item_kind, r.item_condition, r.quantity,
         r.budget_amount, r.budget_currency, r.source_country, r.destination_country, r.delivery_city, r.needed_by,
         r.eligibility_status, r.published_at
  from public.trips t
  join public.requests r on public.trip_matches_request(t, r)
  where t.id = p_trip_id and t.traveller_id = (select auth.uid())
  order by r.published_at desc
  limit 50;
$$;
revoke execute on function public.matching_requests(uuid) from public, anon;
grant execute on function public.matching_requests(uuid) to authenticated;

-- Trips that match one of my requests. SECURITY DEFINER because trips are owner-only; it returns route and
-- dates only (no traveller id, notes or capacity), and only for the caller's own request.
create function public.matching_trips(p_request_id uuid)
returns table (
  trip_id uuid,
  departure_country text,
  destination_country text,
  departure_date date,
  arrival_date date,
  verification_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.departure_country, t.destination_country, t.departure_date, t.arrival_date, t.verification_status
  from public.requests r
  join public.trips t on public.trip_matches_request(t, r)
  where r.id = p_request_id and r.shopper_id = (select auth.uid())
  order by t.arrival_date
  limit 50;
$$;
revoke execute on function public.matching_trips(uuid) from public, anon;
grant execute on function public.matching_trips(uuid) to authenticated;

-- 8. History: an append-only record of every marketplace step. Written only by the functions below and the
-- offer trigger; nobody is granted insert, update or delete. The buyer sees their request's events; a
-- traveller sees events about their own offers.
create table public.marketplace_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests (id) on delete cascade,
  offer_id uuid references public.offers (id) on delete cascade,
  actor_id uuid,
  event text not null check (event in (
    'request_published', 'offer_submitted', 'offer_accepted', 'offer_declined', 'offer_withdrawn',
    'offer_closed', 'request_cancelled', 'request_completed'
  )),
  created_at timestamptz not null default now()
);
create index marketplace_events_request_idx on public.marketplace_events (request_id, created_at);
create index marketplace_events_offer_idx on public.marketplace_events (offer_id);
alter table public.marketplace_events enable row level security;

create policy "Buyers see their request's history; travellers see their offers' history"
  on public.marketplace_events for select
  to authenticated
  using (
    exists (select 1 from public.requests r where r.id = request_id and r.shopper_id = (select auth.uid()))
    or exists (select 1 from public.offers o where o.id = offer_id and o.traveller_id = (select auth.uid()))
  );

create function public.log_offer_submitted()
returns trigger
language plpgsql
security definer  -- writes history, which no client may insert into
set search_path = ''
as $$
begin
  insert into public.marketplace_events (request_id, offer_id, actor_id, event)
    values (new.request_id, new.id, new.traveller_id, 'offer_submitted');
  return new;
end;
$$;
revoke execute on function public.log_offer_submitted() from public, anon, authenticated;
create trigger offers_log_submitted
  after insert on public.offers
  for each row execute function public.log_offer_submitted();

-- 9. Lifecycle. Every step locks the request row first and only then touches its offers (one lock order,
-- so concurrent steps queue rather than deadlock), and every update re-checks the status it expects, so a
-- withdrawn or declined offer can never be accepted by a step that started a moment earlier.

-- The buyer accepts one pending offer on their open request: other pending offers close, the request is matched.
create function public.accept_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_request uuid := (select request_id from public.offers where id = p_offer_id);
begin
  perform 1 from public.requests
    where id = v_request and shopper_id = v_uid and status = 'open'
    for update;
  if v_uid is null or not found then
    raise exception 'Offer not found or not allowed' using errcode = '42501';
  end if;
  perform 1 from public.offers o
    join public.trips t on t.id = o.trip_id and t.status = 'active'
    where o.id = p_offer_id and o.status = 'pending'
    for update of o;
  if not found then
    if exists (select 1 from public.offers where id = p_offer_id and status = 'pending') then
      raise exception 'This traveller''s trip is no longer active' using errcode = 'P0001';
    end if;
    raise exception 'Only pending offers can be accepted' using errcode = 'P0001';
  end if;

  update public.offers set status = 'accepted' where id = p_offer_id;
  insert into public.marketplace_events (request_id, offer_id, actor_id, event) values (v_request, p_offer_id, v_uid, 'offer_accepted');
  with closed as (
    update public.offers set status = 'closed' where request_id = v_request and status = 'pending' returning id
  )
  insert into public.marketplace_events (request_id, offer_id, actor_id, event)
    select v_request, id, v_uid, 'offer_closed' from closed;
  update public.requests set status = 'matched' where id = v_request;
end;
$$;

-- The buyer declines a pending offer on their own request.
create function public.decline_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_request uuid := (select request_id from public.offers where id = p_offer_id);
begin
  perform 1 from public.requests where id = v_request and shopper_id = v_uid for update;
  if v_uid is null or not found then
    raise exception 'Offer not found or not allowed' using errcode = '42501';
  end if;
  update public.offers set status = 'rejected' where id = p_offer_id and status = 'pending';
  if not found then
    raise exception 'Only pending offers can be declined' using errcode = 'P0001';
  end if;
  insert into public.marketplace_events (request_id, offer_id, actor_id, event) values (v_request, p_offer_id, v_uid, 'offer_declined');
end;
$$;

-- The traveller withdraws their own pending offer.
create function public.withdraw_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_request uuid := (select request_id from public.offers where id = p_offer_id and traveller_id = (select auth.uid()));
begin
  perform 1 from public.requests where id = v_request for update;
  if v_uid is null or not found then
    raise exception 'Offer not found or not allowed' using errcode = '42501';
  end if;
  update public.offers set status = 'withdrawn' where id = p_offer_id and traveller_id = v_uid and status = 'pending';
  if not found then
    raise exception 'Only pending offers can be withdrawn' using errcode = 'P0001';
  end if;
  insert into public.marketplace_events (request_id, offer_id, actor_id, event) values (v_request, p_offer_id, v_uid, 'offer_withdrawn');
end;
$$;

-- The buyer cancels their own open or matched request; any pending or accepted offer closes with it.
create function public.cancel_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  update public.requests set status = 'cancelled'
    where id = p_request_id and shopper_id = v_uid and status in ('open', 'matched');
  if v_uid is null or not found then
    raise exception 'Request not found or not allowed' using errcode = '42501';
  end if;
  insert into public.marketplace_events (request_id, actor_id, event) values (p_request_id, v_uid, 'request_cancelled');
  with closed as (
    update public.offers set status = 'closed' where request_id = p_request_id and status in ('pending', 'accepted') returning id
  )
  insert into public.marketplace_events (request_id, offer_id, actor_id, event)
    select p_request_id, id, v_uid, 'offer_closed' from closed;
end;
$$;

-- The buyer confirms they received the item: matched becomes completed.
create function public.complete_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  update public.requests set status = 'completed'
    where id = p_request_id and shopper_id = v_uid and status = 'matched';
  if v_uid is null or not found then
    raise exception 'Request not found or not allowed' using errcode = '42501';
  end if;
  insert into public.marketplace_events (request_id, actor_id, event) values (p_request_id, v_uid, 'request_completed');
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['accept_offer(uuid)', 'decline_offer(uuid)', 'withdraw_offer(uuid)', 'cancel_request(uuid)', 'complete_request(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- 10. Last, so permissions only widen once every rule above exists.
revoke all on public.trips from anon, authenticated;
grant select on public.trips to authenticated;
grant insert (departure_country, destination_country, departure_date, arrival_date, capacity_kg, notes)
  on public.trips to authenticated;
grant update (departure_date, arrival_date, capacity_kg, notes, status) on public.trips to authenticated;

grant insert (source_country, destination_country) on public.requests to authenticated;
grant update (source_country, destination_country) on public.requests to authenticated;
grant insert (trip_id) on public.offers to authenticated;
revoke all on public.marketplace_events from anon, authenticated;
-- Not actor_id: it would show a traveller the buyer's account id, and a buyer every traveller's.
grant select (id, request_id, offer_id, event, created_at) on public.marketplace_events to authenticated;

commit;
