import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { priceOffer } from "@/lib/offer";
import { as, asAndKeep, createLocalSupabase, createUser, type Db } from "./local-supabase";

// Pricing policy v1.1 draft (supabase/drafts/stage5a_pricing_v1_1.sql), replayed on top of every migration
// in an in-memory Postgres. Simulated: nothing here touches a Supabase project, and the draft isn't applied anywhere.

const DRAFT = readFileSync("supabase/drafts/stage5a_pricing_v1_1.sql", "utf8");

let db: Db;
let buyer: string, traveller: string, stranger: string;
let legacyOffer: string, legacyRequest: string, staleOffer: string;
let today: string;
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function request() {
  const id = (await asAndKeep(db, buyer, (tx) =>
    tx.query<{ id: string }>(`insert into public.requests (title, delivery_city, source_country, destination_country) values ('A product', 'Pune', 'US', 'IN') returning id`),
  )).rows[0].id;
  await asAndKeep(db, buyer, (tx) => tx.query(`select public.publish_request($1)`, [id]));
  return id;
}

let tripId: string;
const OFFER_SQL = `insert into public.offers (request_id, trip_id, service_fee_inr, product_price_amount, product_currency, fx_rate_to_inr,
  arrival_date, handoff_method, declares_lawful_import, delivery_inr, other_costs_inr, other_costs_note, customs_estimate_inr)
  values ($1, $2, $3, 999, 'USD', 83.5, $4, 'meet_in_person', true, 250, 100, 'Gift wrap', 1500) returning id`;
type Tx = Parameters<Parameters<typeof as>[2]>[0];
const offerAs = (requestId: string, fee: number, arrival = day(5), trip = () => tripId) => (tx: Tx) =>
  tx.query<{ id: string }>(OFFER_SQL, [requestId, trip(), fee, arrival]);
const offer = async (requestId: string, fee: number) => (await asAndKeep(db, traveller, offerAs(requestId, fee))).rows[0].id;
const accept = (id: string) => asAndKeep(db, buyer, (tx) => tx.query(`select public.accept_offer($1)`, [id]));
const snapshot = async (id: string) =>
  (await db.query<Record<string, string | number | null>>(`select * from public.offer_pricing_snapshots where offer_id = $1`, [id])).rows[0];

