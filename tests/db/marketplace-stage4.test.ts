import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asAndKeep, createLocalSupabase, createUser, type Db } from "./local-supabase";

// Stage 4 (two-way marketplace), applied to dev as 20261105134431. Replayed here on top of every earlier migration,
// in an in-memory Postgres. Simulated: nothing here touches a Supabase project.

const STAGE4 = readFileSync("supabase/drafts/stage4_two_way_marketplace.sql", "utf8");
const PROBE = readFileSync("supabase/drafts/stage4_two_way_marketplace.probe.sql", "utf8");
const RECOVERY = readFileSync("supabase/drafts/stage4_two_way_marketplace.recovery.sql", "utf8");
const RLS = /row-level security/;
const NO_PERMISSION = /permission denied/;
const NOT_ALLOWED = /not found or not allowed/;

let db: Db;
let buyer: string, otherBuyer: string, travUS: string, travIN: string, unverified: string;
let today: string;
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  ({ db } = await createLocalSupabase({ withStage4: true }));
  today = (await db.query<{ d: string }>(`select current_date::text d`)).rows[0].d;
  buyer = await createUser(db, { phoneVerified: true, name: "Buyer" });
  otherBuyer = await createUser(db, { phoneVerified: true, name: "Other buyer" });
  travUS = await createUser(db, { phoneVerified: true, name: "Traveller from the US" });
  travIN = await createUser(db, { phoneVerified: true, name: "Traveller from India" });
  unverified = await createUser(db, { name: "Unverified" });
});

/** A published request on a route, created through the real policies and publish_request(). */
async function request(owner: string, from: string, to: string, neededBy: string | null = null) {
  const id = (await asAndKeep(db, owner, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.requests (title, delivery_city, source_country, destination_country, needed_by)
       values ('A product', 'Pune', $1, $2, $3) returning id`,
      [from, to, neededBy],
    ),
  )).rows[0].id;
  await asAndKeep(db, owner, (tx) => tx.query(`select public.publish_request($1)`, [id]));
  return id;
}

async function trip(owner: string, from: string, to: string, arrive = day(5)) {
  return (await asAndKeep(db, owner, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.trips (departure_country, destination_country, departure_date, arrival_date)
       values ($1, $2, $3, $4) returning id`,
      [from, to, day(1) <= arrive ? day(1) : arrive, arrive],
    ),
  )).rows[0].id;
}

const OFFER_COLUMNS = `request_id, trip_id, service_fee_inr, product_price_amount, product_currency, fx_rate_to_inr,
  arrival_date, handoff_method, declares_lawful_import`;
const offerValues = (requestId: string, tripId: string | null) =>
  [requestId, tripId, 1500, 999, "USD", 83, day(5), "meet_in_person", true] as unknown[];
const offerSql = `insert into public.offers (${OFFER_COLUMNS}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`;

async function offer(traveller: string, requestId: string, tripId: string | null) {
  return (await asAndKeep(db, traveller, (tx) => tx.query<{ id: string }>(offerSql, offerValues(requestId, tripId)))).rows[0].id;
}

const requestsForTrip = async (user: string, tripId: string) =>
  (await as(db, user, (tx) => tx.query<{ id: string }>(`select id from public.matching_requests($1)`, [tripId]))).rows.map((r) => r.id);
const tripsForRequest = async (user: string, requestId: string) =>
  (await as(db, user, (tx) => tx.query<Record<string, unknown>>(`select * from public.matching_trips($1)`, [requestId]))).rows;
const call = (user: string | null, fn: string, id: string) => as(db, user, (tx) => tx.query(`select public.${fn}($1)`, [id]));
const callAndKeep = (user: string, fn: string, id: string) => asAndKeep(db, user, (tx) => tx.query(`select public.${fn}($1)`, [id]));
const status = async (table: "requests" | "offers" | "trips", id: string) =>
  (await db.query<{ status: string }>(`select status from public.${table} where id = $1`, [id])).rows[0].status;

