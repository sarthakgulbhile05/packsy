import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asAndKeep, createLocalSupabase, createUser, type Db } from "./local-supabase";

// Stage 2 (applied to dev as 20261028105912). Offer behaviour runs on every real migration, so requests are
// published the Stage 3a way. The apply, probe and recovery tests replay Stage 2 on the schema just before it
// (no Stage 3a yet), so those steps stay tested. Nothing here touches the Supabase project.

const STAGE2 = "20261028105912_offers_cost_breakdown.sql";
const STAGE3A = "20261030070544_requests_drafts_and_publish.sql";
const DRAFT = readFileSync(`supabase/migrations/${STAGE2}`, "utf8");
const PROBE = readFileSync("supabase/drafts/stage2_offers_cost_breakdown.probe.sql", "utf8");
const RECOVERY = readFileSync("supabase/drafts/stage2_offers_cost_breakdown.recovery.sql", "utf8");

const RLS = /row-level security/;
const NO_PERMISSION = /permission denied/;
const CHECK = /check constraint/;

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const VALID = {
  product_price_amount: 249.99,
  product_currency: "USD",
  fx_rate_to_inr: 83.456789,
  service_fee_inr: 2000,
  delivery_inr: 150,
  customs_estimate_inr: 1500,
  arrival_date: inDays(10),
  handoff_method: "meet_in_person",
  declares_lawful_import: true,
  message: "Sealed box, original receipt",
};
type Offer = Partial<Record<keyof typeof VALID | "other_costs_inr" | "other_costs_note" | "product_price_fixed" | "status" | "traveller_id" | "estimated_total_inr", unknown>>;

/** Inserts an offer with VALID values overridden by `changes` (undefined = leave the column out). */
function offer(requestId: string, changes: Offer = {}) {
  const values: Record<string, unknown> = { request_id: requestId, ...VALID, ...changes };
  const cols = Object.keys(values).filter((k) => values[k] !== undefined);
  return {
    sql: `insert into public.offers (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
      returning traveller_id, status, product_price_inr::int, agreed_total_inr::int, estimated_total_inr::int`,
    params: cols.map((k) => values[k]),
  };
}

async function withHistory(skip: string[]) {
  const { db } = await createLocalSupabase({ skip });
  await db.exec(`create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text)`);
  return db;
}
/** The schema as it was just before Stage 2 (so also before Stage 3a). */
const freshDb = () => withHistory([STAGE2, STAGE3A]);

/** A buyer's request made the real way: a draft through the insert policy, then publish_request(). */
async function publishedRequest(target: Db, owner: string, columns = "title, delivery_city", values = "'Vintage coffee grinder', 'Pune'") {
  const id = (await asAndKeep(target, owner, (tx) =>
    tx.query<{ id: string }>(`insert into public.requests (${columns}) values (${values}) returning id`),
  )).rows[0].id;
  await asAndKeep(target, owner, (tx) => tx.query(`select public.publish_request($1)`, [id]));
  return id;
}

let db: Db;
let buyer: string, traveller: string, traveller2: string, unverified: string;
let openRequest: string, matchedRequest: string, expiredRequest: string;

beforeAll(async () => {
  db = await withHistory([]); // every migration, once each
  buyer = await createUser(db, { phoneVerified: true, name: "Buyer" });
  traveller = await createUser(db, { phoneVerified: true, name: "Traveller" });
  traveller2 = await createUser(db, { phoneVerified: true, name: "Traveller 2" });
  unverified = await createUser(db, { name: "Unverified" });
  openRequest = await publishedRequest(db, buyer);
  // Moved on by the server after publishing (as stage 4's functions will); users can't set status or expiry
  // themselves. Both keep valid publication dates.
  matchedRequest = await publishedRequest(db, buyer, "title, delivery_city", "'Camera', 'Delhi'");
  await db.query(`update public.requests set status = 'matched' where id = $1`, [matchedRequest]);
  expiredRequest = await publishedRequest(db, buyer, "title, delivery_city", "'Camera', 'Delhi'");
  await db.query(`update public.requests set published_at = now() - interval '31 days', expires_at = now() - interval '1 hour' where id = $1`, [expiredRequest]);
});

