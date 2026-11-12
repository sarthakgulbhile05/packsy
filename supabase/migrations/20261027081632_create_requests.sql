-- A2: Product requests posted by shoppers. Minimal columns; the UI comes in Milestone 3.
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  shopper_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 200),
  product_url text check (
    product_url is null
    or (char_length(product_url) <= 2000 and product_url ~* '^https://')
  ),
  price_inr integer not null check (price_inr between 1 and 10000000),
  quantity integer not null default 1 check (quantity between 1 and 10),
  delivery_city text not null check (char_length(delivery_city) between 2 and 100),
  reward_inr integer not null check (reward_inr between 0 and 1000000),
  status text not null default 'open'
    check (status in ('open', 'matched', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index requests_shopper_id_idx on public.requests (shopper_id);

alter table public.requests enable row level security;

-- Browsing is allowed before phone verification.
create policy "Requests are visible to logged-in users"
  on public.requests for select
  to authenticated
  using (true);

-- Creating needs a verified phone, checked by the database on every insert.
create policy "Phone-verified users can create their own requests"
  on public.requests for insert
  to authenticated
  with check (
    shopper_id = (select auth.uid())
    and (select public.is_phone_verified())
  );

-- No update/delete policies yet, so nobody can change status or edit (Milestone 3).
-- Users can only fill in these columns; id, shopper_id, status, created_at use defaults.
revoke all on public.requests from anon, authenticated;
grant select on public.requests to authenticated;
grant insert (title, product_url, price_inr, quantity, delivery_city, reward_inr)
  on public.requests to authenticated;
