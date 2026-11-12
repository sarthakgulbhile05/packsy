import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asAndKeep, createLocalSupabase, createUser, type Db } from "./local-supabase";

// Stage 5b draft (supabase/drafts/stage5b_snapshot_privileges.sql) on top of the full chain, stage 5a included,
// in an in-memory Postgres. Simulated: nothing here touches a Supabase project, and the draft isn't applied anywhere.
// Roles mirror Supabase's: service_role bypasses RLS; the local owner is a superuser (stronger than Supabase's postgres).

const DRAFT = readFileSync("supabase/drafts/stage5b_snapshot_privileges.sql", "utf8");
const DENIED = /permission denied/;
const FROZEN = /can't be changed or deleted/;

let db: Db;
let buyer: string, traveller: string, stranger: string;
let tripUS: string, tripIN: string;
let today: string;
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Runs as a database role (e.g. service_role) and rolls back. */
async function asRole<T>(role: string, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>) {
  let out!: T;
  await db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    out = await fn((sql, params) => tx.query(sql, params));
    await tx.rollback();
  });
  return out;
}

async function request(from: string, to: string) {
  const id = (await asAndKeep(db, buyer, (tx) =>
    tx.query<{ id: string }>(`insert into public.requests (title, delivery_city, source_country, destination_country) values ('Item', 'City', $1, $2) returning id`, [from, to]),
  )).rows[0].id;
  await asAndKeep(db, buyer, (tx) => tx.query(`select public.publish_request($1)`, [id]));
  return id;
}

async function trip(owner: string, from: string, to: string, arrive: number) {
  return (await asAndKeep(db, owner, (tx) =>
    tx.query<{ id: string }>(`insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ($1, $2, $3, $4) returning id`, [from, to, day(1), day(arrive)]),
  )).rows[0].id;
}