const tryOffer = (user: string | null, requestId: string, changes: Offer = {}) => {
  const { sql, params } = offer(requestId, changes);
  return as(db, user, (tx) => tx.query<Record<string, number | string>>(sql, params));
};

describe("stage 2: offer amounts", () => {
  it("computes the INR breakdown, keeping estimates separate from what the traveller commits to", async () => {
    const { rows } = await tryOffer(traveller, openRequest);
    // 249.99 USD × 83.456789 = 20,863.36 → ₹20,863. Committed: fee 2,000 + delivery 150.
    // Estimated: product 20,863 + 2,000 + 150 + customs estimate 1,500.
    expect(rows[0]).toEqual({ traveller_id: traveller, status: "pending", product_price_inr: 20863, agreed_total_inr: 2150, estimated_total_inr: 24513 });
  });

  it("counts the product price as agreed only when the traveller fixes it in rupees", async () => {
    const { rows } = await tryOffer(traveller, openRequest, {
      product_price_amount: 15000, product_currency: "INR", fx_rate_to_inr: 1, product_price_fixed: true, customs_estimate_inr: undefined,
      other_costs_inr: 300, other_costs_note: "Bubble wrap and box",
    });
    expect(rows[0]).toMatchObject({ product_price_inr: 15000, agreed_total_inr: 17450, estimated_total_inr: 17450 });
  });

  it("leaves customs out of every total when the traveller doesn't estimate it", async () => {
    const { rows } = await tryOffer(traveller, openRequest, { customs_estimate_inr: undefined });
    expect(rows[0]).toMatchObject({ estimated_total_inr: 20863 + 2000 + 150 });
  });

  it("rounds to whole rupees, half away from zero", async () => {
    const { rows } = await tryOffer(traveller, openRequest, { product_price_amount: 0.1, fx_rate_to_inr: 5 });
    expect(rows[0].product_price_inr).toBe(1); // 0.50 → 1
  });

  it.each<[string, Offer]>([
    ["negative fee", { service_fee_inr: -1 }],
    ["zero product price", { product_price_amount: 0 }],
    ["negative product price", { product_price_amount: -5 }],
    ["negative delivery", { delivery_inr: -10 }],
    ["negative customs estimate", { customs_estimate_inr: -1 }],
    ["fee above ₹10 lakh", { service_fee_inr: 1_000_001 }],
    ["product above ₹1 crore after conversion", { product_price_amount: 2_000_000 }],
    ["unknown currency", { product_currency: "BTC" }],
    ["zero exchange rate", { fx_rate_to_inr: 0 }],
    ["INR priced with a rate other than 1", { product_currency: "INR", fx_rate_to_inr: 83 }],
    ["other costs without an explanation", { other_costs_inr: 500 }],
    ["other costs with a blank explanation", { other_costs_inr: 500, other_costs_note: "   " }],
    ["unknown handoff method", { handoff_method: "drone" }],
    ["no handoff method", { handoff_method: undefined }],
    ["no product price", { product_price_amount: undefined }],
    ["no currency", { product_currency: undefined }],
    ["lawful-import declaration not given", { declares_lawful_import: false }],
  ])("rejects %s", async (_, changes) => {
    await expect(tryOffer(traveller, openRequest, changes)).rejects.toThrow(CHECK);
  });

  it("rejects a missing or past arrival date", async () => {
    await expect(tryOffer(traveller, openRequest, { arrival_date: undefined })).rejects.toThrow(RLS);
    await expect(tryOffer(traveller, openRequest, { arrival_date: inDays(-1) })).rejects.toThrow(RLS);
  });

  it("never lets a client write a total", async () => {
    await expect(tryOffer(traveller, openRequest, { estimated_total_inr: 1 })).rejects.toThrow(/permission denied|non-DEFAULT value/);
  });
});

// Independent reference, exact decimal maths with BigInt (no floating point):
// amount has 2 decimals, rate 6, so amount × rate is exact in units of 1e-8; round half away from zero.
const toUnits = (s: string, places: number) => {
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole + frac.padEnd(places, "0"));
};
const expectedProductInr = (amount: string, rate: string) =>
  Number((toUnits(amount, 2) * toUnits(rate, 6) + BigInt(50_000_000)) / BigInt(100_000_000));

