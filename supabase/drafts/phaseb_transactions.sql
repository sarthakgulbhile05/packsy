-- PHASE B DRAFT: transaction records for buyer protection. NOT APPLIED to any database.
-- THIS MIGRATION HAS NOT BEEN APPLIED TO ANY REMOTE DATABASE. REAL PAYMENTS ARE DISABLED.
-- DO NOT APPLY: P0 OPEN. Payouts still use the net reward only, leaving out the product cost the traveller paid.
-- The fix needs founder decisions D1-D10 (docs/payments/financial-flow.md).
-- Kept outside supabase/migrations so no tool can push it by accident. Applying it to dev needs its own approval.
-- Design and review notes: docs/payments/phase-b-architecture.md. Undo (isolated test databases only, and only
-- while no record exists): supabase/drafts/phaseb_transactions.recovery.sql.
--
-- Mirrors the Phase A lifecycle in src/lib/payments/transaction.ts, which stays the reference: the rule table below
-- is the same table, row for row, and tests/db/transactions-phaseb.test.ts fails if they ever differ.
--
-- Depends on: public.profiles, public.requests (shopper_id, source_country, destination_country), public.offers
-- (traveller_id, status 'accepted'), public.offer_pricing_snapshots (Stage 5a), the private schema (Stage 5a),
-- auth.uid(), auth.jwt(), storage.buckets, storage.objects, storage.foldername(), and the roles anon and
-- authenticated. Creates two roles, orbitly_webhook and orbitly_system, with no login: a server login is granted
-- one of them separately (not in this file; no credentials here). The service role is granted nothing.
--
-- Money amounts are never copied onto an order: the accepted-price snapshot (immutable since Stage 5a) is the only
-- source. A money operation records the amount it asked the provider for.

-- 0. Server roles. Each can call exactly one narrow entry point (section 8); neither can read or write any table.
create role orbitly_webhook nologin;
create role orbitly_system nologin;
grant usage on schema private to orbitly_webhook, orbitly_system;

-- 1. The lifecycle rules (Phase A RULES). Read only by the functions below; no role is granted anything on it.
create table private.transaction_rules (
  event_type text primary key,
  from_states text[] not null,
  to_state text not null,
  roles text[] not null,
  needs_evidence boolean not null default false,
  amount_kind text check (amount_kind in ('due', 'payout')),
  -- For a provider's answer to an attempt (Phase A OUTCOMES): which attempt it settles, and whether money moved.
  outcome_kind text check (outcome_kind in ('payment', 'refund', 'payout')),
  outcome_success boolean,
  check ((outcome_kind is null) = (outcome_success is null))
);

