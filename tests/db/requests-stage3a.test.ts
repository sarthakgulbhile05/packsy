import { readFileSync } from "node:fs";
import type { Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asAndKeep, createLocalSupabase, createUser, type Db } from "./local-supabase";

// Stage 3a (applied to dev as 20261030070544). Behaviour tests run on every real migration, Stage 3a
// included, in an in-memory Postgres. The apply, probe and recovery tests replay it on the schema just before
// it, so those steps stay tested. Simulated: nothing here touches the Supabase project.

const STAGE3A = "20261030070544_requests_drafts_and_publish.sql";
const MIGRATION = readFileSync(`supabase/migrations/${STAGE3A}`, "utf8");
const PROBE = readFileSync("supabase/drafts/stage3a_requests_drafts_and_publish.probe.sql", "utf8");
const RECOVERY = readFileSync("supabase/drafts/stage3a_requests_drafts_and_publish.recovery.sql", "utf8");

const RLS = /row-level security/;
const NO_PERMISSION = /permission denied/;
const CHECK = /check constraint/;
const NOT_ALLOWED = /not found or not allowed/;

async function freshDb(skip: string[] = []) {
  const { db } = await createLocalSupabase({ skip });
  await db.exec(`create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text)`);
  return db;
}
/** The schema as it was just before Stage 3a: every migration except it. */
const beforeStage3a = () => freshDb([STAGE3A]);

const switchUser = (tx: Transaction, id: string) => tx.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
const istToday = async (target: Db) =>
  (await target.query<{ d: string }>(`select ((now() at time zone 'Asia/Kolkata')::date)::text d`)).rows[0].d;

let db: Db;
let buyer: string, stranger: string, unverified: string;

beforeAll(async () => {
  db = await freshDb();
  buyer = await createUser(db, { phoneVerified: true, name: "Buyer" });
  stranger = await createUser(db, { phoneVerified: true, name: "Traveller" });
  unverified = await createUser(db, { name: "Unverified" });
});

/** Creates a draft through the real policies and returns its id. */
async function draft(owner = buyer, columns = "title, delivery_city", values = "'Vintage coffee grinder', 'Pune'") {
  return (await asAndKeep(db, owner, (tx) =>
    tx.query<{ id: string }>(`insert into public.requests (${columns}) values (${values}) returning id`),
  )).rows[0].id;
}
const publish = (user: string | null, id: string) =>
  as(db, user, (tx) => tx.query<{ expires: string }>(`select public.publish_request($1)::text as expires`, [id]));
const publishAndKeep = (user: string, id: string) =>
  asAndKeep(db, user, (tx) => tx.query(`select public.publish_request($1)`, [id]));
const visible = async (user: string, id: string) =>
  (await as(db, user, (tx) => tx.query(`select 1 from public.requests where id = $1`, [id]))).rows.length === 1;
const row = async (id: string) =>
  (await db.query<Record<string, unknown>>(`select status, title, published_at, expires_at from public.requests where id = $1`, [id])).rows[0];

describe("stage 3a: an applied migration", () => {
  it("the migration file is byte-identical to the reviewed draft that was applied to dev", () => {
    expect(MIGRATION).toBe(readFileSync("supabase/drafts/stage3a_requests_drafts_and_publish.sql", "utf8"));
  });

  it("runs exactly once, as an ordinary migration, and the probe reports it applied", async () => {
    const { migrations } = await createLocalSupabase();
    expect(migrations.filter((f) => f.includes("requests_drafts_and_publish"))).toEqual([STAGE3A]);
    expect((await db.query<{ state: string }>(PROBE)).rows[0].state).toBe("applied");
  });
});