async function offer(requestId: string, tripId: string, price: number, currency: string, rate: number) {
  return (await asAndKeep(db, traveller, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.offers (request_id, trip_id, service_fee_inr, product_price_amount, product_currency, fx_rate_to_inr, arrival_date, handoff_method, declares_lawful_import)
       values ($1, $2, 2000, $3, $4, $5, $6, 'meet_in_person', true) returning id`,
      [requestId, tripId, price, currency, rate, day(5)],
    ),
  )).rows[0].id;
}

const accept = (id: string) => asAndKeep(db, buyer, (tx) => tx.query(`select public.accept_offer($1)`, [id]));
const snapshotsFor = async (id: string) =>
  (await db.query<Record<string, unknown>>(`select * from public.offer_pricing_snapshots where offer_id = $1`, [id])).rows;
const count = async () => Number((await db.query<{ n: string }>(`select count(*) n from public.offer_pricing_snapshots`)).rows[0].n);

let intoIndia: string, outOfIndia: string;

beforeAll(async () => {
  ({ db } = await createLocalSupabase({ withStage4: true, withStage5a: true }));
  today = (await db.query<{ d: string }>(`select current_date::text d`)).rows[0].d;
  buyer = await createUser(db, { phoneVerified: true });
  traveller = await createUser(db, { phoneVerified: true });
  stranger = await createUser(db, { phoneVerified: true });
  tripUS = await trip(traveller, "US", "IN", 5);
  tripIN = await trip(traveller, "IN", "AE", 5);
  // Prices agreed before 5b, in both directions.
  intoIndia = await offer(await request("US", "IN"), tripUS, 999, "USD", 83.5);
  outOfIndia = await offer(await request("IN", "AE"), tripIN, 2000, "INR", 1);
  await accept(intoIndia);
  await accept(outOfIndia);
});

describe("the applied migration", () => {
  it("is byte-identical to the reviewed draft that was applied to dev", () => {
    expect(readFileSync("supabase/migrations/20261110082047_stage5b_snapshot_privileges.sql", "utf8")).toBe(DRAFT);
  });

  it("replays cleanly as the last step of the full migration chain", async () => {
    const { db: full, migrations } = await createLocalSupabase({ withStage4: true, withStage5a: true, withStage5b: true });
    expect(migrations.at(-1)).toBe("20261110082047_stage5b_snapshot_privileges.sql");
    expect((await full.query<{ a: string }>(`select relacl::text a from pg_class where oid = 'public.offer_pricing_snapshots'::regclass`)).rows[0].a).toMatch(/service_role=r\//);
  });
});

describe("before stage 5b (the gap it closes)", () => {
  it("service_role, which bypasses RLS, can insert forged snapshots and empty the table", async () => {
    const forged = await asRole("service_role", async (q) => {
      const [s] = (await q(`select * from public.offer_pricing_snapshots where offer_id = $1`, [intoIndia])).rows;
      await q(`truncate public.offer_pricing_snapshots`);
      await q(
        `insert into public.offer_pricing_snapshots (offer_id, request_id, policy_version, currency, product_price_amount, product_currency, fx_rate_to_inr, product_price_fixed,
           product_value_minor, gross_reward_minor, buyer_fee_minor, traveller_fee_minor, net_reward_minor, delivery_minor, other_costs_minor, buyer_total_minor, orbitly_revenue_minor)
         values ($1, $2, '1.1', 'INR', 1, 'INR', 1, true, 100, 100000, 0, 70000, 30000, 0, 0, 100100, 70000)`,
        [intoIndia, s.request_id],
      );
      return Number((await q(`select count(*) n from public.offer_pricing_snapshots`)).rows[0].n);
    });
    expect(forged).toBe(1); // both real snapshots gone, one forged one in their place (rolled back)
    expect(await count()).toBe(2);
  });
});

describe("after stage 5b", () => {
  beforeAll(async () => {
    await db.exec(DRAFT);
  });

  it("leaves existing snapshots exactly as they were", async () => {
    expect(await count()).toBe(2);
    expect(Number((await snapshotsFor(intoIndia))[0].buyer_fee_minor)).toBe(417_085);
  });

  it("refuses inserts from anonymous and signed-in users", async () => {
    const insert = `insert into public.offer_pricing_snapshots (offer_id) values ('00000000-0000-4000-8000-000000000999')`;
    await expect(as(db, null, (tx) => tx.query(insert))).rejects.toThrow(DENIED);
    await expect(as(db, buyer, (tx) => tx.query(insert))).rejects.toThrow(DENIED);
    await expect(as(db, traveller, (tx) => tx.query(insert))).rejects.toThrow(DENIED);
  });

  it("lets the buyer and the traveller read their own snapshots, and nobody else", async () => {
    const read = (user: string) => as(db, user, (tx) => tx.query(`select offer_id from public.offer_pricing_snapshots`));
    expect((await read(buyer)).rows).toHaveLength(2);
    expect((await read(traveller)).rows).toHaveLength(2);
    expect((await read(stranger)).rows).toHaveLength(0);
  });

  it("refuses service_role every write: insert, update, delete, truncate", async () => {
    for (const sql of [
      `insert into public.offer_pricing_snapshots (offer_id) values ('00000000-0000-4000-8000-000000000999')`,
      `update public.offer_pricing_snapshots set buyer_total_minor = 1`,
      `delete from public.offer_pricing_snapshots`,
      `truncate public.offer_pricing_snapshots`,
    ]) {
      await expect(asRole("service_role", (q) => q(sql))).rejects.toThrow(DENIED);
    }
    expect(await count()).toBe(2);
  });

  it("refuses service_role its own triggers and table locks too", async () => {
    await expect(
      asRole("service_role", (q) => q(`create trigger sneaky before insert on public.offer_pricing_snapshots for each row execute function public.offer_pricing_snapshots_immutable()`)),
    ).rejects.toThrow(DENIED);
    await expect(asRole("service_role", (q) => q(`lock table public.offer_pricing_snapshots in access exclusive mode`))).rejects.toThrow(DENIED);
  });

  it("still lets service_role read, for server-side reporting", async () => {
    const n = await asRole("service_role", async (q) => Number((await q(`select count(*) n from public.offer_pricing_snapshots`)).rows[0].n));
    expect(n).toBe(2);
  });

  it("refuses TRUNCATE even from the table owner while the guard is enabled, including a cascade from offers", async () => {
    await expect(db.query(`truncate public.offer_pricing_snapshots`)).rejects.toThrow(FROZEN);
    await expect(db.query(`truncate public.offers cascade`)).rejects.toThrow(FROZEN);
    expect(await count()).toBe(2);
  });

  it("keeps refusing updates and deletes from the owner", async () => {
    await expect(db.query(`update public.offer_pricing_snapshots set buyer_total_minor = 1`)).rejects.toThrow(FROZEN);
    await expect(db.query(`delete from public.offer_pricing_snapshots`)).rejects.toThrow(FROZEN);
  });

  it("can't stop the owner disabling the guard (documented limit: protect the owner and superuser logins)", async () => {
    let emptied = -1;
    await db.transaction(async (tx) => {
      await tx.exec(`alter table public.offer_pricing_snapshots disable trigger offer_pricing_snapshots_no_truncate`);
      await tx.exec(`truncate public.offer_pricing_snapshots`);
      emptied = Number((await tx.query<{ n: string }>(`select count(*) n from public.offer_pricing_snapshots`)).rows[0].n);
      await tx.rollback();
    });
    expect(emptied).toBe(0);
    expect(await count()).toBe(2); // rolled back
  });

  it("still lets accept_offer record exactly one snapshot, in both directions, and refuses a second acceptance", async () => {
    const into = await offer(await request("US", "IN"), tripUS, 999, "USD", 83.5);
    const out = await offer(await request("IN", "AE"), tripIN, 2000, "INR", 1);
    await accept(into);
    await accept(out);
    expect(await snapshotsFor(into)).toHaveLength(1);
    expect(await snapshotsFor(out)).toHaveLength(1);
    expect(Number((await snapshotsFor(out))[0].buyer_fee_minor)).toBe(10_000);
    await expect(accept(into)).rejects.toThrow(/not found or not allowed|Only pending/);
    expect(await snapshotsFor(into)).toHaveLength(1);
  });

  it("keeps earlier snapshots unchanged when the fee rule changes later", async () => {
    const before = await snapshotsFor(intoIndia);
    await db.exec(`create or replace function public.pricing_percent(p_amount bigint, p_bps integer) returns bigint
      language sql immutable set search_path = '' as $$ select 0::bigint $$`);
    try {
      const later = await offer(await request("US", "IN"), tripUS, 999, "USD", 83.5);
      await accept(later);
      expect(Number((await snapshotsFor(later))[0].buyer_fee_minor)).toBe(0);
      expect(await snapshotsFor(intoIndia)).toEqual(before);
    } finally {
      await db.exec(`create or replace function public.pricing_percent(p_amount bigint, p_bps integer) returns bigint
        language sql immutable set search_path = '' as $$ select (p_amount * p_bps + 5000) / 10000 $$`);
    }
  });

  it("can be applied twice without error or a second trigger", async () => {
    await db.exec(DRAFT);
    const triggers = await db.query(`select tgname from pg_trigger where tgrelid = 'public.offer_pricing_snapshots'::regclass and not tgisinternal order by 1`);
    expect(triggers.rows).toEqual([{ tgname: "offer_pricing_snapshots_no_change" }, { tgname: "offer_pricing_snapshots_no_truncate" }]);
  });
});
