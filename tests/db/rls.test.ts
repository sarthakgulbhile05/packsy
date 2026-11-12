import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asAndKeep, createLocalSupabase, createUser, type Db } from "./local-supabase";

const LEAST_PRIVILEGE = "supabase/migrations/20261027100743_profiles_least_privilege.sql";

/** Every table and column privilege anon/authenticated hold on public.profiles, sorted. */
async function profilePrivileges(db: Db) {
  const { rows } = await db.query<{ p: string }>(`
    select grantee || ':' || privilege_type as p from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon', 'authenticated')
    union
    select grantee || ':' || privilege_type || '(' || column_name || ')' from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon', 'authenticated')
        and privilege_type = 'UPDATE'
    order by 1`);
  return rows.map((r) => r.p);
}

// Runs every migration in supabase/migrations against an in-memory Postgres, then checks the
// rules as real logged-in / logged-out users would hit them. Simulated: not the remote project.

const RLS = /row-level security/;
const NO_PERMISSION = /permission denied/;

const newRequest = {
  title: "Noise-cancelling headphones",
  product_url: "https://shop.example/headphones",
  delivery_city: "Pune",
};
const insertRequestSql = `insert into public.requests (title, product_url, delivery_city)
  values ($1, $2, $3) returning id, shopper_id, status`;
const requestParams = Object.values(newRequest);

let db: Db;
let unverified: string;
let verified: string;
let verified2: string;
let bystander: string;
let openRequestId: string;
let draftRequestId: string;

beforeAll(async () => {
  ({ db } = await createLocalSupabase());
  unverified = await createUser(db, { name: "Unverified" });
  verified = await createUser(db, { phoneVerified: true, name: "Shopper" });
  verified2 = await createUser(db, { phoneVerified: true, name: "Traveller" });
  bystander = await createUser(db, { phoneVerified: true, name: "Bystander" });
  // One published request (draft, then publish_request) and one unpublished draft, both owned by `verified`.
  const create = async () =>
    (await asAndKeep(db, verified, (tx) => tx.query<{ id: string }>(insertRequestSql, requestParams))).rows[0].id;
  openRequestId = await create();
  await asAndKeep(db, verified, (tx) => tx.query("select public.publish_request($1)", [openRequestId]));
  draftRequestId = await create();
});

describe("migrations", () => {
  it("all apply cleanly in order", async () => {
    const { migrations } = await createLocalSupabase();
    expect(migrations).toEqual([
      "20261027070000_create_profiles.sql",
      "20261027081619_is_phone_verified.sql",
      "20261027081632_create_requests.sql",
      "20261027081644_create_offers.sql",
      "20261027100743_profiles_least_privilege.sql",
      "20261028072345_requests_marketplace_fields.sql",
      "20261028105912_offers_cost_breakdown.sql",
      "20261030070544_requests_drafts_and_publish.sql",
      "20261030164247_profiles_own_row_read.sql",
    ]);
  });

  it("the test helper really rolls back, so tests don't leak changes", async () => {
    const count = async () => Number((await db.query<{ n: number }>("select count(*)::int as n from public.requests")).rows[0].n);
    const before = await count();
    await as(db, verified, (tx) => tx.query(insertRequestSql, requestParams));
    expect(await count()).toBe(before);
  });

  it("RLS is on for every public table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
    );
    expect(rows).toEqual([
      { relname: "offers", relrowsecurity: true },
      { relname: "profiles", relrowsecurity: true },
      { relname: "requests", relrowsecurity: true },
    ]);
  });
});

describe("is_phone_verified()", () => {
  const check = (id: string) =>
    as(db, id, async (tx) => (await tx.query<{ v: boolean }>("select public.is_phone_verified() as v")).rows[0].v);

  it("is true only when Supabase Auth has confirmed the phone", async () => {
    expect(await check(verified)).toBe(true);
    expect(await check(unverified)).toBe(false);
    const pending = await createUser(db, { phone: "919000000099" }); // number added, never confirmed
    expect(await check(pending)).toBe(false);
  });

  it("can't be called by logged-out visitors", async () => {
    await expect(as(db, null, (tx) => tx.query("select public.is_phone_verified()"))).rejects.toThrow(
      NO_PERMISSION,
    );
  });

  it("users can't mark themselves verified: auth.users is not writable or readable by them", async () => {
    await expect(
      as(db, unverified, (tx) =>
        tx.query("update auth.users set phone = '919000000001', phone_confirmed_at = now() where id = auth.uid()"),
      ),
    ).rejects.toThrow(NO_PERMISSION);
    await expect(as(db, unverified, (tx) => tx.query("select phone from auth.users"))).rejects.toThrow(
      NO_PERMISSION,
    );
  });
});

