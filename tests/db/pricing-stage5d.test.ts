import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { priceOffer } from "@/lib/offer";
import { PRICING_POLICY } from "@/lib/pricing";
import { as, asAndKeep, createLocalSupabase, createUser, type Db } from "./local-supabase";

// Q13a: pricing v1.3, no minimum traveller reward. Dev runs v1.1 (stage 5a: 5%, ₹300 net floor) and stays unchanged.
// stage5c (v1.2) and stage5d (v1.3) are drafts, applied nowhere. Everything here runs in an in-memory Postgres built
// from the migrations (dev's state), then replays the drafts on top.

const STAGE5C = readFileSync("supabase/drafts/stage5c_pricing_v1_2.sql", "utf8");
const STAGE5D = readFileSync("supabase/drafts/stage5d_pricing_v1_3.sql", "utf8");

let db: Db;
let buyer: string, traveller: string, tripId: string, today: string;
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const request = async () => {
  const id = (await asAndKeep(db, buyer, (tx) =>
    tx.query<{ id: string }>(`insert into public.requests (title, delivery_city, source_country, destination_country) values ('A product', 'Pune', 'US', 'IN') returning id`),
  )).rows[0].id;
  await asAndKeep(db, buyer, (tx) => tx.query(`select public.publish_request($1)`, [id]));
  return id;
};
const OFFER = `insert into public.offers (request_id, trip_id, service_fee_inr, product_price_amount, product_currency, fx_rate_to_inr,
    arrival_date, handoff_method, declares_lawful_import, delivery_inr, other_costs_inr, customs_estimate_inr)
  values ($1, $2, $3, 2000, 'INR', 1, $4, 'meet_in_person', true, 250, 0, 1500) returning id`;
// Rolled back afterwards. The request is created first: PGlite can't nest the two transactions.
const tryOffer = async (reward: number) => {
  const r = await request();
  return as(db, traveller, async (tx) => (await tx.query<{ id: string }>(OFFER, [r, tripId, reward, day(5)])).rows);
};
const offer = async (reward: number) => {
  const r = await request();
  return (await asAndKeep(db, traveller, (tx) => tx.query<{ id: string }>(OFFER, [r, tripId, reward, day(5)]))).rows[0].id;
};
const accept = (id: string, version: unknown) => asAndKeep(db, buyer, (tx) => tx.query(`select public.accept_offer($1, $2)`, [id, version]));
const state = async (offerId: string) =>
  (await db.query(
    `select o.status offer, r.status request,
       (select count(*)::int from public.offer_pricing_snapshots where offer_id = o.id) snapshots,
       (select count(*)::int from public.marketplace_events where offer_id = o.id) events
     from public.offers o join public.requests r on r.id = o.request_id where o.id = $1`,
    [offerId],
  )).rows[0];
// Sending the offer logs one event; a refused acceptance must add none.
const UNTOUCHED = { offer: "pending", request: "open", snapshots: 0, events: 1 };
const allSnapshots = async () => JSON.stringify((await db.query(`select * from public.offer_pricing_snapshots order by offer_id`)).rows);

let v11Offer: string, v11Snapshots: string;