describe("the applied migration", () => {
  it("is byte-identical to the reviewed draft that was applied to dev", () => {
    expect(readFileSync("supabase/migrations/20261105134431_two_way_marketplace.sql", "utf8")).toBe(STAGE4);
  });
});

describe("route matching: same route, same direction", () => {
  it("matches a USA → India request with a USA → India trip, from both sides", async () => {
    const r = await request(buyer, "US", "IN");
    const t = await trip(travUS, "US", "IN");
    expect(await requestsForTrip(travUS, t)).toContain(r);
    expect((await tripsForRequest(buyer, r)).map((x) => x.trip_id)).toContain(t);
  });

  it("matches an India → USA request with an India → USA trip", async () => {
    const r = await request(otherBuyer, "IN", "US");
    const t = await trip(travIN, "IN", "US");
    expect(await requestsForTrip(travIN, t)).toContain(r);
  });

  it("never matches the reverse direction", async () => {
    const r = await request(buyer, "US", "IN");
    const t = await trip(travIN, "IN", "US");
    expect(await requestsForTrip(travIN, t)).not.toContain(r);
    expect((await tripsForRequest(buyer, r)).map((x) => x.trip_id)).not.toContain(t);
  });

  it("needs both the departure and the destination country to match", async () => {
    const r = await request(buyer, "US", "IN");
    const fromUK = await trip(travUS, "GB", "IN");
    const toUAE = await trip(travUS, "US", "AE");
    expect(await requestsForTrip(travUS, fromUK)).not.toContain(r);
    expect(await requestsForTrip(travUS, toUAE)).not.toContain(r);
  });

  it("needs the trip to arrive by the buyer's needed-by date", async () => {
    const r = await request(buyer, "US", "IN", day(3));
    const late = await trip(travUS, "US", "IN", day(6));
    const onTime = await trip(travUS, "US", "IN", day(3));
    expect(await requestsForTrip(travUS, late)).not.toContain(r);
    expect(await requestsForTrip(travUS, onTime)).toContain(r);
  });

  it("ignores cancelled trips and closed requests", async () => {
    const r = await request(buyer, "US", "IN");
    const t = await trip(travUS, "US", "IN");
    await asAndKeep(db, travUS, (tx) => tx.query(`update public.trips set status = 'cancelled' where id = $1`, [t]));
    expect((await tripsForRequest(buyer, r)).map((x) => x.trip_id)).not.toContain(t);

    const closed = await request(buyer, "US", "IN");
    const live = await trip(travUS, "US", "IN");
    await callAndKeep(buyer, "cancel_request", closed);
    expect(await requestsForTrip(travUS, live)).not.toContain(closed);
  });

  it("excludes restricted and prohibited items, but still lists review-required ones", async () => {
    const restricted = await request(buyer, "US", "IN");
    const review = await request(buyer, "US", "IN");
    await db.query(`update public.requests set eligibility_status = 'restricted' where id = $1`, [restricted]);
    await db.query(`update public.requests set eligibility_status = 'review_required' where id = $1`, [review]);
    const t = await trip(travUS, "US", "IN");
    const found = await requestsForTrip(travUS, t);
    expect(found).not.toContain(restricted);
    expect(found).toContain(review);
  });

  it("never matches a traveller with their own request", async () => {
    const r = await request(travUS, "US", "IN");
    const t = await trip(travUS, "US", "IN");
    expect(await requestsForTrip(travUS, t)).not.toContain(r);
  });

  it("only searches from trips and requests the caller owns", async () => {
    const r = await request(buyer, "US", "IN");
    const t = await trip(travUS, "US", "IN");
    expect(await requestsForTrip(travIN, t)).toEqual([]);
    expect(await tripsForRequest(otherBuyer, r)).toEqual([]);
  });

  it("shows buyers a trip's route and dates only, never who the traveller is", async () => {
    const r = await request(buyer, "US", "IN");
    await trip(travUS, "US", "IN");
    const [first] = await tripsForRequest(buyer, r);
    expect(Object.keys(first).sort()).toEqual(
      ["arrival_date", "departure_country", "departure_date", "destination_country", "trip_id", "verification_status"],
    );
    expect(first.verification_status).toBe("unverified");
  });
});