describe("profiles least-privilege migration", () => {
  const EXPECTED = ["authenticated:SELECT", "authenticated:UPDATE(full_name)"];

  it("leaves logged-in users exactly SELECT + UPDATE(full_name), and logged-out visitors nothing", async () => {
    expect(await profilePrivileges(db)).toEqual(EXPECTED);
  });

  it("removes the broad defaults that existed before it", async () => {
    const { db: before } = await createLocalSupabase({ skip: [LEAST_PRIVILEGE.split("/").pop()!] });
    // Matches what the dev project reported on 2026-10-27 before this migration.
    const broad = ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE"];
    expect(await profilePrivileges(before)).toEqual(
      [...broad.map((p) => `anon:${p}`), ...broad.map((p) => `authenticated:${p}`), "authenticated:UPDATE(full_name)"].sort(),
    );
  });

  it("is safe to run twice (same result, no error)", async () => {
    const { db: twice } = await createLocalSupabase();
    await twice.exec(readFileSync(LEAST_PRIVILEGE, "utf8"));
    expect(await profilePrivileges(twice)).toEqual(EXPECTED);
  });

  it("doesn't change any profile data", async () => {
    const { db: before } = await createLocalSupabase({ skip: [LEAST_PRIVILEGE.split("/").pop()!] });
    await createUser(before, { name: "Kept" });
    const snapshot = async () => (await before.query("select id, full_name, created_at from public.profiles order by id")).rows;
    const rows = await snapshot();
    await before.exec(readFileSync(LEAST_PRIVILEGE, "utf8"));
    expect(await snapshot()).toEqual(rows);
  });

  it("still lets account deletion remove the profile (cascade)", async () => {
    const { db: fresh } = await createLocalSupabase();
    const id = await createUser(fresh);
    await fresh.query("delete from auth.users where id = $1", [id]);
    expect((await fresh.query("select 1 from public.profiles where id = $1", [id])).rows).toHaveLength(0);
  });
});

describe("profiles", () => {
  it("the sign-up trigger creates a profile with the name, capped at 100 chars", async () => {
    const id = await createUser(db, { name: "A".repeat(150) });
    const { rows } = await db.query<{ full_name: string }>("select full_name from public.profiles where id = $1", [id]);
    expect(rows[0].full_name).toHaveLength(100);
  });

  it("logged-in users read only their own profile, logged-out visitors can't read any", async () => {
    const { rows } = await as(db, unverified, (tx) => tx.query<{ id: string }>("select id, full_name from public.profiles"));
    expect(rows.map((r) => r.id)).toEqual([unverified]);
    await expect(as(db, null, (tx) => tx.query("select * from public.profiles"))).rejects.toThrow(NO_PERMISSION);
  });

  it("profiles contain no phone number column", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles'",
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(["created_at", "full_name", "id"]);
  });

  it("users can rename themselves but not others", async () => {
    const own = await as(db, unverified, (tx) =>
      tx.query("update public.profiles set full_name = 'New name' where id = $1", [unverified]),
    );
    expect(own.affectedRows).toBe(1);
    const other = await as(db, unverified, (tx) =>
      tx.query("update public.profiles set full_name = 'Hacked' where id = $1", [verified]),
    );
    expect(other.affectedRows).toBe(0);
  });

  it("users can't change id or created_at, insert, delete or truncate profiles", async () => {
    for (const sql of [
      "update public.profiles set id = gen_random_uuid() where id = auth.uid()",
      "update public.profiles set created_at = now() where id = auth.uid()",
      "insert into public.profiles (id, full_name) values (gen_random_uuid(), 'x')",
      "delete from public.profiles where id = auth.uid()",
      "truncate public.profiles cascade",
    ]) {
      await expect(as(db, unverified, (tx) => tx.query(sql)), sql).rejects.toThrow(NO_PERMISSION);
      await expect(as(db, null, (tx) => tx.query(sql)), `anon: ${sql}`).rejects.toThrow(NO_PERMISSION);
    }
  });
});

