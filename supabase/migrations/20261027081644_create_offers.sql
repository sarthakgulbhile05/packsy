-- A3: Offers from travellers on shoppers' requests. Minimal columns; trip link and UI
-- come in Milestone 3.
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  traveller_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  reward_inr integer not null check (reward_inr between 0 and 1000000),
  message text check (char_length(message) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (request_id, traveller_id)  -- one offer per traveller per request
);

create index offers_traveller_id_idx on public.offers (traveller_id);

alter table public.offers enable row level security;

-- Creating needs a verified phone, on someone else's open request.
create policy "Phone-verified travellers can offer on others' open requests"
  on public.offers for insert
  to authenticated
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

-- Offers are private between the traveller and the request's owner.
create policy "Offers are visible to the traveller and the request owner"
  on public.offers for select
  to authenticated
  using (
    traveller_id = (select auth.uid())
    or exists (
      select 1
      from public.requests r
      where r.id = request_id
        and r.shopper_id = (select auth.uid())
    )
  );

-- No update/delete policies yet (accept/reject comes in Milestone 3).
revoke all on public.offers from anon, authenticated;
grant select on public.offers to authenticated;
grant insert (request_id, reward_inr, message) on public.offers to authenticated;