describe("trips: owner-only rows", () => {
  it("signed-out visitors can't read trips", async () => {
    await expect(as(db, null, (tx) => tx.query(`select * from public.trips`))).rejects.toThrow(NO_PERMISSION);
  });

  it("other users can't see or change my trip", async () => {
    const t = await trip(travUS, "US", "IN");
    expect((await as(db, travIN, (tx) => tx.query(`select 1 from public.trips where id = $1`, [t]))).rows).toEqual([]);
    const changed = await as(db, travIN, (tx) => tx.query(`update public.trips set notes = 'mine now' where id = $1 returning id`, [t]));
    expect(changed.rows).toEqual([]);
  });

  it("needs a verified phone, a future departure and a real route", async () => {
    await expect(asAndKeep(db, unverified, (tx) =>
      tx.query(`insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ('US','IN',$1,$2)`, [day(1), day(2)]),
    )).rejects.toThrow(RLS);
    await expect(as(db, travUS, (tx) =>
      tx.query(`insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ('US','IN',$1,$2)`, [day(-2), day(-1)]),
    )).rejects.toThrow(RLS);
    await expect(as(db, travUS, (tx) =>
      tx.query(`insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ('IN','IN',$1,$2)`, [day(1), day(2)]),
    )).rejects.toThrow(/trips_route/);
    await expect(as(db, travUS, (tx) =>
      tx.query(`insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ('US','IN',$1,$2)`, [day(3), day(1)]),
    )).rejects.toThrow(/trips_dates/);
  });

  it("travellers can't verify, complete or reassign their own trip", async () => {
    const t = await trip(travUS, "US", "IN");
    await expect(as(db, travUS, (tx) => tx.query(`update public.trips set verification_status = 'verified' where id = $1`, [t]))).rejects.toThrow(NO_PERMISSION);
    await expect(as(db, travUS, (tx) => tx.query(`update public.trips set traveller_id = $2 where id = $1`, [t, travIN]))).rejects.toThrow(NO_PERMISSION);
    await expect(as(db, travUS, (tx) => tx.query(`update public.trips set status = 'completed' where id = $1`, [t]))).rejects.toThrow(RLS);
  });

  it("travellers can cancel their own trip", async () => {
    const t = await trip(travUS, "US", "IN");
    await asAndKeep(db, travUS, (tx) => tx.query(`update public.trips set status = 'cancelled' where id = $1`, [t]));
    expect(await status("trips", t)).toBe("cancelled");
  });
});

describe("requests: routes", () => {
  it("can't be published without a route", async () => {
    const id = (await asAndKeep(db, buyer, (tx) =>
      tx.query<{ id: string }>(`insert into public.requests (title, delivery_city) values ('No route', 'Pune') returning id`),
    )).rows[0].id;
    await expect(call(buyer, "publish_request", id)).rejects.toThrow(/Choose where the item is coming from/);
  });

  it("rejects half a route, the same country twice, and names instead of codes", async () => {
    const insert = (cols: string, vals: string) =>
      as(db, buyer, (tx) => tx.query(`insert into public.requests (title, delivery_city, ${cols}) values ('X item', 'Pune', ${vals})`));
    await expect(insert("source_country", "'US'")).rejects.toThrow(/requests_route_pair/);
    await expect(insert("source_country, destination_country", "'IN', 'IN'")).rejects.toThrow(/requests_route_pair/);
    await expect(insert("source_country, destination_country", "'USA', 'IN'")).rejects.toThrow(/check constraint/);
  });

  it("buyers can't mark their own item eligible", async () => {
    await expect(as(db, buyer, (tx) =>
      tx.query(`insert into public.requests (title, delivery_city, eligibility_status) values ('X item', 'Pune', 'eligible')`),
    )).rejects.toThrow(NO_PERMISSION);
  });
});