const RATES: Record<string, string> = { INR: "1", USD: "83.456789", EUR: "90.123456", GBP: "105.5", AED: "22.723456", JPY: "0.551234", SGD: "61.987654" };
const AMOUNTS = ["0.99", "1", "19.99", "249.99", "1234.56", "9999.99", "85000"];

describe("stage 2: formulas (checked against exact decimal maths)", () => {
  const read = (user: string, req: string, changes: Offer) => tryOffer(user, req, changes).then((r) => r.rows[0]);

  for (const [currency, rate] of Object.entries(RATES)) {
    it(`${currency}: product price, agreed and estimated totals for fixed and unfixed prices, with and without customs`, async () => {
      for (const amount of AMOUNTS) {
        const product = expectedProductInr(amount, rate);
        if (product < 1 || product > 10_000_000) continue; // out of range: covered by the rejection tests
        for (const fixed of [false, true]) {
          for (const customs of [undefined, 0, 1800]) {
            const row = await read(traveller, openRequest, {
              product_price_amount: amount, product_currency: currency, fx_rate_to_inr: rate,
              product_price_fixed: fixed, customs_estimate_inr: customs, service_fee_inr: 2500, delivery_inr: 200,
              other_costs_inr: 99, other_costs_note: "Packing",
            });
            const charges = 2500 + 200 + 99;
            expect(row, `${amount} ${currency} fixed=${fixed} customs=${customs}`).toMatchObject({
              product_price_inr: product,
              agreed_total_inr: charges + (fixed ? product : 0),
              estimated_total_inr: product + charges + (customs ?? 0),
            });
          }
        }
      }
    });
  }

  it.each([
    ["100.50", "INR", "1", 101], // exactly half → up
    ["100.49", "INR", "1", 100],
    ["1", "JPY", "0.5", 1], // 0.5 → 1
    ["3", "JPY", "0.5", 2], // 1.5 → 2
    ["2", "EUR", "1.25", 3], // 2.5 → 3
    ["10000000", "INR", "1", 10_000_000], // the ₹1 crore ceiling itself is allowed
  ])("rounds %s %s at %s to ₹%i", async (amount, currency, rate, inr) => {
    expect((await read(traveller, openRequest, { product_price_amount: amount, product_currency: currency, fx_rate_to_inr: rate })).product_price_inr).toBe(inr);
  });

  it("rejects a product price that rounds to above ₹1 crore", async () => {
    await expect(read(traveller, openRequest, { product_price_amount: "10000000.50", product_currency: "INR", fx_rate_to_inr: 1 })).rejects.toThrow(CHECK);
  });

  it("the largest possible offer still fits (no overflow)", async () => {
    const row = await read(traveller, openRequest, {
      product_price_amount: "10000000", product_currency: "INR", fx_rate_to_inr: 1, product_price_fixed: true,
      service_fee_inr: 1_000_000, delivery_inr: 1_000_000, other_costs_inr: 1_000_000, other_costs_note: "Insurance", customs_estimate_inr: 10_000_000,
    });
    expect(row).toMatchObject({ agreed_total_inr: 13_000_000, estimated_total_inr: 23_000_000 });
  });

  it("prices are for the whole requested quantity: totals never multiply by it", async () => {
    const threeOf = await publishedRequest(db, buyer, "title, delivery_city, quantity", "'Three mugs', 'Pune', 3");
    const row = await read(traveller, threeOf, { product_price_amount: "30", product_currency: "USD", fx_rate_to_inr: "83.456789", customs_estimate_inr: undefined });
    expect(row).toMatchObject({ product_price_inr: 2504, estimated_total_inr: 2504 + 2000 + 150 });
  });

  it("stores what the buyer-facing wording needs to tell estimates from commitments", async () => {
    const { rows } = await as(db, traveller, async (tx) => {
      await tx.query(offer(openRequest, { product_price_fixed: false, customs_estimate_inr: undefined }).sql, offer(openRequest, { product_price_fixed: false, customs_estimate_inr: undefined }).params);
      return tx.query(`select product_price_fixed, customs_estimate_inr, fx_rate_to_inr::text, product_currency, agreed_total_inr::int, estimated_total_inr::int
        from public.offers where traveller_id = $1`, [traveller]);
    });
    // Unfixed product, no customs estimate: the wording must say the item price is an estimate at the
    // traveller's rate, and that customs is not included. Agreed charges exclude the item.
    expect(rows[0]).toEqual({ product_price_fixed: false, customs_estimate_inr: null, fx_rate_to_inr: "83.456789", product_currency: "USD", agreed_total_inr: 2150, estimated_total_inr: 23013 });
  });
});