insert into private.transaction_rules (event_type, from_states, to_state, roles, needs_evidence, amount_kind, outcome_kind, outcome_success) values
  ('request_payment', '{OFFER_ACCEPTED}', 'PAYMENT_PENDING', '{system}', false, null, null, null),
  ('payment_confirmed', '{PAYMENT_PENDING}', 'PAYMENT_CONFIRMED', '{provider}', false, 'due', 'payment', true),
  ('payment_failed', '{PAYMENT_PENDING}', 'PAYMENT_FAILED', '{provider}', false, null, 'payment', false),
  ('retry_payment', '{PAYMENT_FAILED,PAYMENT_CANCELLED}', 'PAYMENT_PENDING', '{system}', false, null, null, null),
  ('cancel_payment', '{PAYMENT_PENDING}', 'PAYMENT_CANCELLED', '{buyer,provider}', false, null, 'payment', false),
  ('cancel_order', '{OFFER_ACCEPTED,PAYMENT_FAILED,PAYMENT_CANCELLED}', 'ORDER_CANCELLED', '{buyer,traveller,admin}', false, null, null, null),
  ('request_purchase', '{PAYMENT_CONFIRMED}', 'TRAVELLER_PURCHASE_PENDING', '{system}', false, null, null, null),
  ('confirm_purchase', '{TRAVELLER_PURCHASE_PENDING}', 'PURCHASE_CONFIRMED', '{traveller}', true, null, null, null),
  ('report_cannot_purchase', '{TRAVELLER_PURCHASE_PENDING}', 'MANUAL_REVIEW_REQUIRED', '{traveller}', false, null, null, null),
  ('start_transit', '{PURCHASE_CONFIRMED}', 'IN_TRANSIT', '{traveller}', false, null, null, null),
  ('arrive', '{IN_TRANSIT}', 'DELIVERY_PENDING', '{traveller}', false, null, null, null),
  ('record_delivery', '{DELIVERY_PENDING}', 'DELIVERED', '{traveller}', true, null, null, null),
  ('request_buyer_confirmation', '{DELIVERED}', 'BUYER_CONFIRMATION_PENDING', '{system}', false, null, null, null),
  ('buyer_confirms_delivery', '{BUYER_CONFIRMATION_PENDING}', 'PAYOUT_ELIGIBLE', '{buyer}', false, null, null, null),
  ('flag_no_buyer_response', '{BUYER_CONFIRMATION_PENDING}', 'MANUAL_REVIEW_REQUIRED', '{system,admin}', false, null, null, null),
  ('start_payout', '{PAYOUT_ELIGIBLE,PAYOUT_FAILED}', 'PAYOUT_PROCESSING', '{admin}', false, null, null, null),
  ('payout_completed', '{PAYOUT_PROCESSING}', 'PAYOUT_COMPLETED', '{provider}', false, 'payout', 'payout', true),
  ('payout_failed', '{PAYOUT_PROCESSING}', 'PAYOUT_FAILED', '{provider}', false, null, 'payout', false),
  ('open_dispute', '{PAYMENT_CONFIRMED,TRAVELLER_PURCHASE_PENDING,PURCHASE_CONFIRMED,IN_TRANSIT,DELIVERY_PENDING,DELIVERED,BUYER_CONFIRMATION_PENDING,PAYOUT_ELIGIBLE}', 'DISPUTE_OPEN', '{buyer,traveller}', false, null, null, null),
  ('review_dispute', '{DISPUTE_OPEN}', 'DISPUTE_UNDER_REVIEW', '{admin}', false, null, null, null),
  ('resolve_dispute', '{DISPUTE_UNDER_REVIEW}', 'DISPUTE_RESOLVED', '{admin}', false, null, null, null),
  ('initiate_refund', '{DISPUTE_RESOLVED,MANUAL_REVIEW_REQUIRED}', 'REFUND_PENDING', '{admin}', false, null, null, null),
  ('refund_completed', '{REFUND_PENDING}', 'REFUNDED', '{provider}', false, 'due', 'refund', true),
  ('refund_failed', '{REFUND_PENDING}', 'MANUAL_REVIEW_REQUIRED', '{provider}', false, null, 'refund', false),
  ('approve_payout', '{DISPUTE_RESOLVED,MANUAL_REVIEW_REQUIRED}', 'PAYOUT_ELIGIBLE', '{admin}', false, null, null, null),
  ('chargeback', '{PAYMENT_CONFIRMED,TRAVELLER_PURCHASE_PENDING,PURCHASE_CONFIRMED,IN_TRANSIT,DELIVERY_PENDING,DELIVERED,BUYER_CONFIRMATION_PENDING,PAYOUT_ELIGIBLE,DISPUTE_OPEN,DISPUTE_UNDER_REVIEW,DISPUTE_RESOLVED,MANUAL_REVIEW_REQUIRED,PAYOUT_PROCESSING,PAYOUT_FAILED,PAYOUT_COMPLETED,REFUND_PENDING,REFUNDED}', 'MANUAL_REVIEW_REQUIRED', '{provider}', false, null, null, null),
  ('require_manual_review', '{OFFER_ACCEPTED,PAYMENT_PENDING,PAYMENT_CONFIRMED,TRAVELLER_PURCHASE_PENDING,PURCHASE_CONFIRMED,IN_TRANSIT,DELIVERY_PENDING,DELIVERED,BUYER_CONFIRMATION_PENDING,PAYOUT_ELIGIBLE,PAYOUT_PROCESSING,PAYMENT_FAILED,PAYMENT_CANCELLED,REFUND_PENDING,DISPUTE_OPEN,DISPUTE_UNDER_REVIEW,DISPUTE_RESOLVED,PAYOUT_FAILED}', 'MANUAL_REVIEW_REQUIRED', '{system,admin}', false, null, null, null);

-- People allowed to act as Orbitly's review team. Added by hand by the database owner; no role can write it.
create table private.transaction_admins (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  added_at timestamptz not null default now(),
  note text check (char_length(note) <= 200)
);

-- 2. One order per accepted offer. No amounts: they live in the snapshot this row points to.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  -- The snapshot exists only for an accepted offer (accept_offer writes both together), so this key is the proof.
  offer_id uuid not null unique references public.offer_pricing_snapshots (offer_id) on delete restrict,
  request_id uuid not null references public.requests (id) on delete restrict,
  -- Restrict, not cascade: an account with an order can't be deleted while the record must be kept (see P1-5 in
  -- docs/payments/phase-b-architecture.md for the proposed pseudonymisation path, pending legal advice).
  buyer_id uuid not null references public.profiles (id) on delete restrict,
  traveller_id uuid not null references public.profiles (id) on delete restrict,
  direction text not null check (direction in ('into_india', 'out_of_india')),
  currency text not null default 'INR' check (currency = 'INR'),
  state text not null default 'OFFER_ACCEPTED' check (state in (
    'OFFER_ACCEPTED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'TRAVELLER_PURCHASE_PENDING', 'PURCHASE_CONFIRMED',
    'IN_TRANSIT', 'DELIVERY_PENDING', 'DELIVERED', 'BUYER_CONFIRMATION_PENDING', 'PAYOUT_ELIGIBLE', 'PAYOUT_PROCESSING',
    'PAYOUT_COMPLETED', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'ORDER_CANCELLED', 'REFUND_PENDING', 'REFUNDED',
    'DISPUTE_OPEN', 'DISPUTE_UNDER_REVIEW', 'DISPUTE_RESOLVED', 'PAYOUT_FAILED', 'MANUAL_REVIEW_REQUIRED'
  )),
  dispute_resolution text check (dispute_resolution in ('refund_buyer', 'pay_traveller')),
  chargeback boolean not null default false,
  provider_payment_ref text check (char_length(provider_payment_ref) between 1 and 200),
  -- Advances by exactly one with every event; callers pass the version they saw to catch stale requests.
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_two_parties check (buyer_id <> traveller_id)
);
create index transactions_buyer_idx on public.transactions (buyer_id);
create index transactions_traveller_idx on public.transactions (traveller_id);
create index transactions_request_idx on public.transactions (request_id);