describe("offers come from a matching trip", () => {
  it("accepts an offer from the traveller's own matching trip", async () => {
    const r = await request(buyer, "US", "IN");
    const t = await trip(travUS, "US", "IN");
    const o = await offer(travUS, r, t);
    expect(await status("offers", o)).toBe("pending");
  });

  it("refuses offers with no trip, a non-matching trip, or someone else's trip", async () => {
    const r = await request(buyer, "US", "IN");
    const reverse = await trip(travUS, "IN", "US");
    const theirs = await trip(travIN, "US", "IN");
    await expect(as(db, travUS, (tx) => tx.query(offerSql, offerValues(r, null)))).rejects.toThrow(RLS);
    await expect(as(db, travUS, (tx) => tx.query(offerSql, offerValues(r, reverse)))).rejects.toThrow(RLS);
    await expect(as(db, travUS, (tx) => tx.query(offerSql, offerValues(r, theirs)))).rejects.toThrow(RLS);
  });

  it("refuses a second offer from the same traveller on the same request", async () => {
    const r = await request(buyer, "US", "IN");
    const t = await trip(travUS, "US", "IN");
    await offer(travUS, r, t);
    await expect(as(db, travUS, (tx) => tx.query(offerSql, offerValues(r, t)))).rejects.toThrow(/duplicate key/);
  });
});

describe("lifecycle", () => {
  it("only the buyer can accept, once; other offers close and the request is matched", async () => {
    const r = await request(buyer, "US", "IN");
    const t1 = await trip(travUS, "US", "IN");
    const t2 = await trip(travIN, "US", "IN");
    const o1 = await offer(travUS, r, t1);
    const o2 = await offer(travIN, r, t2);

    await expect(call(travUS, "accept_offer", o1)).rejects.toThrow(NOT_ALLOWED);
    await expect(call(otherBuyer, "accept_offer", o1)).rejects.toThrow(NOT_ALLOWED);
    await expect(call(null, "accept_offer", o1)).rejects.toThrow(NO_PERMISSION);

    await callAndKeep(buyer, "accept_offer", o1);
    expect(await status("offers", o1)).toBe("accepted");
    expect(await status("offers", o2)).toBe("closed");
    expect(await status("requests", r)).toBe("matched");
    await expect(call(buyer, "accept_offer", o2)).rejects.toThrow(NOT_ALLOWED);
  });

  it("only the buyer reads the request row; travellers, even matched or accepted, never select it directly (I3)", async () => {
    const r = await request(buyer, "US", "IN");
    const t = await trip(travUS, "US", "IN");
    const sees = async (u: string) =>
      (await as(db, u, (tx) => tx.query(`select shopper_id from public.requests where id = $1 or (status = 'open' and shopper_id <> $2)`, [r, u]))).rows.length;
    expect(await sees(travUS)).toBe(0); // has a matching trip
    expect(await sees(unverified)).toBe(0); // any signed-in user
    await callAndKeep(buyer, "accept_offer", await offer(travUS, r, t));
    expect(await sees(travUS)).toBe(0); // accepted
    expect(await sees(buyer)).toBeGreaterThan(0);
  });

  it("won't accept an offer whose trip was cancelled", async () => {
    const r = await request(buyer, "US", "IN");
    const t = await trip(travUS, "US", "IN");
    const o = await offer(travUS, r, t);
    await asAndKeep(db, travUS, (tx) => tx.query(`update public.trips set status = 'cancelled' where id = $1`, [t]));
    await expect(call(buyer, "accept_offer", o)).rejects.toThrow(/no longer active/);
  });

  it("the buyer declines; the traveller withdraws; nobody else can do either", async () => {
    const r = await request(buyer, "US", "IN");
    const o1 = await offer(travUS, r, await trip(travUS, "US", "IN"));
    const o2 = await offer(travIN, r, await trip(travIN, "US", "IN"));
    await expect(call(travUS, "decline_offer", o1)).rejects.toThrow(NOT_ALLOWED);
    await callAndKeep(buyer, "decline_offer", o1);
    expect(await status("offers", o1)).toBe("rejected");
    await expect(call(buyer, "withdraw_offer", o2)).rejects.toThrow(NOT_ALLOWED);
    await expect(call(travUS, "withdraw_offer", o2)).rejects.toThrow(NOT_ALLOWED);
    await callAndKeep(travIN, "withdraw_offer", o2);
    expect(await status("offers", o2)).toBe("withdrawn");
  });

  it("travellers can't change offer status directly", async () => {
    const r = await request(buyer, "US", "IN");
    const o = await offer(travUS, r, await trip(travUS, "US", "IN"));
    await expect(as(db, travUS, (tx) => tx.query(`update public.offers set status = 'accepted' where id = $1`, [o]))).rejects.toThrow(NO_PERMISSION);
  });

  it("cancel and complete follow the request's state and owner", async () => {
    const r = await request(buyer, "US", "IN");
    await expect(call(buyer, "complete_request", r)).rejects.toThrow(NOT_ALLOWED); // still open
    await expect(call(otherBuyer, "cancel_request", r)).rejects.toThrow(NOT_ALLOWED);
    const t = await trip(travUS, "US", "IN");
    await callAndKeep(buyer, "accept_offer", await offer(travUS, r, t));
    await callAndKeep(buyer, "complete_request", r);
    expect(await status("requests", r)).toBe("completed");
    await expect(call(buyer, "cancel_request", r)).rejects.toThrow(NOT_ALLOWED);
  });
});