describe("requests", () => {
  it("unverified users can't create a request, even calling the database directly", async () => {
    await expect(as(db, unverified, (tx) => tx.query(insertRequestSql, requestParams))).rejects.toThrow(RLS);
  });

  it("verified users can, and they own it as a private draft", async () => {
    const row = await as(db, verified2, async (tx) => (await tx.query<{ shopper_id: string; status: string }>(insertRequestSql, requestParams)).rows[0]);
    expect(row).toEqual(expect.objectContaining({ shopper_id: verified2, status: "draft" }));
  });

  it("users can write exactly the 14 request-form columns, on insert and on update", async () => {
    const { rows } = await db.query<{ privilege_type: string; columns: string }>(
      `select privilege_type, string_agg(column_name, ',' order by column_name) as columns from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'requests' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
        group by privilege_type order by privilege_type`,
    );
    const form = "attributes,budget_amount,budget_currency,delivery_city,description,item_condition,item_kind,needed_by,notes,origin_preference,preview_image_url,product_url,quantity,title";
    expect(rows).toEqual([{ privilege_type: "INSERT", columns: form }, { privilege_type: "UPDATE", columns: form }]);
    const anon = await db.query(`select 1 from information_schema.column_privileges where table_schema = 'public' and grantee = 'anon'`);
    expect(anon.rows).toHaveLength(0);
  });

  it.each([
    ["shopper_id", "'00000000-0000-4000-8000-999999999999'"],
    ["status", "'open'"],
    ["published_at", "now()"],
    ["expires_at", "now() + interval '30 days'"],
    ["image_path", "'a/b/c.jpg'"],
    ["price_inr", "1"],
    ["reward_inr", "1"],
  ])("users can't set %s themselves, on insert or on their own draft", async (column, value) => {
    await expect(
      as(db, verified, (tx) => tx.query(`insert into public.requests (title, delivery_city, ${column}) values ('Phone', 'Pune', ${value})`)),
    ).rejects.toThrow(NO_PERMISSION);
    await expect(
      as(db, verified, (tx) => tx.query(`update public.requests set ${column} = ${value} where id = $1`, [draftRequestId])),
    ).rejects.toThrow(NO_PERMISSION);
  });

  it("a published request can't be edited or deleted, even by its owner", async () => {
    expect((await as(db, verified, (tx) => tx.query("update public.requests set title = 'Changed' where id = $1", [openRequestId]))).affectedRows).toBe(0);
    expect((await as(db, verified, (tx) => tx.query("delete from public.requests where id = $1", [openRequestId]))).affectedRows).toBe(0);
  });

  it("nobody else can edit or delete someone's draft; logged-out visitors can't try", async () => {
    for (const user of [verified2, bystander, unverified]) {
      expect((await as(db, user, (tx) => tx.query("update public.requests set title = 'Hacked' where id = $1", [draftRequestId]))).affectedRows).toBe(0);
      expect((await as(db, user, (tx) => tx.query("delete from public.requests where id = $1", [draftRequestId]))).affectedRows).toBe(0);
    }
    await expect(as(db, null, (tx) => tx.query("update public.requests set title = 'Hacked'"))).rejects.toThrow(NO_PERMISSION);
    await expect(as(db, null, (tx) => tx.query("delete from public.requests"))).rejects.toThrow(NO_PERMISSION);
  });

  it("logged-in users can browse published requests (even unverified), never others' drafts; logged-out visitors can't", async () => {
    const ids = async (user: string) => (await as(db, user, (tx) => tx.query<{ id: string }>("select id from public.requests"))).rows.map((r) => r.id);
    expect(await ids(unverified)).toEqual([openRequestId]);
    expect((await ids(verified)).sort()).toEqual([openRequestId, draftRequestId].sort());
    await expect(as(db, null, (tx) => tx.query("select * from public.requests"))).rejects.toThrow(NO_PERMISSION);
  });

  it("rejects bad data: non-https links, too many items", async () => {
    const insert = "insert into public.requests (title, delivery_city, product_url, quantity) values ('Phone', 'Pune', $1, $2)";
    for (const params of [
      ["http://shop.example/x", 1],
      ["javascript:alert(1)", 1],
      [null, 11],
    ]) {
      await expect(as(db, verified, (tx) => tx.query(insert, params)), JSON.stringify(params)).rejects.toThrow(
        /check constraint/,
      );
    }
  });

  // Stage 1 (requests_marketplace_fields) columns: defaults for a new request; the form ones are writable since stage 3a.
  it("new requests get the marketplace defaults", async () => {
    const row = await as(db, verified, (tx) =>
      tx.query<Record<string, unknown>>(
        `insert into public.requests (title, delivery_city) values ('Vintage grinder', 'Pune')
          returning status, item_kind, item_condition, attributes, price_inr, reward_inr, published_at, expires_at`,
      ),
    );
    expect(row.rows[0]).toEqual({
      status: "draft", item_kind: "other", item_condition: "any", attributes: {}, price_inr: null, reward_inr: null, published_at: null, expires_at: null,
    });
  });

  it("stage 1 checks reject bad values (enforced even for the server)", async () => {
    for (const set of [
      `attributes = '[1]'`,
      `budget_amount = 5`,
      `item_kind = 'weapons'`,
      `status = 'published'`,
      `preview_image_url = 'javascript:alert(1)'`,
      `price_inr = 0`,
    ]) {
      await expect(db.query(`update public.requests set ${set} where id = $1`, [openRequestId]), set).rejects.toThrow(/check constraint/);
    }
  });
});