describe("stage 3a: drafts are private", () => {
  it("a new request is an undated draft that only its owner can see", async () => {
    const id = await draft();
    expect(await row(id)).toMatchObject({ status: "draft", published_at: null, expires_at: null });
    expect(await visible(buyer, id)).toBe(true);
    expect(await visible(stranger, id)).toBe(false);
    expect(await visible(unverified, id)).toBe(false);
    await expect(as(db, null, (tx) => tx.query(`select 1 from public.requests`))).rejects.toThrow(NO_PERMISSION);
  });

  it("a published, unexpired request is visible to every signed-in user, never to anonymous visitors", async () => {
    const id = await draft();
    await publishAndKeep(buyer, id);
    expect(await visible(stranger, id)).toBe(true);
    expect(await visible(unverified, id)).toBe(true);
    expect(await visible(buyer, id)).toBe(true);
    await expect(as(db, null, (tx) => tx.query(`select 1 from public.requests`))).rejects.toThrow(NO_PERMISSION);
  });

  it("an expired request is hidden from others but kept for its owner", async () => {
    const id = await draft();
    await publishAndKeep(buyer, id);
    await db.query(`update public.requests set published_at = now() - interval '31 days', expires_at = now() - interval '1 minute' where id = $1`, [id]);
    expect(await visible(stranger, id)).toBe(false);
    expect(await visible(buyer, id)).toBe(true);
  });

  it("other statuses (set by the server in later stages) are owner-only", async () => {
    for (const status of ["matched", "completed", "cancelled", "expired"]) {
      const id = await draft();
      await publishAndKeep(buyer, id);
      await db.query(`update public.requests set status = $2 where id = $1`, [id, status]);
      expect(await visible(stranger, id), status).toBe(false);
      expect(await visible(buyer, id), status).toBe(true);
    }
  });

  it("travellers can't offer on a draft, but can once it's published", async () => {
    const id = await draft();
    const offer = `insert into public.offers (request_id, service_fee_inr, product_price_amount, product_currency, fx_rate_to_inr,
      arrival_date, handoff_method, declares_lawful_import) values ($1, 500, 10, 'USD', 83, current_date + 3, 'meet_in_person', true)`;
    await expect(as(db, stranger, (tx) => tx.query(offer, [id]))).rejects.toThrow(RLS);
    await publishAndKeep(buyer, id);
    await expect(as(db, stranger, (tx) => tx.query(offer, [id]))).resolves.toBeDefined();
  });
});

