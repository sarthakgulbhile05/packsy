import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

// A small local stand-in for the parts of Supabase our migrations depend on: its roles,
// auth.users, auth.uid() and the default grants Supabase gives on the public schema.
// It runs in memory; nothing here touches the real Supabase project.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls; -- as on Supabase: the service key skips RLS
  create role supabase_auth_admin nologin;

  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    phone text,
    phone_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const ROOT = join(import.meta.dirname, "..", "..", "supabase");

// Earlier stages' tests pin the behaviour before the two-way marketplace, so they replay the chain without it.
const STAGE4 = "20261105134431_two_way_marketplace.sql";
// Stage 5a's own tests replay its reviewed draft on top of stage 4 (after seeding pre-5a rows), so it's opt-in too.
const STAGE5A = "20261110072033_stage5a_pricing_v1_1.sql";
// Stage 5b's tests demonstrate the gap before applying its draft, so it's opt-in as well.
const STAGE5B = "20261110082047_stage5b_snapshot_privileges.sql";

export async function createLocalSupabase({ withDevHook = false, skip = [] as string[], withStage4 = false, withStage5a = false, withStage5b = false } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const migrations = readdirSync(join(ROOT, "migrations"))
    .filter((f) => f.endsWith(".sql") && !skip.includes(f) && (withStage4 || f !== STAGE4) && (withStage5a || f !== STAGE5A) && (withStage5b || f !== STAGE5B))
    .sort();
  for (const file of migrations) await db.exec(readFileSync(join(ROOT, "migrations", file), "utf8"));
  if (withDevHook) await db.exec(readFileSync(join(ROOT, "dev", "discard_sms_hook.sql"), "utf8"));
  return { db, migrations };
}

export type Db = PGlite;

/** Runs `fn` as a logged-in user (or logged-out visitor when id is null) and rolls back afterwards. */
export async function as<T>(db: Db, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let result!: T;
  await db.transaction(async (tx) => {
    if (userId) {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    } else {
      await tx.exec("set local role anon");
    }
    result = await fn(tx);
    await tx.rollback();
  });
  return result;
}

/** Same as `as`, but keeps the changes (for setting up data through the real policies). */
export async function asAndKeep<T>(db: Db, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return fn(tx);
  });
}

let counter = 0;
/** Creates an auth user (as Supabase Auth would). The profile is made by our trigger. */
export async function createUser(db: Db, opts: { phone?: string; phoneVerified?: boolean; name?: string } = {}) {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  await db.query(
    `insert into auth.users (id, email, phone, phone_confirmed_at, raw_user_meta_data)
     values ($1, $2, $3, $4, $5)`,
    [
      id,
      `user${counter}@orbitly.test`,
      opts.phone ?? (opts.phoneVerified ? `9190000${String(counter).padStart(5, "0")}` : null),
      opts.phoneVerified ? new Date().toISOString() : null,
      JSON.stringify({ full_name: opts.name ?? `User ${counter}` }),
    ],
  );
  return id;
}