describe("offers", () => {
  // Stage 2: offers need a complete cost breakdown, a future arrival date and the lawful-import declaration.
  const offerSql = `insert into public.offers (request_id, service_fee_inr, message, product_price_amount, product_currency,
      fx_rate_to_inr, arrival_date, handoff_method, declares_lawful_import)
    values ($1, 1200, 'Flying in from Dubai', 899, 'AED', 22.75, current_date + 7, 'meet_in_person', true)
    returning traveller_id, status`;

  it("unverified users can't make an offer", async () => {
    await expect(as(db, unverified, (tx) => tx.query(offerSql, [openRequestId]))).rejects.toThrow(RLS);
  });

  it("verified travellers can offer on someone else's open request", async () => {
    const row = await as(db, verified2, async (tx) => (await tx.query(offerSql, [openRequestId])).rows[0]);
    expect(row).toEqual({ traveller_id: verified2, status: "pending" });
  });

  it("nobody can offer on their own request", async () => {
    await expect(as(db, verified, (tx) => tx.query(offerSql, [openRequestId]))).rejects.toThrow(RLS);
  });

  it("only one offer per traveller per request", async () => {
    await asAndKeep(db, bystander, (tx) => tx.query(offerSql, [openRequestId]));
    await expect(as(db, bystander, (tx) => tx.query(offerSql, [openRequestId]))).rejects.toThrow(/duplicate key/);
  });

  it("users can't set offer status or offer as someone else", async () => {
    await expect(
      as(db, verified2, (tx) =>
        tx.query("insert into public.offers (request_id, service_fee_inr, status) values ($1, 1, 'accepted')", [openRequestId]),
      ),
    ).rejects.toThrow(NO_PERMISSION);
    await expect(
      as(db, verified2, (tx) =>
        tx.query("insert into public.offers (request_id, traveller_id, service_fee_inr) values ($1, $2, 1)", [openRequestId, bystander]),
      ),
    ).rejects.toThrow(NO_PERMISSION);
  });

  it("offers are visible only to the traveller and the request owner", async () => {
    const seenBy = async (id: string) =>
      (await as(db, id, (tx) => tx.query("select id from public.offers where request_id = $1", [openRequestId]))).rows.length;
    expect(await seenBy(verified)).toBe(1); // owner sees the bystander's offer
    expect(await seenBy(bystander)).toBe(1); // traveller sees their own
    expect(await seenBy(verified2)).toBe(0); // another traveller sees nothing
    expect(await seenBy(unverified)).toBe(0);
    await expect(as(db, null, (tx) => tx.query("select * from public.offers"))).rejects.toThrow(NO_PERMISSION);
  });
});

describe("dev-only SMS hook (supabase/dev)", () => {
  it("is not created by the migrations", async () => {
    const { rows } = await db.query("select 1 from pg_proc where proname = 'dev_discard_sms'");
    expect(rows).toHaveLength(0);
  });

  it("returns {} for the auth service and can't be called by users", async () => {
    const { db: devDb } = await createLocalSupabase({ withDevHook: true });
    const event = JSON.stringify({ user: { id: "x" }, sms: { otp: "123456" } });
    const result = await devDb.transaction(async (tx) => {
      await tx.exec("set local role supabase_auth_admin");
      return (await tx.query<{ r: unknown }>("select public.dev_discard_sms($1::jsonb) as r", [event])).rows[0].r;
    });
    expect(result).toEqual({});
    await expect(as(devDb, null, (tx) => tx.query("select public.dev_discard_sms('{}')"))).rejects.toThrow(NO_PERMISSION);
    await expect(as(devDb, verified, (tx) => tx.query("select public.dev_discard_sms('{}')"))).rejects.toThrow(
      NO_PERMISSION,
    );
  });
});