describe("stage 3a: creating requests directly through the API", () => {
  it("accepts every field the request form fills in", async () => {
    const { rows } = await as(db, buyer, (tx) =>
      tx.query(`insert into public.requests (title, description, product_url, item_kind, attributes, item_condition, quantity,
          budget_amount, budget_currency, origin_preference, delivery_city, needed_by, notes, preview_image_url)
        values ('Camera', 'Mirrorless, body only', 'https://shop.example.com/cam', 'electronics', '{"brand":"Fuji"}', 'used_good', 2,
          1200.50, 'USD', 'Japan', 'Mumbai', current_date + 20, 'Box not needed', 'https://img.example.com/cam.jpg')
        returning status, shopper_id`),
    );
    expect(rows[0]).toEqual({ status: "draft", shopper_id: buyer });
  });

  it.each([
    ["status", "'open'"],
    ["shopper_id", "'00000000-0000-4000-8000-999999999999'"],
    ["published_at", "now()"],
    ["expires_at", "now() + interval '30 days'"],
    ["image_path", "'x/y/z.jpg'"],
    ["price_inr", "100"],
    ["reward_inr", "10"],
    ["listed_price_amount", "10"],
    ["created_at", "now()"],
    ["updated_at", "now()"],
    ["id", "gen_random_uuid()"],
  ])("can't set %s", async (column, value) => {
    await expect(as(db, buyer, (tx) => tx.query(`insert into public.requests (title, delivery_city, ${column}) values ('Camera', 'Pune', ${value})`)))
      .rejects.toThrow(NO_PERMISSION);
  });

  it("needs a verified phone, and a signed-in user", async () => {
    await expect(as(db, unverified, (tx) => tx.query(`insert into public.requests (title, delivery_city) values ('Camera', 'Pune')`))).rejects.toThrow(RLS);
    await expect(as(db, null, (tx) => tx.query(`insert into public.requests (title, delivery_city) values ('Camera', 'Pune')`))).rejects.toThrow(NO_PERMISSION);
  });

  it.each([
    ["title too short", "title", "'ab'"],
    ["title too long", "title", "repeat('a', 201)"],
    ["city too short", "delivery_city", "'P'"],
    ["city too long", "delivery_city", "repeat('a', 101)"],
    ["quantity 0", "quantity", "0"],
    ["quantity 11", "quantity", "11"],
    ["budget without currency", "budget_amount", "100"],
    ["currency without budget", "budget_currency", "'USD'"],
    ["zero budget", "budget_amount, budget_currency", "0, 'USD'"],
    ["huge budget", "budget_amount, budget_currency", "100000000, 'USD'"],
    ["unknown currency", "budget_amount, budget_currency", "10, 'BTC'"],
    ["unknown kind", "item_kind", "'weapons'"],
    ["unknown condition", "item_condition", "'broken'"],
    ["attributes not an object", "attributes", `'["a"]'`],
    ["attributes over 2 KB", "attributes", `jsonb_build_object('k', repeat('a', 3000))`],
    ["http product link", "product_url", "'http://shop.example.com'"],
    ["javascript link", "product_url", "'javascript:alert(1)'"],
    ["javascript preview image", "preview_image_url", "'javascript:alert(1)'"],
    ["description over 2000", "description", "repeat('a', 2001)"],
    ["notes over 1000", "notes", "repeat('a', 1001)"],
    ["origin over 120", "origin_preference", "repeat('a', 121)"],
  ])("rejects invalid data: %s", async (_name, column, value) => {
    const base: Record<string, string> = { title: "'Camera'", delivery_city: "'Pune'" };
    const cols = column.split(", ");
    const vals = value.startsWith("jsonb_") || value.startsWith("repeat") ? [value] : value.split(", ");
    cols.forEach((c, i) => (base[c] = vals[i]));
    const sql = `insert into public.requests (${Object.keys(base).join(", ")}) values (${Object.values(base).join(", ")})`;
    await expect(as(db, buyer, (tx) => tx.query(sql))).rejects.toThrow(CHECK);
  });
});

describe("stage 3a: editing and deleting", () => {
  const update = (user: string | null, id: string, set = "title = 'Edited title'") =>
    as(db, user, (tx) => tx.query(`update public.requests set ${set} where id = $1`, [id]));
  const remove = (user: string | null, id: string) => as(db, user, (tx) => tx.query(`delete from public.requests where id = $1`, [id]));

  it("owners can edit every form field of their own draft", async () => {
    const id = await draft();
    const result = await update(buyer, id, `title = 'New title', description = 'd', product_url = 'https://a.example.com', item_kind = 'home',
      attributes = '{"brand":"X"}', item_condition = 'new', quantity = 3, budget_amount = 5, budget_currency = 'EUR',
      origin_preference = 'EU', delivery_city = 'Goa', needed_by = current_date + 9, notes = 'n', preview_image_url = 'https://i.example.com/a.png'`);
    expect(result.affectedRows).toBe(1);
  });

  it("nobody else can edit or delete someone's draft (no error, nothing changes)", async () => {
    const id = await draft();
    for (const user of [stranger, unverified]) {
      expect((await update(user, id)).affectedRows).toBe(0);
      expect((await remove(user, id)).affectedRows).toBe(0);
    }
    expect(await row(id)).toMatchObject({ status: "draft", title: "Vintage coffee grinder" });
    await expect(update(null, id)).rejects.toThrow(NO_PERMISSION);
    await expect(remove(null, id)).rejects.toThrow(NO_PERMISSION);
  });

  it.each([
    ["status = 'open'"],
    [`shopper_id = '00000000-0000-4000-8000-999999999999'`],
    ["published_at = now()"],
    ["expires_at = now() + interval '1 day'"],
    ["image_path = 'a/b/c.jpg'"],
    ["price_inr = 1"],
    ["reward_inr = 1"],
    ["created_at = now()"],
    ["updated_at = now()"],
    ["listed_price_amount = 1"],
  ])("owners can't change protected fields: %s", async (set) => {
    const id = await draft();
    await expect(update(buyer, id, set)).rejects.toThrow(NO_PERMISSION);
  });

  it("published requests can't be edited or deleted by their owner through the API", async () => {
    const id = await draft();
    await publishAndKeep(buyer, id);
    expect((await update(buyer, id)).affectedRows).toBe(0);
    expect((await remove(buyer, id)).affectedRows).toBe(0);
    expect(await row(id)).toMatchObject({ status: "open", title: "Vintage coffee grinder" });
  });

  it("owners can delete their own draft", async () => {
    const id = await draft();
    expect((await remove(buyer, id)).affectedRows).toBe(1);
  });

  it("editing keeps the database's checks (invalid edits are refused)", async () => {
    const id = await draft();
    await expect(update(buyer, id, "quantity = 50")).rejects.toThrow(CHECK);
    await expect(update(buyer, id, "budget_amount = 5")).rejects.toThrow(CHECK);
  });
});