-- 3. What happened, in order. Append-only: no role can change or remove a row.
create table public.transaction_events (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.transactions (id) on delete restrict,
  seq integer not null check (seq > 0),
  -- The caller's id for this event (for provider events, the namespaced provider event id).
  event_id text not null check (char_length(event_id) between 1 and 200),
  event_type text not null references private.transaction_rules (event_type),
  from_state text not null,
  to_state text not null,
  -- A provider answer that arrived when the order didn't expect it: recorded, never dropped (Phase A `unexpected`).
  unexpected boolean not null default false,
  actor_role text not null check (actor_role in ('buyer', 'traveller', 'provider', 'system', 'admin')),
  actor_id uuid references public.profiles (id) on delete restrict,
  -- "<provider>:<the provider's event id>", so two providers can never collide.
  provider_event_id text check (provider_event_id ~ '^[a-z][a-z0-9_]{1,30}:[!-~]{1,160}$'),
  -- The money attempt this event started or answered, so every attempt can be traced through the history.
  operation_key text,
  evidence text[] check (evidence is null or cardinality(evidence) between 1 and 10),
  amount_minor bigint check (amount_minor > 0),
  currency text check (currency = 'INR'),
  resolution text check (resolution in ('refund_buyer', 'pay_traveller')),
  -- For admin events, the reviewer's written reason (required).
  note text check (char_length(note) <= 500),
  correlation_id uuid,
  created_at timestamptz not null default now(),
  unique (transaction_id, seq),
  unique (transaction_id, event_id),
  -- Global: a provider event can move one order once, never a second order.
  unique (provider_event_id),
  -- Every person who acts is named; the provider, and only the provider, cites its own event.
  constraint transaction_events_attributed check ((actor_role in ('buyer', 'traveller', 'admin')) = (actor_id is not null)),
  constraint transaction_events_provider_cited check ((actor_role = 'provider') = (provider_event_id is not null)),
  constraint transaction_events_admin_reason check (actor_role <> 'admin' or char_length(note) >= 10)
);

