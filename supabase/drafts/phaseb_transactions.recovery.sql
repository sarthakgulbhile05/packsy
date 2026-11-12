-- PHASE B RECOVERY: removes everything phaseb_transactions.sql creates. For isolated test databases only.
-- THIS MIGRATION HAS NOT BEEN APPLIED TO ANY REMOTE DATABASE. REAL PAYMENTS ARE DISABLED.
-- One transaction: it either removes all of Phase B or nothing. Refuses once any order, event, operation, anomaly
-- or evidence file exists: financial records are never dropped by a script. No CASCADE: each object is named, in
-- dependency order, and only objects Phase B created are touched (it grants nothing to pre-existing roles beyond
-- what it revokes here, so no existing access is removed).

begin;

-- Hold the tables so nothing can be written between the check and the drop.
lock table public.transactions, public.transaction_events, public.transaction_operations, public.transaction_anomalies in access exclusive mode;

do $$
begin
  if exists (select 1 from public.transactions) or exists (select 1 from public.transaction_events)
     or exists (select 1 from public.transaction_operations) or exists (select 1 from public.transaction_anomalies)
     or exists (select 1 from storage.objects where bucket_id = 'transaction-evidence') then
    raise exception 'Refusing to remove Phase B: transaction records exist';
  end if;
  -- DROP ROLE would silently remove a server login's membership; refuse instead, so that's a deliberate step.
  if exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid where r.rolname in ('orbitly_webhook', 'orbitly_system')) then
    raise exception 'Refusing to remove Phase B: a login is still a member of orbitly_webhook or orbitly_system';
  end if;
end;
$$;

drop policy "Order parties read their order's evidence" on storage.objects;
drop policy "Order parties upload into their order's folder" on storage.objects;
delete from storage.buckets where id = 'transaction-evidence';

drop function public.transaction_act(uuid, text, text, integer, text[], text);
drop function public.transaction_admin_act(uuid, text, text, integer, text, text);
drop function private.record_system_event(uuid, text, text, integer);
drop function private.record_provider_event(uuid, text, text, text, bigint, text, text);
drop function private.open_transaction(uuid);
drop function private.apply_transaction_event(uuid, text, text, text, uuid, integer, text[], bigint, text, text, text, text, text, uuid, text);

-- Tables take their own triggers, policies, indexes and constraints with them.
drop table public.transaction_anomalies;
drop table public.transaction_events;
drop table public.transaction_operations;
drop table public.transactions;

drop function private.transactions_guard();
drop function private.transactions_event_recorded();
drop function private.append_only();
drop function private.operations_guard();

drop table private.transaction_admins;
drop table private.transaction_rules;

-- The two roles Phase B created (checked above: no login is a member).
revoke usage on schema private from orbitly_webhook, orbitly_system;
drop role orbitly_webhook;
drop role orbitly_system;

commit;