describe("stage 3a: publish_request()", () => {
  it("publishes the owner's draft for 30 days when there's no needed-by date", async () => {
    const id = await draft();
    await publishAndKeep(buyer, id);
    const { rows } = await db.query<{ status: string; ok: boolean }>(
      `select status, published_at between now() - interval '1 minute' and now()
         and expires_at = published_at + interval '30 days' as ok from public.requests where id = $1`, [id]);
    expect(rows[0]).toEqual({ status: "open", ok: true });
  });

  it("expires at the end of the needed-by day in India when that is sooner than 30 days", async () => {
    const id = await draft(buyer, "title, delivery_city, needed_by", "'Mug', 'Pune', current_date + 5");
    await publishAndKeep(buyer, id);
    const { rows } = await db.query<{ ok: boolean }>(
      `select expires_at = ((needed_by + 1)::timestamp at time zone 'Asia/Kolkata') as ok from public.requests where id = $1`, [id]);
    expect(rows[0].ok).toBe(true);
  });

  it("caps a far-off needed-by date at 30 days", async () => {
    const id = await draft(buyer, "title, delivery_city, needed_by", "'Mug', 'Pune', current_date + 90");
    await publishAndKeep(buyer, id);
    const { rows } = await db.query<{ ok: boolean }>(`select expires_at = published_at + interval '30 days' as ok from public.requests where id = $1`, [id]);
    expect(rows[0].ok).toBe(true);
  });

  it("a needed-by date of today (India) still publishes, until tonight", async () => {
    const today = await istToday(db);
    const id = await draft(buyer, "title, delivery_city, needed_by", `'Mug', 'Pune', '${today}'`);
    await expect(publishAndKeep(buyer, id)).resolves.toBeDefined();
  });

  it("refuses someone else's request, an unknown id and anonymous callers, without revealing which", async () => {
    const id = await draft();
    await expect(publish(stranger, id)).rejects.toThrow(NOT_ALLOWED);
    await expect(publish(unverified, id)).rejects.toThrow(NOT_ALLOWED);
    await expect(publish(buyer, "00000000-0000-4000-8000-999999999999")).rejects.toThrow(NOT_ALLOWED);
    await expect(publish(null, id)).rejects.toThrow(NO_PERMISSION);
    expect(await row(id)).toMatchObject({ status: "draft" });
  });

  it("refuses an owner whose phone is no longer verified", async () => {
    const owner = await createUser(db, { phoneVerified: true });
    const id = await draft(owner);
    await db.query(`update auth.users set phone_confirmed_at = null where id = $1`, [owner]);
    await expect(publish(owner, id)).rejects.toThrow(/Verify your phone/);
  });

  it("refuses to publish twice, or anything that isn't a draft", async () => {
    const id = await draft();
    await publishAndKeep(buyer, id);
    await expect(publish(buyer, id)).rejects.toThrow(/Only drafts/);
    await db.query(`update public.requests set status = 'cancelled' where id = $1`, [id]);
    await expect(publish(buyer, id)).rejects.toThrow(/Only drafts/);
  });

  it("refuses a needed-by date that has passed", async () => {
    const id = await draft(buyer, "title, delivery_city, needed_by", "'Mug', 'Pune', current_date - 2");
    await expect(publish(buyer, id)).rejects.toThrow(/needed-by date has passed/);
  });

  it("refuses a photo until image storage exists (stage 5)", async () => {
    const id = await draft();
    await db.query(`update public.requests set image_path = $2 where id = $1`, [id, `${buyer}/${id}/a.jpg`]);
    await expect(publish(buyer, id)).rejects.toThrow(/image storage/);
  });

  it("is security definer with a fixed search_path, and not callable by anonymous visitors", async () => {
    const { rows } = await db.query(`select prosecdef, proconfig, has_function_privilege('anon', oid, 'execute') anon,
        has_function_privilege('authenticated', oid, 'execute') authed
      from pg_proc where proname = 'publish_request'`);
    expect(rows).toEqual([{ prosecdef: true, proconfig: ["search_path=\"\""], anon: false, authed: true }]);
  });
});

