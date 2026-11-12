-- M1: richer buyer requests. Schema only: no new grants or policies, so clients can't write the new
-- columns. They are readable by signed-in users (existing table-wide SELECT) but stay empty until stage 3.
alter table public.requests
  add column description text check (char_length(description) <= 2000),
  add column item_kind text not null default 'other'
    check (item_kind in ('electronics', 'fashion', 'home', 'collectible', 'other')),
  add column attributes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(attributes) = 'object' and pg_column_size(attributes) <= 2048),
  add column item_condition text not null default 'any'
    check (item_condition in ('new', 'used_good', 'any')),
  add column listed_price_amount numeric(12, 2) check (listed_price_amount > 0 and listed_price_amount < 100000000),
  add column listed_price_currency text check (listed_price_currency in ('INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY', 'SGD')),
  add column budget_amount numeric(12, 2) check (budget_amount > 0 and budget_amount < 100000000),
  add column budget_currency text check (budget_currency in ('INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY', 'SGD')),
  add column origin_preference text check (char_length(origin_preference) <= 120),
  add column needed_by date,
  add column notes text check (char_length(notes) <= 1000),
  add column preview_image_url text
    check (preview_image_url is null or (char_length(preview_image_url) <= 2000 and preview_image_url ~* '^https?://')),
  add column image_path text check (char_length(image_path) <= 300),
  add column published_at timestamptz,
  add column expires_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add constraint requests_listed_price_pair check ((listed_price_amount is null) = (listed_price_currency is null)),
  add constraint requests_budget_pair check ((budget_amount is null) = (budget_currency is null));

-- Old prototype fields become optional. Kept (not dropped) until a separate cleanup is approved.
alter table public.requests alter column price_inr drop not null, alter column reward_inr drop not null;
comment on column public.requests.price_inr is 'Deprecated: replaced by budget_amount/budget_currency.';
comment on column public.requests.reward_inr is 'Deprecated: travellers set their fee on each offer.';

-- Add 'draft' and 'expired'. The default stays 'open' until stage 3 changes the read policy,
-- so a draft can never be visible to other users under today's "everyone can read" policy.
-- One statement, so there is never a moment without a status check.
alter table public.requests
  drop constraint requests_status_check,
  add constraint requests_status_check
    check (status in ('draft', 'open', 'matched', 'completed', 'cancelled', 'expired'));

-- Note: the "published rows must have dates" rule is NOT added here. While the default is still
-- 'open', it would reject every insert the current policy allows (caught in a local dry run).
-- It moves to stage 3, together with the 'draft' default and publish_request().

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger requests_set_updated_at
  before update on public.requests
  for each row execute function public.set_updated_at();

create index requests_open_created_idx on public.requests (created_at desc) where status = 'open';