describe("stage 2: who can offer", () => {
  it("can't offer as someone else or choose a status", async () => {
    await expect(tryOffer(traveller, openRequest, { traveller_id: traveller2 })).rejects.toThrow(NO_PERMISSION);
    await expect(tryOffer(traveller, openRequest, { status: "accepted" })).rejects.toThrow(NO_PERMISSION);
  });

  it("needs a verified phone, and never on your own request", async () => {
    await expect(tryOffer(unverified, openRequest)).rejects.toThrow(RLS);
    await expect(tryOffer(buyer, openRequest)).rejects.toThrow(RLS);
    await expect(tryOffer(null, openRequest)).rejects.toThrow(NO_PERMISSION);
  });

  it("only on open, unexpired requests", async () => {
    await expect(tryOffer(traveller, matchedRequest)).rejects.toThrow(RLS);
    await expect(tryOffer(traveller, expiredRequest)).rejects.toThrow(RLS);
  });

  it("never on a draft: a request must be published first", async () => {
    const draft = (await asAndKeep(db, buyer, (tx) =>
      tx.query<{ id: string }>(`insert into public.requests (title, delivery_city) values ('Unpublished lamp', 'Pune') returning id`),
    )).rows[0].id;
    await expect(tryOffer(traveller, draft)).rejects.toThrow(RLS);
  });

  it("refuses a duplicate submission from the same traveller", async () => {
    const { sql, params } = offer(openRequest);
    await asAndKeep(db, traveller2, (tx) => tx.query(sql, params));
    await expect(as(db, traveller2, (tx) => tx.query(sql, params))).rejects.toThrow(/duplicate key/);
  });

  it("nobody can edit or delete an offer in stage 2, their own or anyone else's", async () => {
    for (const user of [traveller2, traveller, buyer]) {
      await expect(as(db, user, (tx) => tx.query(`update public.offers set service_fee_inr = 1`))).rejects.toThrow(NO_PERMISSION);
      await expect(as(db, user, (tx) => tx.query(`delete from public.offers`))).rejects.toThrow(NO_PERMISSION);
    }
  });

  it("offers stay visible only to their traveller and the request owner", async () => {
    const seen = async (user: string) =>
      (await as(db, user, (tx) => tx.query(`select estimated_total_inr from public.offers where request_id = $1`, [openRequest]))).rows.length;
    expect(await seen(buyer)).toBe(1);
    expect(await seen(traveller2)).toBe(1);
    expect(await seen(traveller)).toBe(0);
    expect(await seen(unverified)).toBe(0);
  });

  it("a request can never have two accepted offers (backstop for stage 4)", async () => {
    const other = await createUser(db, { phoneVerified: true });
    const { sql, params } = offer(openRequest);
    await asAndKeep(db, other, (tx) => tx.query(sql, params));
    await db.query(`update public.offers set status = 'accepted' where traveller_id = $1`, [traveller2]);
    await expect(db.query(`update public.offers set status = 'accepted' where traveller_id = $1`, [other])).rejects.toThrow(/duplicate key/);
    await db.query(`update public.offers set status = 'pending'`);
  });
});

// Every permission and policy, so the comparison shows exactly what stage 2 changes.
async function accessSnapshot(target: Db) {
  const { rows } = await target.query<{ line: string }>(`
    select 'grant ' || table_name || ' ' || grantee || ' ' || privilege_type || '(' || column_name || ')' as line
      from information_schema.column_privileges
      where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
    union all
    select 'table ' || table_name || ' ' || grantee || ' ' || privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
    union all
    select 'policy ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || coalesce(qual, '-') || ' ' || coalesce(with_check, '-')
      from pg_policies where schemaname = 'public'
    order by 1`);
  return rows.map((r) => r.line);
}