// Every permission and policy on the public tables, so the comparison shows exactly what stage 3a changes.
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
    union all
    select 'function ' || p.oid::regprocedure || ' anon=' || has_function_privilege('anon', p.oid, 'execute')
        || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
      from pg_proc p where pronamespace = 'public'::regnamespace
    order by 1`);
  return rows.map((r) => r.line);
}

describe("stage 3a: permission changes", () => {
  it("changes exactly the intended grants, policies and functions; nothing on other tables", async () => {
    const target = await beforeStage3a();
    const old = await accessSnapshot(target);
    await target.exec(MIGRATION);
    const now = await accessSnapshot(target);
    const added = now.filter((l) => !old.includes(l));
    const removed = old.filter((l) => !now.includes(l));
    const formColumns = ["description", "item_kind", "attributes", "item_condition", "budget_amount", "budget_currency",
      "origin_preference", "needed_by", "notes", "preview_image_url"];
    const editable = [...formColumns, "title", "product_url", "quantity", "delivery_city"];
    expect(added.filter((l) => l.startsWith("grant")).sort()).toEqual([
      ...formColumns.map((c) => `grant requests authenticated INSERT(${c})`),
      ...editable.map((c) => `grant requests authenticated UPDATE(${c})`),
    ].sort());
    expect(added.filter((l) => l.startsWith("table"))).toEqual(["table requests authenticated DELETE"]);
    expect(added.filter((l) => l.startsWith("function"))).toEqual(["function publish_request(uuid) anon=false authenticated=true"]);
    expect(added.filter((l) => l.startsWith("policy")).map((l) => l.split(" ").slice(0, 2).join(" ") + " " + l.match(/ (SELECT|INSERT|UPDATE|DELETE) /)![1]).sort())
      .toEqual(["policy requests DELETE", "policy requests INSERT", "policy requests SELECT", "policy requests UPDATE"]);
    expect(removed.sort()).toEqual([
      "grant requests authenticated INSERT(price_inr)",
      "grant requests authenticated INSERT(reward_inr)",
      expect.stringMatching(/^policy requests Phone-verified users can create their own requests INSERT/),
      expect.stringMatching(/^policy requests Requests are visible to logged-in users SELECT true/),
    ]);
    expect([...added, ...removed].filter((l) => !/^(grant|table|policy) requests |^function publish_request/.test(l))).toEqual([]);
  });

  it("the deprecated price_inr and reward_inr stay unwritable, on insert and update", async () => {
    await expect(as(db, buyer, (tx) => tx.query(`insert into public.requests (title, delivery_city, price_inr) values ('A b c', 'Pune', 1)`))).rejects.toThrow(NO_PERMISSION);
    const id = await draft();
    await expect(as(db, buyer, (tx) => tx.query(`update public.requests set reward_inr = 1 where id = $1`, [id]))).rejects.toThrow(NO_PERMISSION);
  });
});

describe("stage 3a: apply and recovery procedure", () => {
  // Top-level statements of the migration: a line ending in ';' ends one, except inside a $$ … $$ body.
  const statements = (() => {
    const out = [""];
    let inBody = false;
    for (const line of MIGRATION.split("\n")) {
      out[out.length - 1] += line + "\n";
      if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inBody = !inBody;
      if (!inBody && /;\s*$/.test(line) && !line.trimStart().startsWith("--")) out.push("");
    }
    return out.filter((s) => s.replace(/--.*$/gm, "").trim());
  })();
  const N = 14;

  const shape = async (target: Db) =>
    (await target.query<{ s: string }>(`select concat_ws(' || ',
      (select string_agg(column_name || ' ' || coalesce(column_default, ''), ',' order by column_name)
         from information_schema.columns where table_schema = 'public' and table_name = 'requests'),
      (select string_agg(conname || pg_get_constraintdef(oid), ';' order by conname) from pg_constraint where conrelid = 'public.requests'::regclass),
      (select string_agg(polname || '=' || coalesce(obj_description(oid, 'pg_policy'), '-'), ',' order by polname) from pg_policy),
      (select string_agg(proname, ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace)
    ) s`)).rows[0].s + "\n" + (await accessSnapshot(target)).join("\n");
  const state = async (target: Db) => (await target.query<{ state: string }>(PROBE)).rows[0].state;

  it(`splits into the expected ${N} statements`, () => expect(statements).toHaveLength(N));

  for (let k = 0; k <= N; k++) {
    it(`stopping after ${k} statement(s): probe is right and recovery restores the exact original`, async () => {
      const target = await beforeStage3a();
      const original = await shape(target);
      for (const s of statements.slice(0, k)) await target.exec(s);
      expect(await state(target)).toBe(k === 0 ? "not applied" : k === N ? "applied" : "PARTIAL");
      await target.exec(RECOVERY);
      expect(await shape(target)).toBe(original);
      expect(await state(target)).toBe("not applied");
      await target.exec(MIGRATION);
      expect(await state(target)).toBe("applied");
    });
  }

  // What users can actually do after each statement. Today (0) every new request is immediately readable by
  // all signed-in users. No intermediate state may allow more than that, and each new ability (publish, rich
  // fields, edit, delete) may appear only once the rule that limits it already exists.
  async function abilitiesAfter(k: number) {
    const target = await beforeStage3a();
    const owner = await createUser(target, { phoneVerified: true });
    const other = await createUser(target, { phoneVerified: true });
    const unv = await createUser(target);
    for (const s of statements.slice(0, k)) await target.exec(s);
    const ok = (p: Promise<unknown>) => p.then(() => true, () => false);
    const rows = (p: Promise<{ affectedRows?: number }>) => p.then((r) => (r.affectedRows ?? 0) > 0, () => false);
    const create = (tx: Transaction, cols = "title, delivery_city", vals = "'Grinder', 'Pune'") =>
      tx.query<{ id: string }>(`insert into public.requests (${cols}) values (${vals}) returning id`).then((r) => r.rows[0].id);
    const can: string[] = [];
    if (await ok(as(target, owner, (tx) => create(tx)))) can.push("create");
    if (await ok(as(target, owner, (tx) => create(tx, "title, delivery_city, description", "'Grinder', 'Pune', 'Old'")))) can.push("create with details");
    if (await ok(as(target, owner, (tx) => create(tx, "title, delivery_city, price_inr", "'Grinder', 'Pune', 5")))) can.push("set price_inr");
    if (await ok(as(target, unv, (tx) => create(tx)))) can.push("unverified create");
    if (await ok(as(target, owner, (tx) => create(tx, "title, delivery_city, status", "'Grinder', 'Pune', 'open'")))) can.push("choose status");
    const strangerSees = await as(target, owner, async (tx) => {
      const id = await create(tx);
      await switchUser(tx, other);
      return (await tx.query(`select 1 from public.requests where id = $1`, [id])).rows.length > 0;
    }).catch(() => false);
    if (strangerSees) can.push("stranger reads new request");
    if (await ok(as(target, owner, async (tx) => tx.query(`select public.publish_request($1)`, [await create(tx)])))) can.push("publish");
    if (await ok(as(target, other, async (tx) => {
      const id = await create(tx);
      await switchUser(tx, owner);
      return tx.query(`select public.publish_request($1)`, [id]);
    }))) can.push("publish someone else's");
    if (await rows(as(target, owner, async (tx) => tx.query(`update public.requests set title = 'X y z' where id = $1`, [await create(tx)])))) can.push("edit own");
    if (await rows(as(target, owner, async (tx) => tx.query(`delete from public.requests where id = $1`, [await create(tx)])))) can.push("delete own");
    if (await rows(as(target, owner, async (tx) => {
      const id = await create(tx);
      await switchUser(tx, other);
      return tx.query(`update public.requests set title = 'X y z' where id = $1`, [id]);
    }))) can.push("edit someone else's");
    if (await ok(as(target, null, (tx) => tx.query(`select 1 from public.requests`)))) can.push("anon read");
    return can;
  }

  it("every intermediate state is no less restrictive than today; new abilities appear only after their rules", async () => {
    const results: string[] = [];
    for (let k = 0; k <= N; k++) results.push(`${k}: ${(await abilitiesAfter(k)).join(", ")}`);
    expect(results).toEqual([
      "0: create, set price_inr, stranger reads new request", // today
      "1: create, set price_inr, stranger reads new request", // drafts by default, but the old read rule still shows them: same as today
      "2: create, stranger reads new request", // deprecated fields closed
      "3: create", // drafts now private
      "4: create", // insert rule tightened
      "5: create", // edit rule exists, not yet granted
      "6: create", // delete rule exists, not yet granted
      "7: create, publish", // the function enforces its own checks from the moment it exists
      "8: create, publish",
      "9: create, publish",
      "10: create, create with details, publish", // form fields
      "11: create, create with details, publish, edit own",
      "12: create, create with details, publish, edit own, delete own",
      "13: create, create with details, publish, edit own, delete own",
      "14: create, create with details, publish, edit own, delete own",
    ]);
  }, 120_000); // builds 15 fresh databases

  it("a failure at the end of the whole file leaves 'not applied' (local Postgres)", async () => {
    const target = await beforeStage3a();
    await expect(target.exec(MIGRATION + "\nselect 1/0;")).rejects.toThrow();
    expect(await state(target)).toBe("not applied");
  });

  it("the migration itself refuses legacy open requests without dates, changing nothing", async () => {
    const target = await beforeStage3a();
    const u = await createUser(target, { phoneVerified: true });
    await target.query(`insert into public.requests (shopper_id, title, delivery_city) values ($1, 'Old', 'Pune')`, [u]);
    await expect(target.exec(statements[0])).rejects.toThrow(/requests_published_dates/);
    expect(await state(target)).toBe("not applied");
  });

  it("recovery refuses to run when requests exist", async () => {
    await expect(db.exec(RECOVERY)).rejects.toThrow(/has rows/);
    expect(await state(db)).toBe("applied");
  });
});
