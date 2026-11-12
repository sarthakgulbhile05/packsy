-- STAGE 5b DRAFT: least privilege on agreed prices (public.offer_pricing_snapshots). NOT APPLIED anywhere.
-- Kept outside supabase/migrations so no tool can push it by accident. Needs its own approval for dev.
--
-- Why: Supabase's default privileges grant every new public table to anon, authenticated and service_role
-- (insert, select, update, delete, truncate, references, trigger, maintain). Stage 5a revoked them from anon and
-- authenticated but not service_role, which also bypasses RLS. So a service-role key could insert forged
-- snapshots, and TRUNCATE skips the row-level guard against changes. Orbitly never uses service_role, and the
-- only writer is accept_offer, which runs as the table owner, so nothing legitimate needs those privileges.
--
-- What this can't do: the table owner (postgres) and the superuser (supabase_admin) can disable or drop
-- triggers and grant themselves anything. No trigger stops them; that boundary is who holds those logins.
--
-- No data, prices or pricing rules change. Idempotent: revokes are no-ops when repeated, and the trigger uses
-- create or replace. One transaction: all or nothing.

-- 1. service_role keeps reading (server-side reporting may need it); it loses every way to write or empty the
-- table, to attach its own triggers, and to lock or maintain it.
revoke insert, update, delete, truncate, references, trigger, maintain on public.offer_pricing_snapshots from service_role;

-- 2. TRUNCATE never fires row triggers, so the existing guard can't see it. A statement-level guard refuses it
-- for every role that can't disable triggers, including a TRUNCATE ... CASCADE that starts at offers or requests.
-- It reuses the existing guard function, which only raises.
create or replace trigger offer_pricing_snapshots_no_truncate
  before truncate on public.offer_pricing_snapshots
  for each statement execute function public.offer_pricing_snapshots_immutable();
