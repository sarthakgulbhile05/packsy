import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { priceOffer } from "@/lib/offer";
import { calculateBuyerPlatformFee, PRICING_POLICY } from "@/lib/pricing";
import { as, asAndKeep, createLocalSupabase, createUser, type Db } from "./local-supabase";

// FD-9: pricing v1.2 (3% buyer fee), kept as the record of v1.2; the app has since moved to v1.3 (Q13a, stage 5d). Dev's database runs v1.1 (stage 5a, 5%) and stays unchanged; the v1.2 draft
// (supabase/drafts/stage5c_pricing_v1_2.sql) is NOT applied anywhere. Everything here runs in an in-memory Postgres
// built from the migrations, i.e. dev's current state, and only then replays the draft on top.

const DRAFT = readFileSync("supabase/drafts/stage5c_pricing_v1_2.sql", "utf8");

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
// ₹50,000 product, ₹3,000 reward: FD-9's worked example.
const offer = async (requestId: string) =>
  (await asAndKeep(db, traveller, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.offers (request_id, trip_id, service_fee_inr, product_price_amount, product_currency, fx_rate_to_inr,
         arrival_date, handoff_method, declares_lawful_import, delivery_inr, other_costs_inr, customs_estimate_inr)
       values ($1, $2, 3000, 50000, 'INR', 1, $3, 'meet_in_person', true, 250, 0, 1500) returning id`,
      [requestId, tripId, day(5)],
    ),
  )).rows[0].id;
const acceptAs = (user: string, sql: string, params: unknown[]) => asAndKeep(db, user, (tx) => tx.query(sql, params));
const state = async (offerId: string) =>
  (await db.query<{ offer: string; request: string; snapshots: number; events: number }>(
    `select o.status offer, r.status request,
       (select count(*)::int from public.offer_pricing_snapshots where offer_id = o.id) snapshots,
       (select count(*)::int from public.marketplace_events where offer_id = o.id) events
     from public.offers o join public.requests r on r.id = o.request_id where o.id = $1`,
    [offerId],
  )).rows[0];
// Sending the offer logs one event; a refused acceptance must add none.
const UNTOUCHED = { offer: "pending", request: "open", snapshots: 0, events: 1 };

let v11Offer: string, v11Snapshot: string, migrations: string[];

beforeAll(async () => {
  ({ db, migrations } = await createLocalSupabase({ withStage4: true, withStage5a: true, withStage5b: true }));
  today = (await db.query<{ d: string }>(`select current_date::text d`)).rows[0].d;
  buyer = await createUser(db, { phoneVerified: true });
  traveller = await createUser(db, { phoneVerified: true });
  tripId = (await asAndKeep(db, traveller, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ('US', 'IN', $1, $2) returning id`,
      [day(1), day(5)],
    ),
  )).rows[0].id;
  // An order agreed under v1.1 before FD-9: its snapshot must survive the v1.2 draft untouched.
  v11Offer = await offer(await request());
  await acceptAs(buyer, `select public.accept_offer($1)`, [v11Offer]);
  v11Snapshot = JSON.stringify((await db.query(`select * from public.offer_pricing_snapshots where offer_id = $1`, [v11Offer])).rows);
});

describe("app pricing", () => {
  it("is 3% of the product value and 10% of the gross reward, as v1.2 was (the app is now v1.3)", () => {
    expect(PRICING_POLICY).toMatchObject({ version: "1.3", buyerFeeBps: 300, travellerFeeBps: 1000 });
    expect(calculateBuyerPlatformFee(5_000_000)).toBe(150_000);
  });
});

describe("dev's current database (v1.1) against the app", () => {
  it("is detected as a mismatch: it records policy 1.1 at 5%", async () => {
    const s = (await db.query<{ policy_version: string; buyer_fee_minor: string }>(`select policy_version, buyer_fee_minor from public.offer_pricing_snapshots where offer_id = $1`, [v11Offer])).rows[0];
    expect(s.policy_version).toBe("1.1");
    expect(Number(s.buyer_fee_minor)).toBe(250_000); // 5% of ₹50,000
    expect(s.policy_version).not.toBe(PRICING_POLICY.version);
  });

  it("can't accept an offer the way the app now asks (stating its version), and changes nothing", async () => {
    const o = await offer(await request());
    await expect(acceptAs(buyer, `select public.accept_offer($1, $2)`, [o, PRICING_POLICY.version])).rejects.toThrow(/does not exist/);
    expect(await state(o)).toEqual(UNTOUCHED);
  });
});

