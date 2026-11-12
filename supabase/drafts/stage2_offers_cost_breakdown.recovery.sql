-- Stage 2 recovery. Use ONLY if the probe says 'PARTIAL', and only after explicit approval.
-- Returns public.offers to exactly its pre-stage-2 shape. Refuses to run if any offer rows exist.
do $$
begin
  if exists (select 1 from public.offers) then
    raise exception 'public.offers has rows; stop and review by hand before any recovery';
  end if;
end $$;

drop index if exists public.offers_one_accepted_per_request;

-- Original insert rule from 20261027081644_create_offers.sql.
alter policy "Phone-verified travellers can offer on others' open requests" on public.offers
  with check (
    traveller_id = (select auth.uid())
    and (select public.is_phone_verified())
    and exists (
      select 1
      from public.requests r
      where r.id = request_id
        and r.shopper_id <> (select auth.uid())
        and r.status = 'open'
    )
  );

-- Dropping the columns also removes their insert grants and comments.
alter table public.offers
  drop constraint if exists offers_complete,
  drop constraint if exists offers_other_costs_explained,
  drop constraint if exists offers_inr_rate_is_one,
  drop constraint if exists offers_product_price_inr_range,
  drop column if exists estimated_total_inr,
  drop column if exists agreed_total_inr,
  drop column if exists product_price_inr,
  drop column if exists product_price_amount, drop column if exists product_currency,
  drop column if exists fx_rate_to_inr, drop column if exists product_price_fixed,
  drop column if exists customs_estimate_inr, drop column if exists customs_note,
  drop column if exists delivery_inr, drop column if exists other_costs_inr, drop column if exists other_costs_note,
  drop column if exists arrival_date, drop column if exists handoff_method, drop column if exists declares_lawful_import,
  drop constraint if exists offers_status_check,
  add constraint offers_status_check check (status in ('pending', 'accepted', 'rejected', 'withdrawn'));

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.offers'::regclass and conname = 'offers_service_fee_inr_check') then
    alter table public.offers rename constraint offers_service_fee_inr_check to offers_reward_inr_check;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'offers' and column_name = 'service_fee_inr') then
    alter table public.offers rename column service_fee_inr to reward_inr;
  end if;
end $$;
