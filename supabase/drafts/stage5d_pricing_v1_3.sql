-- STAGE 5d DRAFT: pricing policy v1.3 (founder decisions Q13a: no Rs300 minimum; Q13g: rewards Rs1 to Rs10,00,000,
-- whole rupees). NOT APPLIED anywhere, and
-- deliberately not in supabase/migrations. Applies on top of stage5c_pricing_v1_2.sql (also unapplied), which stays
-- as the record of v1.2. Dev runs stage 5a (v1.1: 5%, Rs300 net floor) and must stay unchanged until approved.
-- See docs/pricing-policy.md and docs/payments/settlement-policy-review.md section 16.
--
-- Changes:
--   * drops stage 5a's offers_min_net_reward check, and adds offers_service_fee_inr_at_least_one (Q13g: Rs0 refused;
--     the original 0 to 1,000,000 check stays, so valid rewards are whole rupees from 1 to 1,000,000). NOT VALID, so
--     older rows aren't re-checked; accept_offer refuses any of them below Rs1;
--   * replaces the snapshot's net_reward_minor >= 30000 check with >= 0, and adds a 100 to 100,000,000 paise check on
--     the gross reward (NOT VALID, existing snapshots untouched);
--   * accept_offer: no Rs300 refusal; snapshots record policy '1.3'; any caller version but '1.3' is refused
--     before anything is locked or written. Buyer fee 300 bps and commission 1000 bps are unchanged from v1.2.
-- Existing snapshots are untouched: the immutability trigger stays, and dropping a check rewrites no row.
-- The arithmetic mirrors src/lib/pricing.ts, and tests/db/pricing-stage5d.test.ts checks the two agree.

do $$
begin
  if to_regprocedure('public.accept_offer(uuid, text)') is null then
    raise exception 'Apply stage5c_pricing_v1_2.sql before this draft';
  end if;
end;
$$;

alter table public.offers drop constraint offers_min_net_reward;
alter table public.offers add constraint offers_service_fee_inr_at_least_one check (service_fee_inr >= 1) not valid;

alter table public.offer_pricing_snapshots drop constraint offer_pricing_snapshots_net_reward_minor_check;
alter table public.offer_pricing_snapshots add constraint offer_pricing_snapshots_net_reward_minor_check check (net_reward_minor >= 0);
alter table public.offer_pricing_snapshots
  add constraint offer_pricing_snapshots_gross_reward_minor_range check (gross_reward_minor between 100 and 100000000) not valid;

create or replace function public.accept_offer(p_offer_id uuid, p_policy_version text)
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
  if p_policy_version is distinct from '1.3' then
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

  if o.service_fee_inr < 1 then
    raise exception 'This offer''s reward isn''t valid' using errcode = 'P0001';
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
    p_offer_id, v_request, '1.3', 'INR',
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