describe("history and race safety", () => {
  const events = async (user: string, requestId: string) =>
    (await as(db, user, (tx) => tx.query<{ event: string }>(`select event from public.marketplace_events where request_id = $1 order by id`, [requestId]))).rows.map((r) => r.event);

  it("records every step, in order, and shows each party only their part", async () => {
    const r = await request(buyer, "IN", "US");
    const o1 = await offer(travIN, r, await trip(travIN, "IN", "US"));
    const o2 = await offer(travUS, r, await trip(travUS, "IN", "US"));
    await callAndKeep(buyer, "accept_offer", o1);
    await callAndKeep(buyer, "complete_request", r);
    expect(await events(buyer, r)).toEqual(["request_published", "offer_submitted", "offer_submitted", "offer_accepted", "offer_closed", "request_completed"]);
    // A traveller sees only events about their own offer; a stranger sees nothing.
    expect(await events(travUS, r)).toEqual(["offer_submitted", "offer_closed"]);
    expect(await events(otherBuyer, r)).toEqual([]);
    expect(o2).toBeTruthy();
  });

  it("history never shows who acted: no buyer id to travellers, no traveller ids to buyers (I3)", async () => {
    const r = await request(buyer, "US", "IN");
    await offer(travUS, r, await trip(travUS, "US", "IN"));
    for (const u of [buyer, travUS]) {
      await expect(as(db, u, (tx) => tx.query(`select actor_id from public.marketplace_events where request_id = $1`, [r]))).rejects.toThrow(NO_PERMISSION);
    }
    expect((await db.query(`select 1 from public.marketplace_events where request_id = $1 and actor_id is not null`, [r])).rows.length).toBe(2);
  });

  it("nobody can write, edit or delete history", async () => {
    const r = await request(buyer, "US", "IN");
    await expect(as(db, buyer, (tx) => tx.query(`insert into public.marketplace_events (request_id, event) values ($1, 'request_completed')`, [r]))).rejects.toThrow(NO_PERMISSION);
    await expect(as(db, buyer, (tx) => tx.query(`update public.marketplace_events set event = 'request_cancelled' where request_id = $1`, [r]))).rejects.toThrow(NO_PERMISSION);
    await expect(as(db, buyer, (tx) => tx.query(`delete from public.marketplace_events where request_id = $1`, [r]))).rejects.toThrow(NO_PERMISSION);
    await expect(as(db, null, (tx) => tx.query(`select * from public.marketplace_events`))).rejects.toThrow(NO_PERMISSION);
  });

  it("an offer withdrawn or declined first can never then be accepted", async () => {
    const r = await request(buyer, "US", "IN");
    const withdrawn = await offer(travUS, r, await trip(travUS, "US", "IN"));
    const declined = await offer(travIN, r, await trip(travIN, "US", "IN"));
    await callAndKeep(travUS, "withdraw_offer", withdrawn);
    await callAndKeep(buyer, "decline_offer", declined);
    await expect(call(buyer, "accept_offer", withdrawn)).rejects.toThrow(/Only pending/);
    await expect(call(buyer, "accept_offer", declined)).rejects.toThrow(/Only pending/);
    await expect(call(travIN, "withdraw_offer", declined)).rejects.toThrow(/Only pending/);
    expect(await status("requests", r)).toBe("open");
  });

  it("a cancelled request closes its accepted offer too", async () => {
    const r = await request(buyer, "US", "IN");
    const o = await offer(travUS, r, await trip(travUS, "US", "IN"));
    await callAndKeep(buyer, "accept_offer", o);
    await callAndKeep(buyer, "cancel_request", r);
    expect(await status("offers", o)).toBe("closed");
    expect(await status("requests", r)).toBe("cancelled");
  });

  it("travellers' matches never include the buyer's account id", async () => {
    await request(buyer, "AE", "GB");
    const t = await trip(travIN, "AE", "GB");
    const rows = (await as(db, travIN, (tx) => tx.query<Record<string, unknown>>(`select * from public.matching_requests($1)`, [t]))).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0])).not.toContain("shopper_id");
  });

  it("matches other routes too: Singapore → India, India → UAE, UK → India", async () => {
    for (const [from, to] of [["SG", "IN"], ["IN", "AE"], ["GB", "IN"]]) {
      const r = await request(otherBuyer, from, to);
      expect(await requestsForTrip(travUS, await trip(travUS, from, to))).toContain(r);
    }
  });
});