-- 4. Money operations at the provider: one row per attempt. The amount is what the provider was asked for, copied
-- from the snapshot when the attempt starts. P0 OPEN: the payout amount is the net reward only (see header).
create table public.transaction_operations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete restrict,
  kind text not null check (kind in ('payment', 'refund', 'payout')),
  attempt integer not null check (attempt >= 1),
  -- The Phase A key format, tied to this exact operation, so a key can never be reused for a different one.
  idempotency_key text not null unique,
  status text not null default 'started' check (status in ('started', 'succeeded', 'failed')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  provider_ref text check (char_length(provider_ref) between 1 and 200),
  failure_category text check (failure_category in ('provider_reported', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, kind, attempt),
  constraint transaction_operations_key check (idempotency_key = 'orbitly:' || kind || ':' || transaction_id::text || ':' || attempt::text),
  constraint transaction_operations_failure check ((status = 'failed') = (failure_category is not null))
);
-- At most one open-or-successful payment per order (so no second charge while one may still be captured), and at
-- most one live refund OR payout: never both, never twice. A failed attempt doesn't count, so it can be retried.
create unique index transaction_operations_one_live_payment on public.transaction_operations (transaction_id)
  where kind = 'payment' and status <> 'failed';
create unique index transaction_operations_one_money_out on public.transaction_operations (transaction_id)
  where kind in ('refund', 'payout') and status <> 'failed';

-- 5. Provider facts that couldn't be applied: kept for investigation, never silently dropped. Append-only; only the
-- provider entry point writes here; no role can read it (reviewers read it as the owner, or through a future view).
create table public.transaction_anomalies (
  id bigint generated always as identity primary key,
  -- No foreign key: the provider may cite an order that doesn't exist, which is itself worth investigating.
  transaction_ref uuid,
  provider_event_id text not null,
  event_type text not null,
  code text not null,
  operation_key text,
  amount_minor bigint,
  currency text,
  detail text,
  created_at timestamptz not null default now()
);

-- 6. Guards that hold even for writes outside the functions (a mistaken script run as the owner).
create function private.transactions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'OFFER_ACCEPTED' or new.version <> 0 or new.chargeback or new.dispute_resolution is not null then
      raise exception 'A transaction starts at OFFER_ACCEPTED, version 0' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Transactions can''t be deleted' using errcode = 'P0001';
  end if;
  if (new.id, new.offer_id, new.request_id, new.buyer_id, new.traveller_id, new.direction, new.currency, new.created_at)
     is distinct from (old.id, old.offer_id, old.request_id, old.buyer_id, old.traveller_id, old.direction, old.currency, old.created_at) then
    raise exception 'A transaction''s parties, offer and currency can''t change' using errcode = 'P0001';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'version_conflict' using errcode = 'P0001', detail = 'The version must advance by exactly one.';
  end if;
  if old.chargeback and not new.chargeback then
    raise exception 'A chargeback can''t be cleared' using errcode = 'P0001';
  end if;
  -- A rule's step; or a provider answer that arrived unexpectedly, which either stays put (no money moved) or goes
  -- to review (money moved). Neither moves money by itself.
  if new.state <> old.state and new.state <> 'MANUAL_REVIEW_REQUIRED'
     and not exists (select 1 from private.transaction_rules where old.state = any (from_states) and to_state = new.state) then
    raise exception 'invalid_transition' using errcode = 'P0001', detail = format('%s to %s', old.state, new.state);
  end if;
  return new;
end;
$$;
create trigger transactions_guard
  before insert or update or delete on public.transactions
  for each row execute function private.transactions_guard();

-- Every state change must be explained by an event: checked when the database transaction commits.
-- Security definer: a deferred trigger runs at commit as whatever role the session has then (authenticated, or a
-- server role), none of which may read the events table. Found by the real-Postgres test; PGlite didn't show it.
create function private.transactions_event_recorded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.transaction_events e
    where e.transaction_id = new.id and e.seq = new.version and e.from_state = old.state and e.to_state = new.state
  ) then
    raise exception 'A transaction changed without a matching event' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create constraint trigger transactions_event_recorded
  after update on public.transactions
  deferrable initially deferred
  for each row execute function private.transactions_event_recorded();

create function private.append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end;
$$;
create trigger transaction_events_append_only
  before update or delete on public.transaction_events
  for each row execute function private.append_only();
create trigger transaction_anomalies_append_only
  before update or delete on public.transaction_anomalies
  for each row execute function private.append_only();
create trigger transaction_events_no_truncate
  before truncate on public.transaction_events
  for each statement execute function private.append_only();
create trigger transaction_anomalies_no_truncate
  before truncate on public.transaction_anomalies
  for each statement execute function private.append_only();
create trigger transactions_no_truncate
  before truncate on public.transactions
  for each statement execute function private.append_only();
create trigger transaction_operations_no_truncate
  before truncate on public.transaction_operations
  for each statement execute function private.append_only();

-- An operation only moves from started to succeeded or failed, once; nothing else about it changes.
create function private.operations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Operations can''t be deleted' using errcode = 'P0001';
  end if;
  if old.status <> 'started' or new.status = 'started' then
    raise exception 'A finished operation can''t change' using errcode = 'P0001';
  end if;
  if (new.id, new.transaction_id, new.kind, new.attempt, new.idempotency_key, new.amount_minor, new.currency, new.created_at)
     is distinct from (old.id, old.transaction_id, old.kind, old.attempt, old.idempotency_key, old.amount_minor, old.currency, old.created_at) then
    raise exception 'Only an operation''s outcome can be recorded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger transaction_operations_guard
  before update or delete on public.transaction_operations
  for each row execute function private.operations_guard();