describe("the v1.2 draft, replayed on dev's state", () => {
  let before: string[];
  beforeAll(async () => {
    before = (await db.query<{ t: string }>(`select tablename t from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.t);
    await db.exec(DRAFT);
  });

  it("isn't a migration, so no tool can push it", () => {
    expect(readdirSync("supabase/migrations").some((f) => /stage5c|v1_2/.test(f))).toBe(false);
    expect(migrations.at(-1)).toBe("20261110082047_stage5b_snapshot_privileges.sql");
  });

  it("accepts at v1.2 and records the same 3% figures as the app, marked policy 1.2", async () => {
    const o = await offer(await request());
    await acceptAs(buyer, `select public.accept_offer($1, '1.2')`, [o]);
    const s = (await db.query<Record<string, string | null>>(`select * from public.offer_pricing_snapshots where offer_id = $1`, [o])).rows[0];
    const p = priceOffer({ product_price_inr: 50_000, service_fee_inr: 3_000, delivery_inr: 250, other_costs_inr: 0, customs_estimate_inr: 1_500 });
    if (!p.ok) throw new Error("app couldn't price the offer");
    expect({
      policy: s.policy_version,
      product: Number(s.product_value_minor),
      buyerFee: Number(s.buyer_fee_minor),
      travellerFee: Number(s.traveller_fee_minor),
      net: Number(s.net_reward_minor),
      total: Number(s.buyer_total_minor),
      revenue: Number(s.orbitly_revenue_minor),
    }).toEqual({
      policy: "1.2",
      product: p.pricing.productValue,
      buyerFee: p.pricing.buyerFee,
      travellerFee: p.pricing.travellerFee,
      net: p.pricing.netReward,
      total: p.pricing.buyerTotal,
      revenue: p.pricing.orbitlyRevenue,
    });
    // FD-9's example: ₹1,500 buyer fee, ₹300 commission, ₹2,700 net, ₹1,800 revenue; customs and delivery unfeed.
    expect(p.pricing).toMatchObject({ buyerFee: 150_000, travellerFee: 30_000, netReward: 270_000, orbitlyRevenue: 180_000 });
    expect(p.pricing.buyerTotal).toBe(5_000_000 + 300_000 + 150_000 + 25_000 + 150_000);
  });

  it("refuses a caller on any other policy, or none, before changing anything", async () => {
    const o = await offer(await request());
    // "1.3" is the app's own version today: a database on v1.2 must refuse it too.
    for (const version of ["1.1", "1.3", "", null]) {
      await expect(acceptAs(buyer, `select public.accept_offer($1, $2)`, [o, version])).rejects.toThrow(/different pricing policy/);
    }
    await expect(acceptAs(buyer, `select public.accept_offer($1)`, [o])).rejects.toThrow(/does not exist/);
    expect(await state(o)).toEqual(UNTOUCHED);
  });

  it("keeps the other acceptance rules and who may call it", async () => {
    const o = await offer(await request());
    await expect(acceptAs(traveller, `select public.accept_offer($1, '1.2')`, [o])).rejects.toThrow(/not allowed/);
    await expect(as(db, null, (tx) => tx.query(`select public.accept_offer($1, '1.2')`, [o]))).rejects.toThrow(/permission denied/);
    expect(await state(o)).toEqual(UNTOUCHED);
  });

  it("leaves existing data and everything else unchanged", async () => {
    expect(JSON.stringify((await db.query(`select * from public.offer_pricing_snapshots where offer_id = $1`, [v11Offer])).rows)).toBe(v11Snapshot);
    expect((await db.query<{ t: string }>(`select tablename t from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.t)).toEqual(before);
    // Snapshots stay immutable, and the other lifecycle steps still work.
    await expect(db.query(`update public.offer_pricing_snapshots set buyer_fee_minor = 0 where offer_id = $1`, [v11Offer])).rejects.toThrow(/can't be changed/);
    const o = await offer(await request());
    await acceptAs(buyer, `select public.decline_offer($1)`, [o]);
    expect((await db.query<{ status: string }>(`select status from public.offers where id = $1`, [o])).rows[0].status).not.toBe("pending");
  });
});
