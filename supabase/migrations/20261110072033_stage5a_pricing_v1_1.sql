-- STAGE 5a DRAFT: pricing policy v1.1 and offer integrity. NOT APPLIED anywhere. Kept outside
-- supabase/migrations so no tool can push it by accident. Needs approval before it goes to dev.
-- See docs/pricing-policy.md and docs/security-remediation.md.
--
-- Why a migration: travellers insert offers straight into public.offers (column grants plus RLS), so the
-- app's server action is not the only way in. Everything below holds against direct API calls:
--   F-01 the minimum net reward          F-02 an offer's arrival date is its trip's, never the client's
--   F-04 the agreed price, frozen        F-09 trip dates can't move under live offers; accept re-checks the match
--   F-11 product images: https, named hosts only     F-13 trip_can_offer leaves the API-exposed schema
-- The arithmetic mirrors src/lib/pricing.ts, and tests/db/pricing-stage5a.test.ts checks the two agree.
--
-- Money is integer paise. Percentages round half up: (amount * bps + 5000) / 10000 with integer division.
-- Statement order: helper, checks, table, policies, functions, grants last. One transaction: all or nothing.

-- 1. The one rounding rule, for this file's arithmetic.
create function public.pricing_percent(p_amount bigint, p_bps integer)
returns bigint
language sql
immutable
set search_path = ''
as $$ select (p_amount * p_bps + 5000) / 10000 $$;
revoke execute on function public.pricing_percent(bigint, integer) from public, anon, authenticated;

-- 2. New offers must net the traveller at least ₹300 after Orbitly's 10%. Rewards are whole rupees, so 10%
-- is exact in paise and the net is 90 × the reward: ₹334 is the smallest reward that passes.
-- NOT VALID: existing rows aren't re-checked here; accept_offer below refuses any that fall short.
alter table public.offers
  add constraint offers_min_net_reward check (service_fee_inr::bigint * 90 >= 30000) not valid;

-- 2b. F-02: an offer arrives when its trip does. The trip's date always wins over anything the client sent
-- (the column stays insertable, so the app works before and after this migration). Invoker rights: a trip
-- that isn't the caller's reads as null, and the insert then fails the completeness and match checks.
create function public.offers_arrival_from_trip()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.arrival_date := (select t.arrival_date from public.trips t where t.id = new.trip_id);
  return new;
end;
$$;
revoke execute on function public.offers_arrival_from_trip() from public, anon, authenticated;
create trigger offers_arrival_from_trip
  before insert on public.offers
  for each row execute function public.offers_arrival_from_trip();

-- 2c. F-09: a trip's dates are part of every live offer made from it, so they can't change while one is
-- pending or accepted. Withdraw the offers (or cancel the trip) first. Definer: sees every offer on the trip.
create function public.trips_lock_dates_with_offers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.departure_date, new.arrival_date) is distinct from (old.departure_date, old.arrival_date)
     and exists (select 1 from public.offers o where o.trip_id = old.id and o.status in ('pending', 'accepted')) then
    raise exception 'This trip has offers in progress, so its dates can''t change' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.trips_lock_dates_with_offers() from public, anon, authenticated;
create trigger trips_lock_dates_with_offers
  before update of departure_date, arrival_date on public.trips
  for each row execute function public.trips_lock_dates_with_offers();

-- 2d. F-11: product preview images load in other people's browsers, so only https on a named host (no IP
-- literals, no credentials, no odd ports). The app's own check (safeImageUrl) is stricter still.
-- NOT VALID: existing rows aren't re-checked; new and edited rows are.
alter table public.requests
  add constraint requests_preview_image_https
    check (preview_image_url is null or preview_image_url ~* '^https://([a-z0-9-]+\.)+[a-z]{2,63}(:443)?([/?#]|$)') not valid;

-- 3. The price both sides agreed, frozen when the buyer accepts. One row per accepted offer, never changed.
create table public.offer_pricing_snapshots (
  offer_id uuid primary key references public.offers (id) on delete restrict,
  request_id uuid not null references public.requests (id) on delete restrict,
  policy_version text not null,
  currency text not null check (currency = 'INR'),
  -- The product as offered, and the traveller's own rate; product_value_minor is what the buyer fee is based on.
  product_price_amount numeric(12, 2) not null,
  product_currency text not null,
  fx_rate_to_inr numeric(12, 6) not null,
  product_price_fixed boolean not null,
  product_value_minor bigint not null check (product_value_minor > 0),
  gross_reward_minor bigint not null,
  buyer_fee_minor bigint not null,
  traveller_fee_minor bigint not null,
  net_reward_minor bigint not null check (net_reward_minor >= 30000),
  delivery_minor bigint not null check (delivery_minor >= 0),
  other_costs_minor bigint not null check (other_costs_minor >= 0),
  other_costs_note text,
  customs_estimate_minor bigint check (customs_estimate_minor >= 0),
  buyer_total_minor bigint not null,
  orbitly_revenue_minor bigint not null,
  created_at timestamptz not null default now(),
  check (net_reward_minor = gross_reward_minor - traveller_fee_minor),
  check (orbitly_revenue_minor = buyer_fee_minor + traveller_fee_minor),
  check (buyer_total_minor = product_value_minor + gross_reward_minor + buyer_fee_minor
    + delivery_minor + other_costs_minor + coalesce(customs_estimate_minor, 0))
);
alter table public.offer_pricing_snapshots enable row level security;