-- 7. The one way an order changes. Internal: no role can call it directly; the entry points in section 8 call it
-- with a role they establish themselves. Locks the order, checks everything Phase A checks (in the same order),
-- then changes the state, appends the event and records the money operation in one database transaction.
-- Errors are raised with the Phase A error code as the message.
create function private.apply_transaction_event(
  p_transaction_id uuid,
  p_event_type text,
  p_event_id text,
  p_actor_role text,
  p_actor_id uuid default null,
  p_expected_version integer default null,
  p_evidence text[] default null,
  p_amount_minor bigint default null,
  p_currency text default null,
  p_resolution text default null,
  p_provider_event_id text default null,
  p_provider_ref text default null,
  p_note text default null,
  p_correlation_id uuid default null,
  -- For a provider's answer: the idempotency key of the attempt it answers. A late answer for an earlier attempt
  -- must never settle the current one.
  p_operation_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  t public.transactions;
  rule private.transaction_rules;
  s public.offer_pricing_snapshots;
  seen public.transaction_events;
  op public.transaction_operations;
  v_to text;
  v_unexpected boolean := false;
  v_live_payout boolean;
  v_live_refund boolean;
  v_paid boolean;
  v_kind text;
  v_attempt integer;
  v_key text;
begin
  if p_event_id is null or btrim(p_event_id) = '' or p_actor_role is null then
    raise exception 'invalid_event' using errcode = 'P0001';
  end if;

  select * into t from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;

  -- Idempotency first, as in Phase A: the same event again is a no-op; a different event reusing an id is refused.
  select * into seen from public.transaction_events where transaction_id = t.id and event_id = p_event_id;
  if found then
    if seen.event_type = p_event_type and seen.actor_role = p_actor_role then
      return jsonb_build_object('transaction_id', t.id, 'state', t.state, 'version', t.version, 'duplicate', true);
    end if;
    raise exception 'event_id_conflict' using errcode = 'P0001';
  end if;
  if p_provider_event_id is not null then
    select * into seen from public.transaction_events where provider_event_id = p_provider_event_id;
    if found then
      if seen.transaction_id = t.id and seen.event_type = p_event_type then
        return jsonb_build_object('transaction_id', t.id, 'state', t.state, 'version', t.version, 'duplicate', true);
      end if;
      raise exception 'provider_event_conflict' using errcode = 'P0001';
    end if;
  end if;

  select * into rule from private.transaction_rules where event_type = p_event_type;
  if not found then
    raise exception 'unknown_event' using errcode = 'P0001';
  end if;
  if not (p_actor_role = any (rule.roles)) then
    raise exception 'role_not_allowed' using errcode = 'P0001';
  end if;
  if (p_actor_role = 'buyer' and p_actor_id is distinct from t.buyer_id)
     or (p_actor_role = 'traveller' and p_actor_id is distinct from t.traveller_id) then
    raise exception 'not_a_party' using errcode = 'P0001';
  end if;
  if p_actor_role = 'admin' and not exists (select 1 from private.transaction_admins where user_id = p_actor_id) then
    raise exception 'not_an_admin' using errcode = 'P0001';
  end if;
  if p_actor_role in ('provider', 'system') and p_actor_id is not null then
    raise exception 'invalid_event' using errcode = 'P0001', detail = 'Only people carry an actor id.';
  end if;
  if (p_actor_role = 'provider') <> (p_provider_event_id is not null) then
    raise exception 'provider_event_required' using errcode = 'P0001', detail = 'Provider events, and only provider events, cite a provider event id.';
  end if;

  -- A provider's answer is a fact about money: it settles the attempt still open, by its exact key, whatever state
  -- the order is in. Unexpected success goes to review; unexpected failure leaves the order where it is.
  v_to := rule.to_state;
  if p_actor_role = 'provider' and rule.outcome_kind is not null then
    select * into op from public.transaction_operations
      where transaction_id = t.id and kind = rule.outcome_kind and status = 'started' for update;
    if not found then
      raise exception 'operation_missing' using errcode = 'P0001';
    end if;
    if p_operation_key is distinct from op.idempotency_key then
      raise exception 'operation_mismatch' using errcode = 'P0001';
    end if;
    if not (t.state = any (rule.from_states)) then
      v_unexpected := true;
      v_to := case when rule.outcome_success then 'MANUAL_REVIEW_REQUIRED' else t.state end;
    end if;
  elsif not (t.state = any (rule.from_states)) then
    raise exception 'invalid_transition' using errcode = 'P0001', detail = format('%s from %s', p_event_type, t.state);
  end if;
  if p_expected_version is not null and p_expected_version <> t.version then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;
  -- While a payment attempt is open the buyer could still be charged: no new attempt, no cancellation yet.
  if p_event_type in ('retry_payment', 'cancel_order')
     and exists (select 1 from public.transaction_operations where transaction_id = t.id and kind = 'payment' and status = 'started') then
    raise exception 'payment_attempt_open' using errcode = 'P0001';
  end if;
  if rule.needs_evidence and not exists (
    select 1 from unnest(coalesce(p_evidence, '{}'::text[])) e where btrim(e) <> ''
  ) then
    raise exception 'evidence_required' using errcode = 'P0001';
  end if;
  -- Evidence is a file this person uploaded into this order's own folder of the private evidence bucket: never a
  -- URL, markup, another order's file, or someone else's upload.
  if exists (
    select 1 from unnest(coalesce(p_evidence, '{}'::text[])) e
    where char_length(e) > 300
       or e !~ ('^transactions/' || t.id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
       or e ~ '\.\.'
       or not exists (select 1 from storage.objects o
                      where o.bucket_id = 'transaction-evidence' and o.name = e and o.owner_id = p_actor_id::text)
  ) then
    raise exception 'invalid_evidence' using errcode = 'P0001';
  end if;

  select * into s from public.offer_pricing_snapshots where offer_id = t.offer_id;
  if rule.amount_kind is not null and (
    p_currency is distinct from s.currency
    or p_amount_minor is distinct from (case rule.amount_kind when 'due' then s.buyer_total_minor else s.net_reward_minor end)
  ) then
    raise exception 'amount_mismatch' using errcode = 'P0001';
  end if;

  -- Never both, never twice. "Live" = started or succeeded: Phase A's payoutStarted / refundStarted.
  v_live_payout := exists (select 1 from public.transaction_operations where transaction_id = t.id and kind = 'payout' and status <> 'failed');
  v_live_refund := exists (select 1 from public.transaction_operations where transaction_id = t.id and kind = 'refund' and status <> 'failed');
  v_paid := exists (select 1 from public.transaction_operations where transaction_id = t.id and kind = 'payment' and status = 'succeeded');
  if p_event_type in ('start_payout', 'approve_payout') then
    if t.chargeback then raise exception 'blocked_by_chargeback' using errcode = 'P0001'; end if;
    if v_live_payout then raise exception 'duplicate_payout' using errcode = 'P0001'; end if;
    if v_live_refund then raise exception 'duplicate_refund' using errcode = 'P0001'; end if;
    if t.state = 'DISPUTE_RESOLVED' and t.dispute_resolution is distinct from 'pay_traveller' then
      raise exception 'blocked_by_dispute' using errcode = 'P0001';
    end if;
    -- Stricter than Phase A (documented): no payout from an order whose payment was never captured.
    if not v_paid then raise exception 'payment_not_captured' using errcode = 'P0001'; end if;
  end if;
  if p_event_type = 'initiate_refund' then
    if t.chargeback then raise exception 'blocked_by_chargeback' using errcode = 'P0001'; end if;
    if v_live_refund then raise exception 'duplicate_refund' using errcode = 'P0001'; end if;
    if v_live_payout then raise exception 'duplicate_payout' using errcode = 'P0001'; end if;
    if t.state = 'DISPUTE_RESOLVED' and t.dispute_resolution is distinct from 'refund_buyer' then
      raise exception 'blocked_by_dispute' using errcode = 'P0001';
    end if;
    -- Stricter than Phase A (documented): nothing to refund if no payment was captured.
    if not v_paid then raise exception 'payment_not_captured' using errcode = 'P0001'; end if;
  end if;
  if p_event_type = 'resolve_dispute' and (p_resolution is null or p_resolution not in ('refund_buyer', 'pay_traveller')) then
    raise exception 'resolution_required' using errcode = 'P0001';
  end if;

  -- The money attempt this event starts, if any.
  v_kind := case p_event_type
    when 'request_payment' then 'payment' when 'retry_payment' then 'payment'
    when 'start_payout' then 'payout' when 'initiate_refund' then 'refund'
  end;
  if v_kind is not null then
    select coalesce(max(attempt), 0) + 1 into v_attempt from public.transaction_operations where transaction_id = t.id and kind = v_kind;
    v_key := 'orbitly:' || v_kind || ':' || t.id::text || ':' || v_attempt::text;
  elsif op.id is not null then
    v_key := op.idempotency_key;
  end if;

  -- The change, the event and the operation: all or nothing.
  update public.transactions set
    state = v_to,
    version = t.version + 1,
    dispute_resolution = case p_event_type when 'resolve_dispute' then p_resolution when 'open_dispute' then null else t.dispute_resolution end,
    chargeback = t.chargeback or p_event_type = 'chargeback',
    provider_payment_ref = case when p_event_type = 'payment_confirmed' then coalesce(p_provider_ref, t.provider_payment_ref) else t.provider_payment_ref end,
    updated_at = now()
  where id = t.id;

  insert into public.transaction_events (
    transaction_id, seq, event_id, event_type, from_state, to_state, unexpected, actor_role, actor_id, provider_event_id,
    operation_key, evidence, amount_minor, currency, resolution, note, correlation_id
  ) values (
    t.id, t.version + 1, p_event_id, p_event_type, t.state, v_to, v_unexpected, p_actor_role, p_actor_id, p_provider_event_id,
    v_key, nullif(p_evidence, '{}'::text[]), case when rule.amount_kind is not null then p_amount_minor end,
    case when rule.amount_kind is not null then p_currency end,
    case when p_event_type = 'resolve_dispute' then p_resolution end, p_note, p_correlation_id
  );

  if v_kind is not null then
    insert into public.transaction_operations (transaction_id, kind, attempt, idempotency_key, amount_minor)
      values (t.id, v_kind, v_attempt, v_key, case v_kind when 'payout' then s.net_reward_minor else s.buyer_total_minor end);
  end if;
  -- Only the provider settles an attempt. A buyer cancelling a payment leaves it open until the provider answers.
  if op.id is not null then
    update public.transaction_operations set
      status = case when rule.outcome_success then 'succeeded' else 'failed' end,
      provider_ref = coalesce(p_provider_ref, provider_ref),
      failure_category = case when not rule.outcome_success then (case p_event_type when 'cancel_payment' then 'cancelled' else 'provider_reported' end) end,
      updated_at = now()
    where id = op.id;
  end if;

  return jsonb_build_object('transaction_id', t.id, 'state', v_to, 'version', t.version + 1, 'duplicate', false, 'unexpected', v_unexpected);
end;
$$;

-- 8. Entry points. Each establishes its caller's role itself; none accepts a role or an identity from the caller.

-- 8a. Creating an order after its offer is accepted. Server system path only. Idempotent.
create function private.open_transaction(p_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  o public.offers;
  r public.requests;
  v_id uuid;
  v_direction text;
begin
  select * into o from public.offers where id = p_offer_id and status = 'accepted' for share;
  if not found then
    raise exception 'offer_not_accepted' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.offer_pricing_snapshots where offer_id = o.id and request_id = o.request_id) then
    raise exception 'snapshot_missing' using errcode = 'P0001';
  end if;
  select * into r from public.requests where id = o.request_id;
  v_direction := case
    when r.destination_country = 'IN' and r.source_country <> 'IN' then 'into_india'
    when r.source_country = 'IN' and r.destination_country <> 'IN' then 'out_of_india'
  end;
  if v_direction is null then
    raise exception 'unsupported_route' using errcode = 'P0001';
  end if;
  insert into public.transactions (offer_id, request_id, buyer_id, traveller_id, direction)
    values (o.id, o.request_id, r.shopper_id, o.traveller_id, v_direction)
    on conflict (offer_id) do nothing
    returning id into v_id;
  return coalesce(v_id, (select id from public.transactions where offer_id = o.id));
end;
$$;

-- 8b. Provider path: the webhook handler, after verifying the provider's signature and confirming the fact with the
-- provider server to server. Role fixed to provider. A provider fact that can't be applied (wrong amount, wrong
-- attempt, unknown order, an event id seen on another order...) is kept in transaction_anomalies, and the call
-- reports it instead of failing, so the fact is never lost. Lock timeouts and other errors still fail, to be retried.
create function private.record_provider_event(
  p_transaction_id uuid,
  p_event_type text,
  p_provider_event_id text,
  p_operation_key text default null,
  p_amount_minor bigint default null,
  p_currency text default null,
  p_provider_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_result jsonb;
  v_code text;
begin
  if p_provider_event_id is null or p_provider_event_id !~ '^[a-z][a-z0-9_]{1,30}:[!-~]{1,160}$' then
    raise exception 'provider_event_required' using errcode = 'P0001', detail = 'Use "<provider>:<event id>".';
  end if;
  begin
    v_result := private.apply_transaction_event(
      p_transaction_id, p_event_type, p_provider_event_id, 'provider', null, null, null,
      p_amount_minor, p_currency, null, p_provider_event_id, p_provider_ref, null, null, p_operation_key
    );
  exception when sqlstate 'P0001' or sqlstate 'P0002' or unique_violation then
    v_code := case when sqlstate = '23505' then 'provider_event_conflict' else sqlerrm end;
    insert into public.transaction_anomalies (transaction_ref, provider_event_id, event_type, code, operation_key, amount_minor, currency, detail)
      values (p_transaction_id, p_provider_event_id, p_event_type, v_code, p_operation_key, p_amount_minor, p_currency, left(sqlerrm, 200));
    return jsonb_build_object('transaction_id', p_transaction_id, 'anomaly', v_code);
  end;
  return v_result;
end;
$$;

-- 8c. System path: Orbitly's own server steps (start a payment, ask for purchase, ask the buyer to confirm, flag for
-- review). Role fixed to system; no identity can be supplied.
create function private.record_system_event(
  p_transaction_id uuid,
  p_event_type text,
  p_event_id text,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
begin
  return private.apply_transaction_event(p_transaction_id, p_event_type, p_event_id, 'system', null, p_expected_version);
end;
$$;

-- 8d. Admin path: a reviewer signed in to their own account. Identity from the session (never from the request),
-- membership of transaction_admins, multi-factor sign-in (aal2), a written reason, and the version they saw.
create function public.transaction_admin_act(
  p_transaction_id uuid,
  p_event_type text,
  p_event_id text,
  p_expected_version integer,
  p_reason text,
  p_resolution text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from private.transaction_admins where user_id = v_uid) then
    raise exception 'not_an_admin' using errcode = '42501';
  end if;
  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 or char_length(p_reason) > 500 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if p_expected_version is null then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;
  return private.apply_transaction_event(
    p_transaction_id, p_event_type, p_event_id, 'admin', v_uid, p_expected_version,
    null, null, null, p_resolution, null, null, btrim(p_reason)
  );
end;
$$;

-- 8e. What a signed-in buyer or traveller can do. The role comes from who is asking, never from the request; an
-- order they aren't part of looks the same as one that doesn't exist. Stale screens are refused by the version.
create function public.transaction_act(
  p_transaction_id uuid,
  p_event_type text,
  p_event_id text,
  p_expected_version integer,
  p_evidence text[] default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_uid uuid := (select auth.uid());
  t public.transactions;
begin
  select * into t from public.transactions where id = p_transaction_id;
  if v_uid is null or not found or v_uid not in (t.buyer_id, t.traveller_id) then
    raise exception 'transaction_not_found' using errcode = '42501';
  end if;
  if p_expected_version is null then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;
  return private.apply_transaction_event(
    p_transaction_id, p_event_type, p_event_id,
    case when v_uid = t.buyer_id then 'buyer' else 'traveller' end, v_uid,
    p_expected_version, p_evidence, null, null, null, null, null, p_note, null
  );
end;
$$;

-- 9. Evidence files: a private bucket, one folder per order (transactions/<order id>/<file>). Only that order's
-- buyer and traveller can read its files, and each can upload only into it, as themselves. Nobody can change or
-- delete an upload (no update or delete policy), so what was cited stays what was cited.
insert into storage.buckets (id, name, public) values ('transaction-evidence', 'transaction-evidence', false);

create policy "Order parties read their order's evidence"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'transaction-evidence'
    and exists (select 1 from public.transactions t
                where t.id::text = (storage.foldername(name))[2]
                  and (select auth.uid()) in (t.buyer_id, t.traveller_id))
  );
create policy "Order parties upload into their order's folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'transaction-evidence'
    and (storage.foldername(name))[1] = 'transactions'
    and array_length(storage.foldername(name), 1) = 2
    and owner_id = (select auth.uid())::text
    and exists (select 1 from public.transactions t
                where t.id::text = (storage.foldername(name))[2]
                  and (select auth.uid()) in (t.buyer_id, t.traveller_id))
  );

-- 10. Read access. RLS limits rows to the order's own buyer and traveller; column grants hide internal fields
-- (provider references, operation keys, admin identities and reasons, idempotency keys). Nobody writes directly.
alter table public.transactions enable row level security;
alter table public.transaction_events enable row level security;
alter table public.transaction_operations enable row level security;
alter table public.transaction_anomalies enable row level security;

create policy "Buyers and travellers see their own orders"
  on public.transactions for select to authenticated
  using (buyer_id = (select auth.uid()) or traveller_id = (select auth.uid()));
create policy "Buyers and travellers see their own orders' history"
  on public.transaction_events for select to authenticated
  using (exists (select 1 from public.transactions t where t.id = transaction_id
                 and (t.buyer_id = (select auth.uid()) or t.traveller_id = (select auth.uid()))));
create policy "Buyers and travellers see their own orders' payment steps"
  on public.transaction_operations for select to authenticated
  using (exists (select 1 from public.transactions t where t.id = transaction_id
                 and (t.buyer_id = (select auth.uid()) or t.traveller_id = (select auth.uid()))));

revoke all on public.transactions, public.transaction_events, public.transaction_operations, public.transaction_anomalies
  from public, anon, authenticated, service_role, orbitly_webhook, orbitly_system;
revoke all on sequence public.transaction_events_id_seq, public.transaction_anomalies_id_seq
  from public, anon, authenticated, service_role, orbitly_webhook, orbitly_system;
grant select (id, offer_id, request_id, buyer_id, traveller_id, direction, currency, state, dispute_resolution, chargeback, version, created_at, updated_at)
  on public.transactions to authenticated;
grant select (id, transaction_id, seq, event_type, from_state, to_state, unexpected, actor_role, evidence, resolution, created_at)
  on public.transaction_events to authenticated;
grant select (id, transaction_id, kind, attempt, status, amount_minor, currency, created_at, updated_at)
  on public.transaction_operations to authenticated;

revoke all on private.transaction_rules, private.transaction_admins
  from public, anon, authenticated, service_role, orbitly_webhook, orbitly_system;

-- Functions: Postgres lets everyone execute a new function, and Supabase adds anon, authenticated and service_role.
-- Take it all back, then grant each entry point to the single role that should call it.
revoke execute on function
  private.transactions_guard(), private.transactions_event_recorded(), private.append_only(), private.operations_guard(),
  private.apply_transaction_event(uuid, text, text, text, uuid, integer, text[], bigint, text, text, text, text, text, uuid, text),
  private.open_transaction(uuid),
  private.record_provider_event(uuid, text, text, text, bigint, text, text),
  private.record_system_event(uuid, text, text, integer),
  public.transaction_admin_act(uuid, text, text, integer, text, text),
  public.transaction_act(uuid, text, text, integer, text[], text)
  from public, anon, authenticated, service_role, orbitly_webhook, orbitly_system;
grant execute on function private.record_provider_event(uuid, text, text, text, bigint, text, text) to orbitly_webhook;
grant execute on function private.record_system_event(uuid, text, text, integer) to orbitly_system;
grant execute on function private.open_transaction(uuid) to orbitly_system;
grant execute on function public.transaction_admin_act(uuid, text, text, integer, text, text) to authenticated;
grant execute on function public.transaction_act(uuid, text, text, integer, text[], text) to authenticated;