beforeAll(async () => {
  ({ db } = await createLocalSupabase({ withStage4: true, withStage5a: true, withStage5b: true }));
  today = (await db.query<{ d: string }>(`select current_date::text d`)).rows[0].d;
  buyer = await createUser(db, { phoneVerified: true });
  traveller = await createUser(db, { phoneVerified: true });
  tripId = (await asAndKeep(db, traveller, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ('US', 'IN', $1, $2) returning id`,
      [day(1), day(5)],
    ),
  )).rows[0].id;
  // An order agreed under dev's v1.1: its snapshot must never be rewritten.
  v11Offer = await offer(2_000);
  await asAndKeep(db, buyer, (tx) => tx.query(`select public.accept_offer($1)`, [v11Offer]));
  v11Snapshots = await allSnapshots();
});

describe("the app's policy", () => {
  it("is v1.3: 3% buyer fee, 10% commission, no minimum reward", () => {
    expect(PRICING_POLICY).toMatchObject({ version: "1.3", buyerFeeBps: 300, travellerFeeBps: 1000 });
    expect(PRICING_POLICY).not.toHaveProperty("minNetReward");
  });
});

describe("dev's database (v1.1, ₹300 floor) against the v1.3 app", () => {
  it("still refuses an offer under its old floor, saving nothing", async () => {
    await expect(tryOffer(200)).rejects.toThrow(/offers_min_net_reward/);
  });

  it("can't accept an offer at the app's version, and changes nothing", async () => {
    const o = await offer(2_000);
    await expect(accept(o, PRICING_POLICY.version)).rejects.toThrow(/does not exist/);
    expect(await state(o)).toEqual(UNTOUCHED);
  });
});

describe("stage 5d", () => {
  it("can't be applied without stage 5c first", async () => {
    const { db: fresh } = await createLocalSupabase({ withStage4: true, withStage5a: true, withStage5b: true });
    await expect(fresh.exec(STAGE5D)).rejects.toThrow(/Apply stage5c_pricing_v1_2\.sql before this draft/);
    // Nothing from 5d landed: the old floor is still there.
    expect((await fresh.query(`select 1 from pg_constraint where conname = 'offers_min_net_reward'`)).rows).toHaveLength(1);
  });

  it("is a draft, not a migration", () => {
    expect(readdirSync("supabase/migrations").some((f) => /stage5[cd]|v1_[23]/.test(f))).toBe(false);
  });
});

describe("a database on v1.2 (stage 5c only) against the v1.3 app", () => {
  beforeAll(async () => {
    await db.exec(STAGE5C);
  });

  it("refuses the app's version before changing anything", async () => {
    const o = await offer(2_000);
    await expect(accept(o, PRICING_POLICY.version)).rejects.toThrow(/different pricing policy/);
    expect(await state(o)).toEqual(UNTOUCHED);
  });
});

describe("v1.3 (stage 5c then 5d), replayed on dev's state", () => {
  let tables: string[];
  beforeAll(async () => {
    tables = (await db.query<{ t: string }>(`select tablename t from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.t);
    await db.exec(STAGE5D);
  });

  it("takes any whole-rupee reward from ₹1 to ₹10,00,000, with no ₹300 floor (Q13a, Q13g)", async () => {
    for (const reward of [1, 200, 299, 333, 1_000_000]) expect(await tryOffer(reward), String(reward)).toHaveLength(1);
  });

  it("refuses a ₹0 reward (Q13g)", async () => {
    await expect(tryOffer(0)).rejects.toThrow(/offers_service_fee_inr_at_least_one/);
  });

  it("still refuses negative and oversized rewards through the original check", async () => {
    await expect(tryOffer(-1)).rejects.toThrow(/offers_service_fee_inr_(check|at_least_one)/);
    await expect(tryOffer(1_000_001)).rejects.toThrow(/offers_service_fee_inr_check/);
  });

  it("accepts a ₹200 reward at v1.3 and records exactly what the app shows: ₹20 commission, ₹180 net", async () => {
    const o = await offer(200);
    await accept(o, "1.3");
    const s = (await db.query<Record<string, string>>(`select * from public.offer_pricing_snapshots where offer_id = $1`, [o])).rows[0];
    const p = priceOffer({ product_price_inr: 2_000, service_fee_inr: 200, delivery_inr: 250, other_costs_inr: 0, customs_estimate_inr: 1_500 });
    if (!p.ok) throw new Error("the app couldn't price a ₹200 reward");
    expect({
      policy: s.policy_version,
      buyerFee: Number(s.buyer_fee_minor),
      travellerFee: Number(s.traveller_fee_minor),
      net: Number(s.net_reward_minor),
      total: Number(s.buyer_total_minor),
      revenue: Number(s.orbitly_revenue_minor),
    }).toEqual({
      policy: p.pricing.policyVersion,
      buyerFee: p.pricing.buyerFee,
      travellerFee: p.pricing.travellerFee,
      net: p.pricing.netReward,
      total: p.pricing.buyerTotal,
      revenue: p.pricing.orbitlyRevenue,
    });
    expect(p.pricing).toMatchObject({ policyVersion: "1.3", buyerFee: 6_000, travellerFee: 2_000, netReward: 18_000 });
  });

  it("accepts a ₹1 reward: 10 paise commission, 90 paise net, no minimum commission", async () => {
    const o = await offer(1);
    await accept(o, "1.3");
    const s = (await db.query<Record<string, string>>(`select gross_reward_minor, traveller_fee_minor, net_reward_minor from public.offer_pricing_snapshots where offer_id = $1`, [o])).rows[0];
    expect([Number(s.gross_reward_minor), Number(s.traveller_fee_minor), Number(s.net_reward_minor)]).toEqual([100, 10, 90]);
  });

  it("refuses any other version, or none, before changing anything", async () => {
    const o = await offer(200);
    for (const version of ["1.1", "1.2", "", null]) await expect(accept(o, version)).rejects.toThrow(/different pricing policy/);
    await expect(asAndKeep(db, buyer, (tx) => tx.query(`select public.accept_offer($1)`, [o]))).rejects.toThrow(/does not exist/);
    expect(await state(o)).toEqual(UNTOUCHED);
  });

  it("keeps who may accept", async () => {
    const o = await offer(200);
    await expect(asAndKeep(db, traveller, (tx) => tx.query(`select public.accept_offer($1, '1.3')`, [o]))).rejects.toThrow(/not allowed/);
    await expect(as(db, null, (tx) => tx.query(`select public.accept_offer($1, '1.3')`, [o]))).rejects.toThrow(/permission denied/);
    expect(await state(o)).toEqual(UNTOUCHED);
  });

  it("never rewrites an accepted snapshot, and adds no tables", async () => {
    const v11 = (await db.query(`select * from public.offer_pricing_snapshots where offer_id = $1`, [v11Offer])).rows;
    expect(JSON.stringify(v11)).toBe(JSON.stringify(JSON.parse(v11Snapshots)));
    expect((v11[0] as { policy_version: string }).policy_version).toBe("1.1");
    await expect(db.query(`update public.offer_pricing_snapshots set net_reward_minor = 0 where offer_id = $1`, [v11Offer])).rejects.toThrow(/can't be changed/);
    expect((await db.query<{ t: string }>(`select tablename t from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.t)).toEqual(tables);
  });
});

describe("an older ₹0 offer, from before stage 5a, under v1.3", () => {
  it("can't be accepted, and nothing changes", async () => {
    // Stage 4 allowed ₹0; stage 5a's and 5d's checks are NOT VALID, so such a row can survive into v1.3.
    const { db: old } = await createLocalSupabase({ withStage4: true });
    db = old;
    today = (await db.query<{ d: string }>(`select current_date::text d`)).rows[0].d;
    buyer = await createUser(db, { phoneVerified: true });
    traveller = await createUser(db, { phoneVerified: true });
    tripId = (await asAndKeep(db, traveller, (tx) =>
      tx.query<{ id: string }>(
        `insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ('US', 'IN', $1, $2) returning id`,
        [day(1), day(5)],
      ),
    )).rows[0].id;
    const zero = await offer(0);
    for (const file of ["migrations/20261110072033_stage5a_pricing_v1_1.sql", "migrations/20261110082047_stage5b_snapshot_privileges.sql"]) {
      await db.exec(readFileSync(`supabase/${file}`, "utf8"));
    }
    await db.exec(STAGE5C);
    await db.exec(STAGE5D);
    await expect(accept(zero, "1.3")).rejects.toThrow(/reward isn't valid/);
    expect(await state(zero)).toEqual(UNTOUCHED);
  });
});