describe("stage 2: permission changes", () => {
  it("adds only the 12 breakdown insert grants (plus the renamed fee) and the tighter insert rule; nothing else changes", async () => {
    const before = await freshDb();
    const old = await accessSnapshot(before);
    await before.exec(DRAFT);
    const now = await accessSnapshot(before);
    const added = now.filter((l) => !old.includes(l));
    const removed = old.filter((l) => !now.includes(l));
    expect(added.filter((l) => l.startsWith("grant")).sort()).toEqual(
      ["arrival_date", "customs_estimate_inr", "customs_note", "declares_lawful_import", "delivery_inr", "fx_rate_to_inr",
        "handoff_method", "other_costs_inr", "other_costs_note", "product_currency", "product_price_amount", "product_price_fixed",
        "service_fee_inr"]
        .map((c) => `grant offers authenticated INSERT(${c})`),
    );
    // The fee grant follows the renamed column; the insert policy is the only policy that changes.
    expect(removed).toEqual([
      "grant offers authenticated INSERT(reward_inr)",
      expect.stringMatching(/^policy offers Phone-verified travellers can offer on others' open requests INSERT/),
    ]);
    expect(added).toContain("grant offers authenticated INSERT(service_fee_inr)");
    expect(added.filter((l) => l.startsWith("policy"))).toEqual([expect.stringMatching(/expires_at/)]);
    expect(added.filter((l) => l.startsWith("table"))).toEqual([]);
  });

  it("keeps existing offers, which keep their fee and get empty breakdowns", async () => {
    const legacyDb = await freshDb();
    const b = await createUser(legacyDb, { phoneVerified: true });
    const t = await createUser(legacyDb, { phoneVerified: true });
    const req = (await legacyDb.query<{ id: string }>(`insert into public.requests (shopper_id, title, delivery_city, price_inr, reward_inr) values ($1, 'Old', 'Pune', 100, 10) returning id`, [b])).rows[0].id;
    await legacyDb.query(`insert into public.offers (request_id, traveller_id, reward_inr, message) values ($1, $2, 700, 'old offer')`, [req, t]);
    await legacyDb.exec(DRAFT);
    const { rows } = await legacyDb.query(`select service_fee_inr, message, status, product_price_inr, agreed_total_inr::int, estimated_total_inr::int, delivery_inr from public.offers`);
    expect(rows).toEqual([{ service_fee_inr: 700, message: "old offer", status: "pending", product_price_inr: null, agreed_total_inr: 700, estimated_total_inr: 700, delivery_inr: 0 }]);
  });
});

describe("stage 2: apply and recovery procedure", () => {
  // Top-level statements of the draft (it has no $$ bodies, so each ends with ';' at the end of a line).
  const statements = DRAFT.split("\n").reduce<string[]>((acc, line) => {
    acc[acc.length - 1] += line + "\n";
    if (/;\s*$/.test(line) && !line.trimStart().startsWith("--")) acc.push("");
    return acc;
  }, [""]).filter((s) => s.replace(/--.*$/gm, "").trim());

  const shape = async (target: Db) =>
    (await target.query<{ s: string }>(`select concat_ws(' || ',
      (select string_agg(column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, ''), ',' order by column_name)
         from information_schema.columns where table_schema = 'public' and table_name = 'offers'),
      (select string_agg(conname || pg_get_constraintdef(oid), ';' order by conname) from pg_constraint where conrelid = 'public.offers'::regclass),
      (select string_agg(indexdef, ';' order by indexname) from pg_indexes where tablename = 'offers'),
      (select string_agg(attname || '=' || coalesce(col_description('public.offers'::regclass, attnum), '-'), ',' order by attname)
         from pg_attribute where attrelid = 'public.offers'::regclass and attnum > 0 and not attisdropped)
    ) s`)).rows[0].s + (await accessSnapshot(target)).join("\n");
  const state = async (target: Db) => (await target.query<{ state: string }>(PROBE)).rows[0].state;

  it("splits into the expected 11 statements", () => expect(statements).toHaveLength(11));

  for (let k = 0; k <= 11; k++) {
    it(`stopping after ${k} statement(s): probe is right and recovery restores the exact original`, async () => {
      const target = await freshDb();
      const original = await shape(target);
      for (const s of statements.slice(0, k)) await target.exec(s);
      expect(await state(target)).toBe(k === 0 ? "not applied" : k === 11 ? "applied" : "PARTIAL");
      await target.exec(RECOVERY);
      expect(await shape(target)).toBe(original);
      expect(await state(target)).toBe("not applied");
      await target.exec(DRAFT);
      expect(await state(target)).toBe("applied");
    });
  }

  // What users can actually do after each statement. Intermediate states (1–5) must never allow more
  // than today; the new ability (a full offer) may only appear once the grants run (statement 6).
  async function abilitiesAfter(k: number) {
    const target = await freshDb();
    const owner = await createUser(target, { phoneVerified: true });
    const trav = await createUser(target, { phoneVerified: true });
    const other = await createUser(target, { phoneVerified: true });
    const unv = await createUser(target);
    const req = (await asAndKeep(target, owner, (tx) =>
      tx.query<{ id: string }>(`insert into public.requests (title, delivery_city) values ('Grinder', 'Pune') returning id`),
    )).rows[0].id;
    await target.query(`insert into public.offers (request_id, traveller_id, reward_inr) values ($1, $2, 500)`, [req, other]);
    for (const s of statements.slice(0, k)) await target.exec(s);
    const fee = k === 0 ? "reward_inr" : "service_fee_inr";
    const ok = (p: Promise<unknown>) => p.then(() => true, () => false);
    const full = offer(req, {});
    const minimal = `insert into public.offers (request_id, ${fee}, message) values ($1, 1200, 'hi')`;
    const can: string[] = [];
    if (await ok(as(target, trav, (tx) => tx.query(minimal, [req])))) can.push("minimal offer");
    if (await ok(as(target, trav, (tx) => tx.query(full.sql, full.params)))) can.push("full offer");
    if (await ok(as(target, unv, (tx) => tx.query(full.sql, full.params)))) can.push("unverified offer");
    if (await ok(as(target, owner, (tx) => tx.query(full.sql, full.params)))) can.push("offer on own request");
    if (await ok(as(target, trav, (tx) => tx.query(`insert into public.offers (request_id, ${fee}, status) values ($1, 1, 'accepted')`, [req])))) can.push("set status");
    if (await ok(as(target, other, (tx) => tx.query(`update public.offers set ${fee} = 1`)))) can.push("edit offer");
    if (await ok(as(target, other, (tx) => tx.query(`delete from public.offers`)))) can.push("delete offer");
    if (await ok(as(target, null, (tx) => tx.query(`select 1 from public.offers`)))) can.push("anon read");
    const seenBy = async (u: string) => (await as(target, u, (tx) => tx.query(`select 1 from public.offers`))).rows.length;
    if ((await seenBy(trav)) > 0) can.push("stranger reads another traveller's offer");
    if ((await seenBy(owner)) !== 1 || (await seenBy(other)) !== 1) can.push("owner/traveller read broken");
    return can;
  }

  it("every intermediate state is no less restrictive than today; the new ability appears only at the end", async () => {
    const results: string[] = [];
    for (let k = 0; k <= 11; k++) results.push(`${k}: ${(await abilitiesAfter(k)).join(", ") || "(no inserts at all)"}`);
    expect(results).toEqual([
      "0: minimal offer", // today
      "1: minimal offer", // rename only: same ability, new column name
      "2: (no inserts at all)", // completeness check exists, new columns not yet granted → stricter than today
      "3: (no inserts at all)",
      "4: (no inserts at all)",
      "5: (no inserts at all)", // tighter insert rule, still no grants
      "6: full offer", // grants: the intended stage 2 ability
      "7: full offer", "8: full offer", "9: full offer", "10: full offer", "11: full offer", // comments only
    ]);
  }, 60_000); // builds 12 fresh databases

  it("a failure at the end of the whole file leaves 'not applied' (local Postgres)", async () => {
    const target = await freshDb();
    await expect(target.exec(DRAFT + "\nselect 1/0;")).rejects.toThrow();
    expect(await state(target)).toBe("not applied");
  });

  it("recovery refuses to run when offers exist", async () => {
    await expect(db.exec(RECOVERY)).rejects.toThrow(/has rows/);
    expect(await state(db)).toBe("applied");
  });
});
