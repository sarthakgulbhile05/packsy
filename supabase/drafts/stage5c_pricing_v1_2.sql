-- STAGE 5c DRAFT: pricing policy v1.2 (FD-9, buyer fee 5% -> 3%). NOT APPLIED anywhere, and deliberately not in
-- supabase/migrations. Dev runs stage 5a (v1.1, 5%) and must stay unchanged until applying this is approved.
-- See docs/pricing-policy.md and docs/payments/settlement-policy-review.md section 15.
--
-- Changes only accept_offer:
--   * the buyer fee is 300 bps of the product value (was 500); the traveller fee stays 1000 bps of the gross reward;
--   * snapshots record policy '1.2';
--   * the caller states the policy version its price was shown under, and anything but '1.2' is refused before anything
--     is locked or written. The one-argument v1.1 function is dropped, so no caller can accept without stating a version.
-- Everything else (the Rs300 minimum, snapshot table, constraints, triggers, grants on other functions) is unchanged.
-- Existing snapshots keep their v1.1 figures: they are immutable and record what was agreed at the time.
-- The arithmetic mirrors src/lib/pricing.ts, and tests/db/pricing-stage5c.test.ts checks the two agree.

drop function public.accept_offer(uuid);

create function public.accept_offer(p_offer_id uuid, p_policy_version text)
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
  -- The buyer accepts the price the app showed. A caller on any other policy is refused before anything is locked or written.
  if p_policy_version is distinct from '1.2' then
    raise exception 'This offer was priced under a different pricing policy' using errcode = 'P0001';
  end if;
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
  v_buyer_fee := public.pricing_percent(v_product, 300);
  v_traveller_fee := public.pricing_percent(v_reward, 1000);

  update public.offers set status = 'accepted' where id = p_offer_id;
  insert into public.offer_pricing_snapshots (
    offer_id, request_id, policy_version, currency,
    product_price_amount, product_currency, fx_rate_to_inr, product_price_fixed,
    product_value_minor, gross_reward_minor, buyer_fee_minor, traveller_fee_minor, net_reward_minor,
    delivery_minor, other_costs_minor, other_costs_note, customs_estimate_minor,
    buyer_total_minor, orbitly_revenue_minor
  ) values (
    p_offer_id, v_request, '1.2', 'INR',
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

revoke execute on function public.accept_offer(uuid, text) from public, anon;
grant execute on function public.accept_offer(uuid, text) to authenticated;