create policy "The buyer and the traveller see their own agreed price"
  on public.offer_pricing_snapshots for select to authenticated
  using (
    exists (select 1 from public.requests r where r.id = request_id and r.shopper_id = (select auth.uid()))
    or exists (select 1 from public.offers o where o.id = offer_id and o.traveller_id = (select auth.uid()))
  );

-- Auditable: no role, including the definer functions, may rewrite or remove a snapshot. A change of price
-- means a new offer and a new acceptance, not an edit.
create function public.offer_pricing_snapshots_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Agreed prices can''t be changed or deleted' using errcode = 'P0001';
end;
$$;
revoke execute on function public.offer_pricing_snapshots_immutable() from public, anon, authenticated;
create trigger offer_pricing_snapshots_no_change
  before update or delete on public.offer_pricing_snapshots
  for each row execute function public.offer_pricing_snapshots_immutable();

-- 4. Accepting an offer now also records its price, in the same transaction. Unchanged otherwise.
create or replace function public.accept_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_request uuid := (select request_id from public.offers where id = p_offer_id);
  o public.offers;
  t public.trips;
  r public.requests;
  v_product bigint;
  v_reward bigint;
  v_buyer_fee bigint;
  v_traveller_fee bigint;
begin
  select * into r from public.requests
    where id = v_request and shopper_id = v_uid and status = 'open'
    for update;
  if v_uid is null or not found then
    raise exception 'Offer not found or not allowed' using errcode = '42501';
  end if;
  -- Lock the offer and its trip together, so the trip can't change between this check and the snapshot.
  select o2.* into o from public.offers o2
    join public.trips t2 on t2.id = o2.trip_id and t2.status = 'active'
    where o2.id = p_offer_id and o2.status = 'pending'
    for update of o2, t2;
  if not found then
    if exists (select 1 from public.offers where id = p_offer_id and status = 'pending') then
      raise exception 'This traveller''s trip is no longer active' using errcode = 'P0001';
    end if;
    raise exception 'Only pending offers can be accepted' using errcode = 'P0001';
  end if;
  select * into t from public.trips where id = o.trip_id;
  -- F-09: the same rule that let the offer in must still hold, with the arrival date the offer promised.
  if not public.trip_matches_request(t, r) or o.arrival_date is distinct from t.arrival_date then
    raise exception 'This offer no longer matches the traveller''s trip' using errcode = 'P0001';
  end if;
  if o.service_fee_inr::bigint * 90 < 30000 then
    raise exception 'This offer''s reward is below Orbitly''s minimum' using errcode = 'P0001';
  end if;

  v_product := o.product_price_inr * 100;
  v_reward := o.service_fee_inr::bigint * 100;
  v_buyer_fee := public.pricing_percent(v_product, 500);
  v_traveller_fee := public.pricing_percent(v_reward, 1000);

  update public.offers set status = 'accepted' where id = p_offer_id;
  insert into public.offer_pricing_snapshots (
    offer_id, request_id, policy_version, currency,
    product_price_amount, product_currency, fx_rate_to_inr, product_price_fixed,
    product_value_minor, gross_reward_minor, buyer_fee_minor, traveller_fee_minor, net_reward_minor,
    delivery_minor, other_costs_minor, other_costs_note, customs_estimate_minor,
    buyer_total_minor, orbitly_revenue_minor
  ) values (
    p_offer_id, v_request, '1.1', 'INR',
    o.product_price_amount, o.product_currency, o.fx_rate_to_inr, o.product_price_fixed,
    v_product, v_reward, v_buyer_fee, v_traveller_fee, v_reward - v_traveller_fee,
    o.delivery_inr * 100, o.other_costs_inr * 100, o.other_costs_note, o.customs_estimate_inr * 100,
    v_product + v_reward + v_buyer_fee + o.delivery_inr * 100 + o.other_costs_inr * 100 + coalesce(o.customs_estimate_inr * 100, 0),
    v_buyer_fee + v_traveller_fee
  );
  insert into public.marketplace_events (request_id, offer_id, actor_id, event) values (v_request, p_offer_id, v_uid, 'offer_accepted');
  with closed as (
    update public.offers set status = 'closed' where request_id = v_request and status = 'pending' returning id
  )
  insert into public.marketplace_events (request_id, offer_id, actor_id, event)
    select v_request, id, v_uid, 'offer_closed' from closed;
  update public.requests set status = 'matched' where id = v_request;
end;
$$;

-- 4b. F-13: trip_can_offer only exists for the offer insert policy. Policies hold the function itself, not
-- its name, so moving it out of the API-exposed schema keeps the policy working while /rest/v1/rpc can no
-- longer call it. Signed-in users still need usage and execute, because policies run as the caller.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.trip_can_offer(uuid, uuid) set schema private;

-- 5. Grants last: read-only for signed-in parties (the policy narrows it); nobody writes but accept_offer.
revoke all on public.offer_pricing_snapshots from public, anon, authenticated;
grant select on public.offer_pricing_snapshots to authenticated;