describe("apply, probe and recover", () => {
  // Everything a client can see or call in public: tables, columns, grants, policies, function bodies.
  const SNAPSHOT = `select md5(string_agg(x, '|' order by x)) h from (
    select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') x from information_schema.columns where table_schema = 'public'
    union all select 'grant:' || table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema = 'public'
    union all select 'colgrant:' || table_name || '.' || column_name || ':' || grantee || ':' || privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated')
    union all select 'policy:' || tablename || ':' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') from pg_policies where schemaname = 'public'
    union all select 'fn:' || proname || ':' || md5(prosrc) || ':' || prosecdef from pg_proc where pronamespace = 'public'::regnamespace
    union all select 'con:' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace and contype <> 'n'
    union all select 'idx:' || indexname from pg_indexes where schemaname = 'public'
  ) s`;

  it("the probe passes after applying, and recovery restores the exact schema from before", async () => {
    const { db: fresh } = await createLocalSupabase();
    const before = (await fresh.query<{ h: string }>(SNAPSHOT)).rows[0].h;
    await fresh.exec(STAGE4);
    const probe = (await fresh.query<Record<string, boolean>>(PROBE)).rows[0];
    expect(Object.entries(probe).filter(([, ok]) => ok !== true)).toEqual([]);
    await fresh.exec(RECOVERY);
    expect((await fresh.query<{ h: string }>(SNAPSHOT)).rows[0].h).toBe(before);
  });
});