beforeAll(async () => {
  ({ db } = await createLocalSupabase({ withStage4: true }));
  today = (await db.query<{ d: string }>(`select current_date::text d`)).rows[0].d;
  buyer = await createUser(db, { phoneVerified: true });
  traveller = await createUser(db, { phoneVerified: true });
  stranger = await createUser(db, { phoneVerified: true });
  tripId = (await asAndKeep(db, traveller, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ('US', 'IN', $1, $2) returning id`,
      [day(1), day(5)],
    ),
  )).rows[0].id;
  // An offer made before the policy: ₹300 would net only ₹270.
  legacyRequest = await request();
  legacyOffer = await offer(legacyRequest, 300);
  // Also from before: an offer whose stated arrival (day 4) isn't its trip's (day 5).
  staleOffer = (await asAndKeep(db, traveller, offerAs(await request(), 2_000, day(4))) ).rows[0].id;
  await db.exec(DRAFT);
});

describe("the applied migration", () => {
  it("is byte-identical to the reviewed draft that was applied to dev", () => {
    expect(readFileSync("supabase/migrations/20261110072033_stage5a_pricing_v1_1.sql", "utf8")).toBe(DRAFT);
  });

  it("replays cleanly as part of the full migration chain", async () => {
    const { db: full, migrations } = await createLocalSupabase({ withStage4: true, withStage5a: true });
    expect(migrations.at(-1)).toBe("20261110072033_stage5a_pricing_v1_1.sql");
    expect((await full.query(`select to_regclass('public.offer_pricing_snapshots')::text t`)).rows[0]).toEqual({ t: "offer_pricing_snapshots" });
  });
});

describe("v1.1's minimum net reward, still enforced by dev's database (removed by stage 5d)", () => {
  it("refuses a direct insert whose reward nets under ₹300, whatever the app shows", async () => {
    const r = await request();
    await expect(as(db, traveller, offerAs(r, 333))).rejects.toThrow(/offers_min_net_reward/);
    await expect(as(db, traveller, offerAs(r, 0))).rejects.toThrow(/offers_min_net_reward/);
    await expect(as(db, traveller, offerAs(r, -500))).rejects.toThrow(/check constraint/);
    expect((await as(db, traveller, offerAs(r, 334))).rows).toHaveLength(1); // the boundary: nets ₹300.60
    expect((await as(db, traveller, offerAs(r, 25_000))).rows).toHaveLength(1);
  });

  it("won't accept an older offer below the minimum", async () => {
    await expect(accept(legacyOffer)).rejects.toThrow(/below Orbitly's minimum/);
    expect((await db.query(`select status from public.offers where id = $1`, [legacyOffer])).rows[0]).toEqual({ status: "pending" });
  });
});

describe("price snapshot at acceptance", () => {
  let accepted: string;
  beforeAll(async () => {
    accepted = await offer(await request(), 2_000);
    await accept(accepted);
  });

  // Dev's applied policy is v1.1 (5%). Since FD-9 and Q13a the app prices at v1.3 (3%, no minimum), so the app calls a two-argument
  // accept_offer that v1.1 doesn't have and acceptance is refused (tests/db/pricing-stage5c.test.ts). This pins what
  // v1.1 itself records, so the mismatch stays visible rather than silently "agreeing".
  it("records v1.1's own figures (5% buyer fee), which differ from the app's pricing (now v1.3)", async () => {
    const row = (await db.query<{ product_price_inr: number }>(`select product_price_inr from public.offers where id = $1`, [accepted])).rows[0];
    const p = priceOffer({ product_price_inr: Number(row.product_price_inr), service_fee_inr: 2_000, delivery_inr: 250, other_costs_inr: 100, customs_estimate_inr: 1_500 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const s = await snapshot(accepted);
    // 999 USD at 83.5 = ₹83,417; v1.1's 5% = ₹4,170.85; the reward nets ₹1,800 under both policies.
    const v11BuyerFee = 417_085;
    expect({
      policy: s.policy_version,
      product: Number(s.product_value_minor),
      reward: Number(s.gross_reward_minor),
      buyerFee: Number(s.buyer_fee_minor),
      travellerFee: Number(s.traveller_fee_minor),
      net: Number(s.net_reward_minor),
      customs: Number(s.customs_estimate_minor),
      total: Number(s.buyer_total_minor),
      revenue: Number(s.orbitly_revenue_minor),
    }).toEqual({
      policy: "1.1",
      product: p.pricing.productValue,
      reward: p.pricing.grossReward,
      buyerFee: v11BuyerFee,
      travellerFee: p.pricing.travellerFee,
      net: p.pricing.netReward,
      customs: p.pricing.customsEstimate,
      total: p.pricing.buyerTotal - p.pricing.buyerFee + v11BuyerFee,
      revenue: v11BuyerFee + p.pricing.travellerFee,
    });
    expect(p.pricing).toMatchObject({ policyVersion: "1.3", productValue: 8_341_700, buyerFee: 250_251, netReward: 180_000 });
    expect(s.policy_version).not.toBe(p.pricing.policyVersion);
  });

  it("can't be changed or deleted by anyone, including the database owner", async () => {
    await expect(db.query(`update public.offer_pricing_snapshots set buyer_total_minor = 1 where offer_id = $1`, [accepted])).rejects.toThrow(/can't be changed/);
    await expect(db.query(`delete from public.offer_pricing_snapshots where offer_id = $1`, [accepted])).rejects.toThrow(/can't be changed/);
  });

  it("can't be written by clients", async () => {
    await expect(as(db, buyer, (tx) => tx.query(`insert into public.offer_pricing_snapshots (offer_id) values ($1)`, [accepted]))).rejects.toThrow(/permission denied/);
    await expect(as(db, buyer, (tx) => tx.query(`update public.offer_pricing_snapshots set buyer_total_minor = 1`))).rejects.toThrow(/permission denied/);
  });

  it("is visible to the buyer and the traveller only", async () => {
    const read = (user: string | null) => as(db, user, (tx) => tx.query(`select offer_id from public.offer_pricing_snapshots where offer_id = $1`, [accepted]));
    expect((await read(buyer)).rows).toHaveLength(1);
    expect((await read(traveller)).rows).toHaveLength(1);
    expect((await read(stranger)).rows).toHaveLength(0);
    await expect(read(null)).rejects.toThrow(/permission denied/);
  });
});

describe("one rounding rule in both places", () => {
  it("rounds percentages half up exactly like the app", async () => {
    const cases: [number, number, number][] = [[10, 500, 1], [9, 500, 0], [33_335, 1_000, 3_334], [33_334, 1_000, 3_333], [8_341_700, 500, 417_085]];
    for (const [amount, bps, want] of cases) {
      expect(Number((await db.query<{ v: string }>(`select public.pricing_percent($1, $2) v`, [amount, bps])).rows[0].v)).toBe(want);
    }
  });
});

describe("F-02: an offer's arrival date is its trip's", () => {
  const arrivalOf = async (id: string) => (await db.query<{ a: string }>(`select arrival_date::text a from public.offers where id = $1`, [id])).rows[0].a;

  it("ignores a different date sent by the client", async () => {
    const id = await offer(await request(), 2_000);
    const lying = (await asAndKeep(db, traveller, offerAs(await request(), 2_000, day(2)))).rows[0].id;
    expect(await arrivalOf(id)).toBe(day(5));
    expect(await arrivalOf(lying)).toBe(day(5));
  });

  it("ignores a past date too (the trip's date replaces it before the policy checks it)", async () => {
    const id = (await asAndKeep(db, traveller, offerAs(await request(), 2_000, day(-3)))).rows[0].id;
    expect(await arrivalOf(id)).toBe(day(5));
  });

  it("can't borrow someone else's trip to get its date", async () => {
    const otherTrip = (await asAndKeep(db, stranger, (tx) =>
      tx.query<{ id: string }>(
        `insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ('US', 'IN', $1, $2) returning id`,
        [day(1), day(3)],
      ),
    )).rows[0].id;
    await expect(as(db, traveller, offerAs(await request(), 2_000, day(3), () => otherTrip))).rejects.toThrow();
  });

  it("won't accept an older offer whose arrival date isn't its trip's", async () => {
    await expect(accept(staleOffer)).rejects.toThrow(/no longer matches/);
    expect(await snapshot(staleOffer)).toBeUndefined();
  });
});

describe("F-09: trip dates and live offers", () => {
  let lockedTrip: string, lockedOffer: string;
  const newTrip = (arrive: number) =>
    asAndKeep(db, traveller, (tx) =>
      tx.query<{ id: string }>(
        `insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ('US', 'IN', $1, $2) returning id`,
        [day(1), day(arrive)],
      ),
    ).then((r) => r.rows[0].id);
  const moveTrip = (id: string, arrive: number) =>
    asAndKeep(db, traveller, (tx) => tx.query(`update public.trips set arrival_date = $2 where id = $1`, [id, day(arrive)]));

  beforeAll(async () => {
    lockedTrip = await newTrip(6);
    lockedOffer = (await asAndKeep(db, traveller, offerAs(await request(), 2_000, day(6), () => lockedTrip))).rows[0].id;
  });

  it("refuses to move a trip that has a pending offer", async () => {
    await expect(moveTrip(lockedTrip, 9)).rejects.toThrow(/offers in progress/);
  });

  it("still lets the traveller edit other details, or cancel the trip", async () => {
    await asAndKeep(db, traveller, (tx) => tx.query(`update public.trips set notes = 'Window seat' where id = $1`, [lockedTrip]));
    expect((await db.query(`select notes from public.trips where id = $1`, [lockedTrip])).rows[0]).toEqual({ notes: "Window seat" });
  });

  it("allows new dates once the offer is withdrawn", async () => {
    await asAndKeep(db, traveller, (tx) => tx.query(`select public.withdraw_offer($1)`, [lockedOffer]));
    await moveTrip(lockedTrip, 7);
    expect((await db.query<{ a: string }>(`select arrival_date::text a from public.trips where id = $1`, [lockedTrip])).rows[0].a).toBe(day(7));
  });

  it("allows new dates on a trip with no offers", async () => {
    const t = await newTrip(5);
    await moveTrip(t, 8);
  });
});

describe("F-04: the agreed price survives policy changes", () => {
  it("keeps an accepted price when the fee rules change later, and new acceptances use the new rules", async () => {
    const before = await offer(await request(), 2_000);
    await accept(before);
    const frozen = await snapshot(before);
    // A later migration changes the rule (here: no fees at all).
    await db.exec(`create or replace function public.pricing_percent(p_amount bigint, p_bps integer) returns bigint
      language sql immutable set search_path = '' as $$ select 0::bigint $$`);
    try {
      expect(await snapshot(before)).toEqual(frozen);
      const after = await offer(await request(), 2_000);
      await accept(after);
      expect(Number((await snapshot(after)).buyer_fee_minor)).toBe(0);
      expect(Number(frozen.buyer_fee_minor)).toBeGreaterThan(0);
    } finally {
      await db.exec(`create or replace function public.pricing_percent(p_amount bigint, p_bps integer) returns bigint
        language sql immutable set search_path = '' as $$ select (p_amount * p_bps + 5000) / 10000 $$`);
    }
  });

  it("can't be accepted twice or snapshotted twice", async () => {
    const id = await offer(await request(), 2_000);
    await accept(id);
    await expect(accept(id)).rejects.toThrow(/not found or not allowed|Only pending/);
    expect((await db.query(`select count(*)::int n from public.offer_pricing_snapshots where offer_id = $1`, [id])).rows[0]).toEqual({ n: 1 });
  });
});

describe("F-11: preview image URLs", () => {
  const draftWithImage = (url: string) =>
    as(db, buyer, (tx) =>
      tx.query(`insert into public.requests (title, delivery_city, source_country, destination_country, preview_image_url) values ('Item', 'Pune', 'US', 'IN', $1)`, [url]),
    );

  it("keeps https images on named hosts", async () => {
    await draftWithImage("https://cdn.shop.example.com/p/1.jpg");
    await draftWithImage("https://images.example.co.uk:443/a.png?w=400");
  });

  it.each([
    ["plain http", "http://cdn.example.com/1.jpg"],
    ["localhost", "https://localhost/1.jpg"],
    ["a private IPv4 address", "https://192.168.1.10/1.jpg"],
    ["a public IP literal", "https://8.8.8.8/1.jpg"],
    ["an IPv6 literal", "https://[::1]/1.jpg"],
    ["credentials", "https://user:pw@example.com/1.jpg"],
    ["an unusual port", "https://example.com:8443/1.jpg"],
    ["a single-label host", "https://intranet/1.jpg"],
    ["javascript:", "javascript:alert(1)"],
  ])("refuses %s", async (_label, url) => {
    await expect(draftWithImage(url)).rejects.toThrow(/requests_preview_image_https|check constraint/);
  });
});

describe("F-13: trip_can_offer is no longer part of the API", () => {
  it("can't be called from the exposed schema, and anonymous visitors can't reach it at all", async () => {
    const t = (await db.query<{ id: string }>(`select id from public.trips limit 1`)).rows[0].id;
    const r = await request();
    await expect(as(db, traveller, (tx) => tx.query(`select public.trip_can_offer($1, $2)`, [t, r]))).rejects.toThrow(/does not exist/);
    await expect(as(db, null, (tx) => tx.query(`select private.trip_can_offer($1, $2)`, [t, r]))).rejects.toThrow(/permission denied/);
  });

  it("still guards offers: the owner's trip passes, someone else's doesn't", async () => {
    expect((await as(db, traveller, offerAs(await request(), 2_000))).rows).toHaveLength(1);
    await expect(as(db, stranger, offerAs(await request(), 2_000))).rejects.toThrow(/row-level security/);
  });
});
