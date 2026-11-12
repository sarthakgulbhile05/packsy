import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ALL_STATES,
  applyEvent,
  createTransaction,
  OUTCOMES,
  RULES,
  type Actor,
  type Transaction,
  type TransactionEventType,
} from "@/lib/payments/transaction";
import { createLocalSupabase, createUser, type Db } from "./local-supabase";

// Phase B draft (supabase/drafts/phaseb_transactions.sql), replayed on the full migration chain in an in-memory
// Postgres (PGlite). Simulated: nothing here touches a Supabase project, and the draft isn't applied anywhere.
// Every call goes through the entry point its role would really use, and every financial path runs in lockstep
// with the Phase A lifecycle, which stays the reference.

const DRAFT = readFileSync("supabase/drafts/phaseb_transactions.sql", "utf8");
const RECOVERY = readFileSync("supabase/drafts/phaseb_transactions.recovery.sql", "utf8");
const STUB = readFileSync("tests/db/phaseb-supabase-stub.sql", "utf8");
const BUCKET = "transaction-evidence";

let db: Db;
let buyer: string, traveller: string, stranger: string, admin: string, notAdmin: string;
let intoTrip: string, outTrip: string;
let today: string;
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Route = "into_india" | "out_of_india";
type Role = Actor["role"];

/** Runs as a database role (orbitly_webhook, orbitly_system, service_role, anon), and commits. */
const asRole = <T>(role: string, fn: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
/** Runs as a signed-in user, with Supabase-shaped claims (aal for multi-factor), and commits. */
const asUser = <T>(uid: string, fn: (tx: Tx) => Promise<T>, claims: Record<string, unknown> = {}) =>
  db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, aal: "aal1", ...claims })]);
    return fn(tx);
  });
/** As asUser / asRole, but always rolled back (for probing access). */
const probe = <T>(who: string | null, fn: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    if (who && /^[0-9a-f-]{36}$/.test(who)) {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [who]);
    } else await tx.exec(`set local role ${who ?? "anon"}`);
    const r = await fn(tx);
    await tx.rollback();
    return r;
  });
/** The error message, or "ok". The functions raise Phase A error codes as messages. */
const outcome = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as Error).message;
  }
};

// --- Building a real accepted offer, through the real policies and accept_offer. -----------------------------
async function acceptedOffer(route: Route) {
  const [from, to, trip] = route === "into_india" ? ["US", "IN", intoTrip] : ["IN", "GB", outTrip];
  const requestId = (await asUser(buyer, (tx) =>
    tx.query<{ id: string }>(`insert into public.requests (title, delivery_city, source_country, destination_country) values ('A product', 'Pune', $1, $2) returning id`, [from, to]),
  )).rows[0].id;
  await asUser(buyer, (tx) => tx.query(`select public.publish_request($1)`, [requestId]));
  const offerId = (await asUser(traveller, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.offers (request_id, trip_id, service_fee_inr, product_price_amount, product_currency, fx_rate_to_inr,
         arrival_date, handoff_method, declares_lawful_import, delivery_inr, other_costs_inr, customs_estimate_inr)
       values ($1, $2, 1800, 299, 'USD', 83.5, $3, 'meet_in_person', true, 250, 0, 1500) returning id`,
      [requestId, trip, day(5)],
    ),
  )).rows[0].id;
  return { requestId, offerId };
}
const accept = (offerId: string) => asUser(buyer, (tx) => tx.query(`select public.accept_offer($1)`, [offerId]));
const open = (offerId: string) => asRole("orbitly_system", (tx) => tx.query<{ id: string }>(`select private.open_transaction($1) id`, [offerId])).then((r) => r.rows[0].id);

const snap = async (txId: string) =>
  (await db.query<{ due: string; payout: string }>(
    `select s.buyer_total_minor::text due, s.net_reward_minor::text payout from public.transactions t join public.offer_pricing_snapshots s on s.offer_id = t.offer_id where t.id = $1`,
    [txId],
  )).rows[0];
const row = async (txId: string) =>
  (await db.query<{ state: string; version: number; chargeback: boolean; dispute_resolution: string | null }>(
    `select state, version, chargeback, dispute_resolution from public.transactions where id = $1`, [txId],
  )).rows[0];
const count = async (table: string, txId: string) =>
  (await db.query<{ n: number }>(`select count(*)::int n from public.${table} where transaction_id = $1`, [txId])).rows[0].n;
const ops = async (txId: string) =>
  (await db.query<{ s: string }>(`select kind || ':' || attempt || ':' || status s from public.transaction_operations where transaction_id = $1 order by kind, attempt`, [txId])).rows.map((r) => r.s);
const anomalies = async (where = "true", args: unknown[] = []) =>
  (await db.query<{ code: string; transaction_ref: string | null; provider_event_id: string }>(`select code, transaction_ref, provider_event_id from public.transaction_anomalies where ${where} order by id`, args)).rows;

/** Uploads a file into the evidence bucket as `owner`, the way the storage API would (owner_id from the session). */
async function upload(txId: string, owner: string, name = `receipt-${++seq}.jpg`, folderTx = txId) {
  const path = `transactions/${folderTx}/${name}`;
  await db.query(`insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)`, [BUCKET, path, owner]);
  return path;
}

let seq = 0;
type Extra = {
  evidence?: string[] | null; amount?: number | null; currency?: string | null; resolution?: string | null;
  providerEventId?: string; eventId?: string; version?: number | null; note?: string; actorId?: string;
  operationKey?: string | null; aal?: string; reason?: string;
};

const liveKey = async (txId: string, kind: string | undefined) =>
  kind
    ? (await db.query<{ k: string }>(`select idempotency_key k from public.transaction_operations where transaction_id = $1 and kind = $2 and status = 'started'`, [txId, kind])).rows[0]?.k ?? null
    : null;

/**
 * Sends one event through the entry point its role really uses. Provider facts that can't be applied come back as an
 * anomaly (recorded, not raised); this helper turns that into an error with the code, so tests can assert on it.
 */
async function dbApply(txId: string, type: TransactionEventType, role: Role, x: Extra = {}) {
  const eventId = x.eventId ?? `ev-${++seq}`;
  const version = async () => (x.version !== undefined ? x.version : (await row(txId))?.version ?? 0);
  if (role === "provider") {
    const s = await snap(txId);
    const amount = x.amount !== undefined ? x.amount : RULES[type].amount === "due" ? Number(s.due) : RULES[type].amount === "payout" ? Number(s.payout) : null;
    const key = x.operationKey !== undefined ? x.operationKey : await liveKey(txId, OUTCOMES[type]?.kind);
    const r = (await asRole("orbitly_webhook", (tx) =>
      tx.query<{ r: Record<string, unknown> }>(`select private.record_provider_event($1, $2, $3, $4, $5, $6) r`, [
        txId, type, x.providerEventId ?? `test:pe-${++seq}`, key, amount, x.currency !== undefined ? x.currency : amount ? "INR" : null,
      ]),
    )).rows[0].r;
    if (r.anomaly) throw new Error(String(r.anomaly));
    return r;
  }
  if (role === "system") {
    return (await asRole("orbitly_system", (tx) =>
      tx.query<{ r: Record<string, unknown> }>(`select private.record_system_event($1, $2, $3, $4) r`, [txId, type, eventId, x.version ?? null]),
    )).rows[0].r;
  }
  if (role === "admin") {
    const v = await version();
    return (await asUser(x.actorId ?? admin, (tx) =>
      tx.query<{ r: Record<string, unknown> }>(`select public.transaction_admin_act($1, $2, $3, $4, $5, $6) r`, [
        txId, type, eventId, v, x.reason ?? "Checked the order history and evidence.", x.resolution !== undefined ? x.resolution : type === "resolve_dispute" ? "pay_traveller" : null,
      ]), { aal: x.aal ?? "aal2" },
    )).rows[0].r;
  }
  const user = x.actorId ?? (role === "buyer" ? buyer : traveller);
  const evidence = x.evidence !== undefined ? x.evidence : RULES[type].evidence ? [await upload(txId, user)] : null;
  const v = await version();
  return (await asUser(user, (tx) =>
    tx.query<{ r: Record<string, unknown> }>(`select public.transaction_act($1, $2, $3, $4, $5, $6) r`, [txId, type, eventId, v, evidence, x.note ?? null]),
  )).rows[0].r;
}

/** An order with its Phase A twin. `step` applies the same event to both and requires the same outcome and state. */
async function pair(route: Route) {
  const { offerId } = await acceptedOffer(route);
  await accept(offerId);
  const id = await open(offerId);
  const s = await snap(id);
  let a: Transaction = createTransaction({
    id: "phase-a-twin", direction: route, buyerId: buyer, travellerId: traveller, pricingSnapshotId: offerId,
    currency: "INR", amountDueMinor: Number(s.due), payoutAmountMinor: Number(s.payout),
  });
  const actorFor = (role: Role): Actor => (role === "buyer" ? { role, userId: buyer } : role === "traveller" ? { role, userId: traveller } : { role });
  return {
    id,
    offerId,
    get a() {
      return a;
    },
    async step(type: TransactionEventType, role: Role, x: Extra = {}) {
      const amount = RULES[type].amount === "due" ? a.amountDueMinor : RULES[type].amount === "payout" ? a.payoutAmountMinor : undefined;
      const ra = applyEvent(a, {
        id: `a-${++seq}`, type, actor: actorFor(role), at: new Date().toISOString(),
        evidence: RULES[type].evidence ? ["receipt-1.jpg"] : undefined, amountMinor: amount, currency: amount ? "INR" : undefined,
        resolution: (x.resolution as "refund_buyer" | "pay_traveller" | undefined) ?? (type === "resolve_dispute" ? "pay_traveller" : undefined),
      });
      const rb = await outcome(dbApply(id, type, role, x));
      expect(rb, `${type} by ${role}: Phase A said ${ra.ok ? "ok" : ra.error}`).toBe(ra.ok ? "ok" : ra.error);
      if (ra.ok) a = ra.transaction;
      expect((await row(id)).state).toBe(a.state);
      return rb;
    },
  };
}
const HAPPY: [TransactionEventType, Role][] = [
  ["request_payment", "system"],
  ["payment_confirmed", "provider"],
  ["request_purchase", "system"],
  ["confirm_purchase", "traveller"],
  ["start_transit", "traveller"],
  ["arrive", "traveller"],
  ["record_delivery", "traveller"],
  ["request_buyer_confirmation", "system"],
  ["buyer_confirms_delivery", "buyer"],
  ["start_payout", "admin"],
  ["payout_completed", "provider"],
];
const walk = async (p: Awaited<ReturnType<typeof pair>>, steps: [TransactionEventType, Role, Extra?][]) => {
  for (const [t, r, x] of steps) expect(await p.step(t, r, x)).toBe("ok");
};
/** An order moved along with the given steps (each checked against Phase A). */
async function orderAt(steps: [TransactionEventType, Role, Extra?][], route: Route = "into_india") {
  const p = await pair(route);
  await walk(p, steps);
  return p.id;
}

beforeAll(async () => {
  ({ db } = await createLocalSupabase({ withStage4: true, withStage5a: true, withStage5b: true }));
  today = (await db.query<{ d: string }>(`select current_date::text d`)).rows[0].d;
  buyer = await createUser(db, { phoneVerified: true });
  traveller = await createUser(db, { phoneVerified: true });
  stranger = await createUser(db, { phoneVerified: true });
  admin = await createUser(db);
  notAdmin = await createUser(db);
  const trip = (from: string, to: string) =>
    asUser(traveller, (tx) =>
      tx.query<{ id: string }>(`insert into public.trips (departure_country, destination_country, departure_date, arrival_date) values ($1, $2, $3, $4) returning id`, [from, to, day(1), day(5)]),
    ).then((r) => r.rows[0].id);
  intoTrip = await trip("US", "IN");
  outTrip = await trip("IN", "GB");
  await db.exec(STUB);
  await db.exec(DRAFT);
  await db.query(`insert into private.transaction_admins (user_id, note) values ($1, 'test reviewer')`, [admin]);
});

describe("isolation and the draft itself", () => {
  it("runs only in an in-memory Postgres with no server, file or network behind it", async () => {
    expect(db).toBeInstanceOf(PGlite);
    expect(db.dataDir).toBeUndefined();
    const info = (await db.query<{ addr: string | null; port: number | null; v: string }>(`select inet_server_addr()::text addr, inet_server_port() port, version() v`)).rows[0];
    expect(info.addr).toBeNull();
    expect(info.port).toBeNull();
    expect(info.v).toMatch(/PGlite .* wasm32/);
  });

  it("is a draft, outside supabase/migrations, marked unapplied and blocked on P0", () => {
    expect(readdirSync("supabase/migrations").filter((f) => /phase.?b|transaction/i.test(f))).toEqual([]);
    for (const f of [DRAFT, RECOVERY]) expect(f).toContain("THIS MIGRATION HAS NOT BEEN APPLIED TO ANY REMOTE DATABASE. REAL PAYMENTS ARE DISABLED.");
    expect(DRAFT).toContain("DO NOT APPLY: P0 OPEN");
    // No CASCADE in any statement (comments may mention it), so nothing outside Phase B can go with it.
    expect((DRAFT + RECOVERY).replace(/--.*$/gm, "")).not.toMatch(/\bcascade\b/i);
  });

  it("grants nothing to the service role", () => {
    const sql = DRAFT.replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/grant [^;]*to [^;]*service_role/i);
  });

  it("applies cleanly on the full chain; the recovery removes it in one transaction, only while nothing exists", async () => {
    const { db: fresh } = await createLocalSupabase({ withStage4: true, withStage5a: true, withStage5b: true });
    await fresh.exec(STUB);
    const objects = `select (select count(*)::int from pg_tables where tablename like 'transaction%') tables,
      (select count(*)::int from pg_roles where rolname like 'orbitly_%') roles,
      (select count(*)::int from storage.buckets where id = '${BUCKET}') buckets,
      (select count(*)::int from pg_policies where schemaname = 'storage') storage_policies`;
    await fresh.exec(DRAFT);
    expect((await fresh.query(objects)).rows[0]).toEqual({ tables: 6, roles: 2, buckets: 1, storage_policies: 2 });
    // A login still holding one of the roles: refused, and nothing is removed (one transaction).
    await fresh.exec(`create role webhook_login nologin; grant orbitly_webhook to webhook_login;`);
    expect(await outcome(fresh.exec(RECOVERY))).toMatch(/still a member/);
    await fresh.exec(`rollback;`).catch(() => {});
    expect((await fresh.query(objects)).rows[0]).toEqual({ tables: 6, roles: 2, buckets: 1, storage_policies: 2 });
    await fresh.exec(`revoke orbitly_webhook from webhook_login; drop role webhook_login;`);
    await fresh.exec(RECOVERY);
    expect((await fresh.query(objects)).rows[0]).toEqual({ tables: 0, roles: 0, buckets: 0, storage_policies: 0 });
    expect((await fresh.query(`select to_regclass('public.offer_pricing_snapshots')::text t, to_regnamespace('private')::text p`)).rows[0]).toEqual({ t: "offer_pricing_snapshots", p: "private" });
    await fresh.exec(DRAFT);
    // With records present, the recovery refuses and changes nothing.
    await orderAt([]);
    expect(await outcome(db.exec(RECOVERY))).toMatch(/transaction records exist/);
    await db.exec(`rollback;`).catch(() => {});
    expect((await db.query(`select to_regclass('public.transactions')::text t`)).rows[0]).toEqual({ t: "transactions" });
  });

  it("holds exactly the Phase A rules and outcomes", async () => {
    const rows = (await db.query<{ event_type: string; from_states: string[]; to_state: string; roles: string[]; needs_evidence: boolean; amount_kind: string | null; outcome_kind: string | null; outcome_success: boolean | null }>(
      `select * from private.transaction_rules`,
    )).rows;
    const fromDb = Object.fromEntries(rows.map((r) => [r.event_type, { from: [...r.from_states].sort(), to: r.to_state, roles: [...r.roles].sort(), evidence: r.needs_evidence, amount: r.amount_kind, outcome: r.outcome_kind ? { kind: r.outcome_kind, success: r.outcome_success } : null }]));
    const fromA = Object.fromEntries(
      Object.entries(RULES).map(([t, r]) => [t, { from: [...r.from].sort(), to: r.to, roles: [...r.roles].sort(), evidence: !!r.evidence, amount: r.amount ?? null, outcome: OUTCOMES[t as TransactionEventType] ?? null }]),
    );
    expect(fromDb).toEqual(fromA);
  });

  it("allows exactly the Phase A states", async () => {
    const def = (await db.query<{ d: string }>(
      `select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.transactions'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%OFFER_ACCEPTED%'`,
    )).rows[0].d;
    expect([...def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...ALL_STATES].sort());
  });

  it("stores no money amounts on the order: the immutable snapshot is the only source", async () => {
    const cols = (await db.query<{ c: string }>(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = 'transactions'`)).rows.map((r) => r.c);
    expect(cols.filter((c) => /amount|minor|total|fee|reward|price/.test(c))).toEqual([]);
    const id = await orderAt([]);
    const offer = (await db.query<{ offer_id: string }>(`select offer_id from public.transactions where id = $1`, [id])).rows[0].offer_id;
    expect(await outcome(db.query(`update public.offer_pricing_snapshots set buyer_total_minor = 1 where offer_id = $1`, [offer]))).toMatch(/can't be changed/);
  });
});

describe("creating an order", () => {
  it.each(["into_india", "out_of_india"] as const)("%s: one order per accepted offer, with parties and direction taken from the records", async (route) => {
    const { offerId, requestId } = await acceptedOffer(route);
    await accept(offerId);
    const id = await open(offerId);
    expect(await open(offerId)).toBe(id);
    const t = (await db.query(`select request_id, buyer_id, traveller_id, direction, state, version, currency from public.transactions where id = $1`, [id])).rows[0];
    expect(t).toEqual({ request_id: requestId, buyer_id: buyer, traveller_id: traveller, direction: route, state: "OFFER_ACCEPTED", version: 0, currency: "INR" });
  });

  it("refuses an offer that hasn't been accepted, or doesn't exist", async () => {
    const { offerId } = await acceptedOffer("into_india");
    expect(await outcome(open(offerId))).toBe("offer_not_accepted");
    expect(await outcome(open("00000000-0000-4000-8000-00000000dead"))).toBe("offer_not_accepted");
  });

  it("only the system path can create one; no direct inserts by anyone", async () => {
    const { offerId, requestId } = await acceptedOffer("into_india");
    await accept(offerId);
    for (const who of ["service_role", "orbitly_webhook", "anon", buyer])
      expect(await outcome(probe(who, (tx) => tx.query(`select private.open_transaction($1)`, [offerId]))), who).toMatch(/permission denied/);
    const insert = `insert into public.transactions (offer_id, request_id, buyer_id, traveller_id, direction) values ($1, $2, $3, $4, 'into_india')`;
    for (const who of ["service_role", "orbitly_system", buyer]) expect(await outcome(probe(who, (tx) => tx.query(insert, [offerId, requestId, buyer, traveller]))), who).toMatch(/permission denied/);
    const { offerId: pending, requestId: pendingReq } = await acceptedOffer("into_india");
    expect(await outcome(db.query(insert, [pending, pendingReq, buyer, traveller]))).toMatch(/foreign key/);
    expect(await outcome(db.query(`insert into public.transactions (offer_id, request_id, buyer_id, traveller_id, direction, state) values ($1, $2, $3, $4, 'into_india', 'PAYOUT_ELIGIBLE')`, [offerId, requestId, buyer, traveller]))).toMatch(/starts at OFFER_ACCEPTED/);
    expect(await outcome(db.query(insert, [offerId, requestId, buyer, buyer]))).toMatch(/transactions_two_parties/);
  });
});

describe("the lifecycle, step for step with Phase A", () => {
  it.each(["into_india", "out_of_india"] as const)("%s: the main path, with every event, attempt and operation recorded", async (route) => {
    const p = await pair(route);
    await walk(p, HAPPY);
    expect(await row(p.id)).toMatchObject({ state: "PAYOUT_COMPLETED", version: 11 });
    const events = (await db.query<{ seq: number; from_state: string; to_state: string; operation_key: string | null; event_type: string }>(`select seq, from_state, to_state, operation_key, event_type from public.transaction_events where transaction_id = $1 order by seq`, [p.id])).rows;
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect([events[0].from_state, ...events.map((e) => e.to_state)]).toEqual([p.a.history[0].from, ...p.a.history.map((e) => e.to)]);
    // Every attempt is traceable from the history: the event that started it and the provider answer that settled it.
    expect(events.filter((e) => e.operation_key).map((e) => `${e.event_type}=${e.operation_key!.split(":").slice(0, 2).join(":")}:${e.operation_key!.split(":")[3]}`)).toEqual([
      "request_payment=orbitly:payment:1", "payment_confirmed=orbitly:payment:1", "start_payout=orbitly:payout:1", "payout_completed=orbitly:payout:1",
    ]);
    const s = await snap(p.id);
    const opsRows = (await db.query(`select kind, attempt, status, amount_minor::text amount from public.transaction_operations where transaction_id = $1 order by created_at`, [p.id])).rows;
    // P0 OPEN: the payout is still the net reward only (docs/payments/financial-flow.md).
    expect(opsRows).toEqual([
      { kind: "payment", attempt: 1, status: "succeeded", amount: s.due },
      { kind: "payout", attempt: 1, status: "succeeded", amount: s.payout },
    ]);
  });

  it.each(["into_india", "out_of_india"] as const)("%s: a problem in transit, reviewed and refunded", async (route) => {
    const p = await pair(route);
    await walk(p, [...HAPPY.slice(0, 5), ["open_dispute", "buyer"], ["review_dispute", "admin"], ["resolve_dispute", "admin", { resolution: "refund_buyer" }], ["initiate_refund", "admin"], ["refund_completed", "provider"]]);
    expect(await row(p.id)).toMatchObject({ state: "REFUNDED", dispute_resolution: "refund_buyer" });
  });

  it("a failed payment and a failed payout are each retried as a new attempt", async () => {
    const p = await pair("into_india");
    await walk(p, [["request_payment", "system"], ["payment_failed", "provider"], ["retry_payment", "system"], ...HAPPY.slice(1, 10), ["payout_failed", "provider"], ["start_payout", "admin"], ["payout_completed", "provider"]]);
    expect(await ops(p.id)).toEqual(["payment:1:failed", "payment:2:succeeded", "payout:1:failed", "payout:2:succeeded"]);
  });

  it("a payout stuck in review can't be approved or refunded again", async () => {
    const p = await pair("into_india");
    await walk(p, [...HAPPY.slice(0, 10), ["require_manual_review", "admin"]]);
    expect(await p.step("approve_payout", "admin")).toBe("duplicate_payout");
    expect(await p.step("initiate_refund", "admin")).toBe("duplicate_payout");
  });

  it("a chargeback after a completed payout goes to review and blocks any further payout or refund", async () => {
    const p = await pair("out_of_india");
    await walk(p, [...HAPPY, ["chargeback", "provider"]]);
    expect(await row(p.id)).toMatchObject({ state: "MANUAL_REVIEW_REQUIRED", chargeback: true });
    expect(await p.step("approve_payout", "admin")).toBe("blocked_by_chargeback");
    expect(await p.step("initiate_refund", "admin")).toBe("blocked_by_chargeback");
  });

  it("the dispute's outcome decides which way money can move", async () => {
    const toRefund = await pair("into_india");
    await walk(toRefund, [...HAPPY.slice(0, 2), ["open_dispute", "traveller"], ["review_dispute", "admin"], ["resolve_dispute", "admin", { resolution: "refund_buyer" }]]);
    expect(await toRefund.step("approve_payout", "admin")).toBe("blocked_by_dispute");
    const toPayout = await pair("into_india");
    await walk(toPayout, [...HAPPY.slice(0, 2), ["open_dispute", "buyer"], ["review_dispute", "admin"], ["resolve_dispute", "admin", { resolution: "pay_traveller" }]]);
    expect(await toPayout.step("initiate_refund", "admin")).toBe("blocked_by_dispute");
    expect(await toPayout.step("approve_payout", "admin")).toBe("ok");
  });

  it("while a dispute is open, nothing that moves money can start", async () => {
    const p = await pair("into_india");
    await walk(p, [...HAPPY.slice(0, 9), ["open_dispute", "buyer"]]);
    for (const [t, r] of [["start_payout", "admin"], ["approve_payout", "admin"], ["initiate_refund", "admin"]] as const) expect(await p.step(t, r)).toBe("invalid_transition");
  });

  it("a traveller who can't buy, and a buyer who doesn't answer, both go to a person", async () => {
    const a = await pair("into_india");
    await walk(a, [...HAPPY.slice(0, 3), ["report_cannot_purchase", "traveller"]]);
    const b = await pair("out_of_india");
    await walk(b, [...HAPPY.slice(0, 8), ["flag_no_buyer_response", "system"]]);
    expect([(await row(a.id)).state, (await row(b.id)).state]).toEqual(["MANUAL_REVIEW_REQUIRED", "MANUAL_REVIEW_REQUIRED"]);
  });

  it("stricter than Phase A, by design: no refund or payout for an order whose payment was never captured", async () => {
    const id = await orderAt([["request_payment", "system"], ["require_manual_review", "admin"]]);
    expect(await outcome(dbApply(id, "initiate_refund", "admin"))).toBe("payment_not_captured");
    expect(await outcome(dbApply(id, "approve_payout", "admin"))).toBe("payment_not_captured");
  });
});

describe("provider outcomes are never dropped (P1-1)", () => {
  it.each(["into_india", "out_of_india"] as const)("%s: a payment captured after the buyer cancelled is recorded and sent to review", async (route) => {
    const p = await pair(route);
    await walk(p, [["request_payment", "system"], ["cancel_payment", "buyer"]]);
    expect(await ops(p.id)).toEqual(["payment:1:started"]); // the buyer's cancel doesn't close the attempt
    await walk(p, [["payment_confirmed", "provider"]]);
    expect(await row(p.id)).toMatchObject({ state: "MANUAL_REVIEW_REQUIRED" });
    expect(await ops(p.id)).toEqual(["payment:1:succeeded"]);
    expect((await db.query(`select from_state, to_state, unexpected from public.transaction_events where transaction_id = $1 and event_type = 'payment_confirmed'`, [p.id])).rows).toEqual([
      { from_state: "PAYMENT_CANCELLED", to_state: "MANUAL_REVIEW_REQUIRED", unexpected: true },
    ]);
  });

  it("while that attempt is open, no new attempt and no cancellation (no double charge)", async () => {
    const p = await pair("into_india");
    await walk(p, [["request_payment", "system"], ["cancel_payment", "buyer"]]);
    expect(await p.step("retry_payment", "system")).toBe("payment_attempt_open");
    expect(await p.step("cancel_order", "buyer")).toBe("payment_attempt_open");
    // The provider confirms the cancellation: the attempt closes, the order stays cancelled, and a retry may start.
    await walk(p, [["cancel_payment", "provider"], ["retry_payment", "system"]]);
    expect(await ops(p.id)).toEqual(["payment:1:failed", "payment:2:started"]);
  });

  it("a payout confirmed while the order is in review is recorded, and can't be started again", async () => {
    const p = await pair("into_india");
    await walk(p, [...HAPPY.slice(0, 10), ["require_manual_review", "admin"], ["payout_completed", "provider"]]);
    expect(await ops(p.id)).toEqual(["payment:1:succeeded", "payout:1:succeeded"]);
    expect(await p.step("approve_payout", "admin")).toBe("duplicate_payout");
  });

  it("a payout failure during review closes the attempt and leaves the order in review", async () => {
    const p = await pair("into_india");
    await walk(p, [...HAPPY.slice(0, 10), ["require_manual_review", "admin"], ["payout_failed", "provider"]]);
    expect(await row(p.id)).toMatchObject({ state: "MANUAL_REVIEW_REQUIRED" });
    expect(await ops(p.id)).toEqual(["payment:1:succeeded", "payout:1:failed"]);
    expect(await p.step("approve_payout", "admin")).toBe("ok");
  });

  it("a second confirmation for a settled attempt is refused and kept as an anomaly, not applied twice", async () => {
    const p = await pair("into_india");
    await walk(p, HAPPY.slice(0, 2));
    const key = `orbitly:payment:${p.id}:1`;
    expect(await outcome(dbApply(p.id, "payment_confirmed", "provider", { operationKey: key, providerEventId: "test:second-capture" }))).toBe("operation_missing");
    expect(await ops(p.id)).toEqual(["payment:1:succeeded"]);
    expect(await anomalies(`provider_event_id = 'test:second-capture'`)).toEqual([{ code: "operation_missing", transaction_ref: p.id, provider_event_id: "test:second-capture" }]);
  });

  it("an unexpected success still has to match the amount (kept as an anomaly if not)", async () => {
    const id = await orderAt([["request_payment", "system"], ["cancel_payment", "buyer"]]);
    expect(await outcome(dbApply(id, "payment_confirmed", "provider", { amount: 1, providerEventId: "test:wrong-amount" }))).toBe("amount_mismatch");
    expect(await ops(id)).toEqual(["payment:1:started"]);
    expect((await anomalies(`provider_event_id = 'test:wrong-amount'`))[0].code).toBe("amount_mismatch");
  });

  it("a late answer for an earlier attempt never settles the current one", async () => {
    const id = await orderAt([...HAPPY.slice(0, 10), ["payout_failed", "provider"], ["start_payout", "admin"]]);
    for (const [type, key] of [["payout_failed", `orbitly:payout:${id}:1`], ["payout_completed", `orbitly:payout:${id}:1`], ["payout_completed", null]] as const)
      expect(await outcome(dbApply(id, type, "provider", { operationKey: key }))).toBe("operation_mismatch");
    expect(await row(id)).toMatchObject({ state: "PAYOUT_PROCESSING", version: 12 });
    expect(await ops(id)).toEqual(["payment:1:succeeded", "payout:1:failed", "payout:2:started"]);
    expect(await outcome(dbApply(id, "payout_completed", "provider", { operationKey: `orbitly:payout:${id}:2` }))).toBe("ok");
  });
});

describe("narrow entry points (P1-2)", () => {
  let id: string;
  beforeAll(async () => {
    id = await orderAt(HAPPY.slice(0, 2));
  });

  it("the service role can call nothing and touch nothing", async () => {
    for (const sql of [
      `select private.apply_transaction_event($1, 'request_purchase', 'x', 'system')`,
      `select private.record_system_event($1, 'request_purchase', 'x')`,
      `select private.record_provider_event($1, 'chargeback', 'test:x')`,
      `select public.transaction_act($1, 'cancel_order', 'x', 0)`,
      `select public.transaction_admin_act($1, 'require_manual_review', 'x', 0, 'A reason long enough')`,
      `select id from public.transactions where id = $1`,
    ])
      expect(await outcome(probe("service_role", (tx) => tx.query(sql, [id]))), sql).toMatch(/permission denied/);
  });

  it("the webhook role can only record provider events; the system role only system events and new orders", async () => {
    expect(await outcome(probe("orbitly_webhook", (tx) => tx.query(`select private.record_system_event($1, 'request_purchase', 'x')`, [id])))).toMatch(/permission denied/);
    expect(await outcome(probe("orbitly_webhook", (tx) => tx.query(`select private.apply_transaction_event($1, 'request_purchase', 'x', 'system')`, [id])))).toMatch(/permission denied/);
    expect(await outcome(probe("orbitly_system", (tx) => tx.query(`select private.record_provider_event($1, 'chargeback', 'test:x')`, [id])))).toMatch(/permission denied/);
    expect(await outcome(probe("orbitly_system", (tx) => tx.query(`select private.apply_transaction_event($1, 'request_purchase', 'x', 'admin', $2)`, [id, admin])))).toMatch(/permission denied/);
    for (const role of ["orbitly_webhook", "orbitly_system"])
      for (const t of ["transactions", "transaction_events", "transaction_operations", "transaction_anomalies"])
        expect(await outcome(probe(role, (tx) => tx.query(`select 1 from public.${t}`))), `${role} ${t}`).toMatch(/permission denied/);
  });

  it("each path can only take its own role's steps", async () => {
    expect(await outcome(dbApply(id, "start_payout", "system"))).toBe("role_not_allowed");
    expect(await outcome(dbApply(id, "payment_confirmed", "system"))).toBe("role_not_allowed");
    // A provider path asked to do a system step: refused, and kept as an anomaly (an adapter bug worth seeing).
    expect(await outcome(dbApply(id, "request_purchase", "provider", { providerEventId: "test:not-a-provider-step" }))).toBe("role_not_allowed");
    expect((await anomalies(`provider_event_id = 'test:not-a-provider-step'`))[0].code).toBe("role_not_allowed");
    expect((await row(id)).state).toBe("PAYMENT_CONFIRMED");
  });

  it("admins: identity from their own session, membership, multi-factor sign-in and a written reason", async () => {
    const id2 = await orderAt(HAPPY.slice(0, 2));
    expect(await outcome(dbApply(id2, "require_manual_review", "admin", { actorId: notAdmin }))).toBe("not_an_admin");
    expect(await outcome(dbApply(id2, "require_manual_review", "admin", { actorId: buyer }))).toBe("not_an_admin");
    expect(await outcome(dbApply(id2, "require_manual_review", "admin", { aal: "aal1" }))).toBe("mfa_required");
    expect(await outcome(dbApply(id2, "require_manual_review", "admin", { reason: "ok" }))).toBe("reason_required");
    expect(await outcome(dbApply(id2, "require_manual_review", "admin", { version: 1 }))).toBe("version_conflict");
    expect((await row(id2)).state).toBe("PAYMENT_CONFIRMED");
    await dbApply(id2, "require_manual_review", "admin", { reason: "Buyer emailed about a duplicate charge." });
    const ev = (await db.query(`select actor_role, actor_id, note from public.transaction_events where transaction_id = $1 order by seq desc limit 1`, [id2])).rows[0];
    expect(ev).toEqual({ actor_role: "admin", actor_id: admin, note: "Buyer emailed about a duplicate charge." });
    // The reviewer's identity and reason stay hidden from the order's parties.
    for (const col of ["actor_id", "note"]) expect(await outcome(probe(buyer, (tx) => tx.query(`select ${col} from public.transaction_events`)))).toMatch(/permission denied/);
  });

  it("provider event ids are namespaced, and only provider events carry one", async () => {
    expect(await outcome(dbApply(id, "chargeback", "provider", { providerEventId: "evt_123" }))).toMatch(/provider_event_required/);
    expect(await outcome(dbApply(id, "chargeback", "provider", { providerEventId: "Razorpay:evt 1" }))).toMatch(/provider_event_required/);
    expect(await outcome(db.query(`select private.apply_transaction_event($1, 'request_purchase', 'sys-1', 'system', p_provider_event_id => 'test:smuggled')`, [id]))).toBe("provider_event_required");
    expect(await outcome(db.query(
      `insert into public.transaction_events (transaction_id, seq, event_id, event_type, from_state, to_state, actor_role, provider_event_id) values ($1, 99, 'forged', 'request_purchase', 'PAYMENT_CONFIRMED', 'TRAVELLER_PURCHASE_PENDING', 'system', 'test:forged')`, [id],
    ))).toMatch(/transaction_events_provider_cited/);
  });

  it("a buyer or traveller can't be named by anyone else: the internal check still holds", async () => {
    expect(await outcome(db.query(`select private.apply_transaction_event($1, 'open_dispute', 'np-1', 'buyer', $2)`, [id, stranger]))).toBe("not_a_party");
    expect(await outcome(db.query(`select private.apply_transaction_event($1, 'open_dispute', 'np-2', 'traveller', $2)`, [id, buyer]))).toBe("not_a_party");
  });
});

describe("refusals change nothing", () => {
  const unchanged = async (id: string, fn: () => Promise<unknown>, error: string | RegExp) => {
    const before = [await row(id), await count("transaction_events", id), await count("transaction_operations", id)];
    const r = await outcome(fn());
    if (typeof error === "string") expect(r).toBe(error);
    else expect(r).toMatch(error);
    expect([await row(id), await count("transaction_events", id), await count("transaction_operations", id)]).toEqual(before);
  };

  it("invalid steps, unknown events, the wrong role and strangers", async () => {
    const id = await orderAt([]);
    await unchanged(id, () => dbApply(id, "payment_confirmed", "provider"), "operation_missing");
    await unchanged(id, () => dbApply(id, "request_purchase", "system"), "invalid_transition");
    await unchanged(id, () => dbApply(id, "release_funds" as TransactionEventType, "system"), "unknown_event");
    await unchanged(id, () => dbApply(id, "request_payment", "buyer"), "role_not_allowed");
    await unchanged(id, () => dbApply(id, "cancel_order", "buyer", { actorId: stranger }), "transaction_not_found");
    await unchanged(id, () => dbApply(id, "request_payment", "system", { eventId: " " }), "invalid_event");
  });

  it("missing evidence", async () => {
    const id = await orderAt(HAPPY.slice(0, 3));
    for (const evidence of [null, [], ["", "  "]]) await unchanged(id, () => dbApply(id, "confirm_purchase", "traveller", { evidence }), "evidence_required");
  });

  it("a dispute resolution without an outcome", async () => {
    const id = await orderAt([...HAPPY.slice(0, 2), ["open_dispute", "buyer"], ["review_dispute", "admin"]]);
    for (const resolution of [null, "split"]) await unchanged(id, () => dbApply(id, "resolve_dispute", "admin", { resolution }), "resolution_required");
  });

  it("a stale version", async () => {
    const id = await orderAt(HAPPY.slice(0, 2));
    await unchanged(id, () => dbApply(id, "request_purchase", "system", { version: 1 }), "version_conflict");
    await unchanged(id, () => dbApply(id, "open_dispute", "buyer", { version: 1 }), "version_conflict");
    expect(await outcome(dbApply(id, "request_purchase", "system", { version: 2 }))).toBe("ok");
  });
});

describe("evidence belongs to its order (P1-3)", () => {
  let id: string, other: string;
  beforeAll(async () => {
    id = await orderAt(HAPPY.slice(0, 3));
    other = await orderAt(HAPPY.slice(0, 3));
  });

  it("only a file the traveller uploaded into this order's folder is accepted", async () => {
    const theirs = await upload(other, traveller); // the same traveller, but another order's folder
    const buyers = await upload(id, buyer); // this order's folder, but uploaded by the buyer
    const never = `transactions/${id}/never-uploaded.jpg`;
    for (const bad of [[theirs], [buyers], [never], ["javascript:alert(1)"], [`https://evil.example/transactions/${id}/r.jpg`],
      [`transactions/${id}/../${other}/r.jpg`], [`transactions/${id}/<img src=x>`], [`/transactions/${id}/r.jpg`], [`transactions/${id}/sub/r.jpg`]])
      expect(await outcome(dbApply(id, "confirm_purchase", "traveller", { evidence: bad })), bad.join(",")).toBe("invalid_evidence");
    const mixed = [await upload(id, traveller), theirs];
    expect(await outcome(dbApply(id, "confirm_purchase", "traveller", { evidence: mixed }))).toBe("invalid_evidence");
    expect((await row(id)).state).toBe("TRAVELLER_PURCHASE_PENDING");
    expect(await outcome(dbApply(id, "confirm_purchase", "traveller", { evidence: [await upload(id, traveller, "receipt_01.jpg")] }))).toBe("ok");
  });

  it("storage: each side reads only its own order's files, and uploads only into its own order, as itself", async () => {
    const mine = await upload(id, traveller, "photo-a.jpg");
    const read = (who: string, path: string) => probe(who, (tx) => tx.query(`select name from storage.objects where name = $1`, [path])).then((r) => r.rows.length);
    expect([await read(buyer, mine), await read(traveller, mine), await read(stranger, mine)]).toEqual([1, 1, 0]);
    const loner = await createUser(db, { phoneVerified: true });
    expect(await read(loner, mine)).toBe(0);
    const put = (who: string, path: string, owner = who) => probe(who, (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)`, [BUCKET, path, owner]));
    expect(await outcome(put(traveller, `transactions/${id}/new.jpg`))).toBe("ok");
    expect(await outcome(put(stranger, `transactions/${id}/new.jpg`))).toMatch(/row-level security/);
    expect(await outcome(put(traveller, `transactions/${id}/spoof.jpg`, buyer))).toMatch(/row-level security/);
    expect(await outcome(put(traveller, `elsewhere/${id}/x.jpg`))).toMatch(/row-level security/);
    expect(await outcome(put(traveller, `transactions/${id}/deeper/x.jpg`))).toMatch(/row-level security/);
    // Nobody can change or delete a cited file (no update or delete policy): nothing is affected.
    expect((await probe(traveller, (tx) => tx.query(`delete from storage.objects where name = $1`, [mine]))).affectedRows ?? 0).toBe(0);
    expect((await probe(traveller, (tx) => tx.query(`update storage.objects set name = 'x' where name = $1`, [mine]))).affectedRows ?? 0).toBe(0);
  });
});

describe("duplicates, replays and investigations", () => {
  it("the same provider event delivered twice is a no-op the second time", async () => {
    const id = await orderAt(HAPPY.slice(0, 1));
    const first = await dbApply(id, "payment_confirmed", "provider", { providerEventId: "test:dup-1" });
    const again = await dbApply(id, "payment_confirmed", "provider", { providerEventId: "test:dup-1", operationKey: `orbitly:payment:${id}:1` });
    expect(first).toMatchObject({ state: "PAYMENT_CONFIRMED", duplicate: false });
    expect(again).toMatchObject({ state: "PAYMENT_CONFIRMED", duplicate: true });
    expect(await count("transaction_events", id)).toBe(2);
  });

  it("a provider event id seen on another order is kept for investigation, not treated as a duplicate", async () => {
    const one = await orderAt(HAPPY.slice(0, 1));
    const two = await orderAt(HAPPY.slice(0, 1));
    await dbApply(one, "payment_confirmed", "provider", { providerEventId: "test:cross" });
    expect(await outcome(dbApply(two, "payment_confirmed", "provider", { providerEventId: "test:cross" }))).toBe("provider_event_conflict");
    expect((await row(two)).state).toBe("PAYMENT_PENDING");
    expect(await anomalies(`provider_event_id = 'test:cross'`)).toEqual([{ code: "provider_event_conflict", transaction_ref: two, provider_event_id: "test:cross" }]);
  });

  it("a provider event for an order that doesn't exist is kept for investigation", async () => {
    const ghost = "00000000-0000-4000-8000-00000000f00d";
    expect(await outcome(asRole("orbitly_webhook", (tx) => tx.query(`select private.record_provider_event($1, 'payment_confirmed', 'test:ghost', null, 1, 'INR') r`, [ghost])).then((r) => {
      const v = r.rows[0] as { r: { anomaly?: string } };
      if (v.r.anomaly) throw new Error(v.r.anomaly);
    }))).toBe("transaction_not_found");
    expect(await anomalies(`provider_event_id = 'test:ghost'`)).toEqual([{ code: "transaction_not_found", transaction_ref: ghost, provider_event_id: "test:ghost" }]);
  });

  it("an event id reused for a different event is refused", async () => {
    const id = await orderAt([]);
    await dbApply(id, "request_payment", "system", { eventId: "same" });
    expect(await outcome(dbApply(id, "cancel_payment", "buyer", { eventId: "same" }))).toBe("event_id_conflict");
  });

  it("idempotency keys are tied to their exact operation and can't be reused", async () => {
    const id = await orderAt(HAPPY.slice(0, 2));
    const other = await orderAt(HAPPY.slice(0, 2));
    const ins = `insert into public.transaction_operations (transaction_id, kind, attempt, idempotency_key, status, amount_minor, failure_category) values ($1, $2, $3, $4, 'failed', 100, 'cancelled')`;
    expect(await outcome(db.query(ins, [id, "payment", 9, `orbitly:refund:${id}:9`]))).toMatch(/transaction_operations_key/);
    expect(await outcome(db.query(ins, [other, "payment", 1, `orbitly:payment:${id}:1`]))).toMatch(/transaction_operations_key/);
    expect(await outcome(db.query(ins, [id, "payment", 1, `orbitly:payment:${id}:1`]))).toMatch(/duplicate key/);
  });
});

describe("who can read and write what", () => {
  let id: string;
  beforeAll(async () => {
    id = await orderAt(HAPPY.slice(0, 4));
  });
  const TABLES = ["transactions", "transaction_events", "transaction_operations"];

  it("logged-out visitors can't read anything, even with an order's id", async () => {
    for (const t of [...TABLES, "transaction_anomalies"]) expect(await outcome(probe(null, (tx) => tx.query(`select id from public.${t}`)))).toMatch(/permission denied/);
  });

  it("another signed-in user sees no rows, and nobody but the owner sees anomalies", async () => {
    for (const t of TABLES) expect((await probe(stranger, (tx) => tx.query(`select id from public.${t}`))).rows).toEqual([]);
    for (const who of [buyer, traveller, admin]) expect(await outcome(probe(who, (tx) => tx.query(`select 1 from public.transaction_anomalies`)))).toMatch(/permission denied/);
  });

  it("the buyer and the traveller see their own order, its history and its payment steps", async () => {
    for (const user of [buyer, traveller]) {
      expect((await probe(user, (tx) => tx.query(`select state from public.transactions where id = $1`, [id]))).rows).toEqual([{ state: "PURCHASE_CONFIRMED" }]);
      expect((await probe(user, (tx) => tx.query(`select seq, unexpected from public.transaction_events where transaction_id = $1`, [id]))).rows).toHaveLength(4);
      expect((await probe(user, (tx) => tx.query(`select kind, status from public.transaction_operations where transaction_id = $1`, [id]))).rows).toEqual([{ kind: "payment", status: "succeeded" }]);
    }
  });

  it("internal fields stay hidden from both sides", async () => {
    for (const [t, col] of [["transactions", "provider_payment_ref"], ["transaction_events", "actor_id"], ["transaction_events", "note"], ["transaction_events", "provider_event_id"], ["transaction_events", "event_id"], ["transaction_events", "operation_key"], ["transaction_operations", "idempotency_key"], ["transaction_operations", "provider_ref"]])
      expect(await outcome(probe(buyer, (tx) => tx.query(`select ${col} from public.${t}`))), `${t}.${col}`).toMatch(/permission denied/);
  });

  it("nobody writes directly", async () => {
    for (const who of [buyer, traveller, "service_role", "orbitly_webhook", "orbitly_system"]) {
      expect(await outcome(probe(who, (tx) => tx.query(`update public.transactions set state = 'PAYOUT_ELIGIBLE' where id = $1`, [id]))), who).toMatch(/permission denied/);
      expect(await outcome(probe(who, (tx) => tx.query(`delete from public.transaction_events where transaction_id = $1`, [id]))), who).toMatch(/permission denied/);
      expect(await outcome(probe(who, (tx) => tx.query(`update public.transaction_operations set status = 'succeeded' where transaction_id = $1`, [id]))), who).toMatch(/permission denied/);
      expect(await outcome(probe(who, (tx) => tx.query(`insert into public.transaction_anomalies (provider_event_id, event_type, code) values ('test:x', 'x', 'x')`))), who).toMatch(/permission denied/);
    }
  });

  it("the private tables are closed to every role", async () => {
    for (const who of [buyer, null, "service_role", "orbitly_webhook", "orbitly_system"]) {
      expect(await outcome(probe(who, (tx) => tx.query(`select * from private.transaction_rules`))), String(who)).toMatch(/permission denied/);
      expect(await outcome(probe(who, (tx) => tx.query(`insert into private.transaction_admins (user_id) values ($1)`, [notAdmin]))), String(who)).toMatch(/permission denied/);
    }
  });
});

describe("history is append-only, even for the table owner", () => {
  it("events and anomalies can't be changed, deleted or truncated", async () => {
    const id = await orderAt(HAPPY.slice(0, 2));
    expect(await outcome(db.query(`update public.transaction_events set to_state = 'REFUNDED' where transaction_id = $1`, [id]))).toMatch(/append-only/);
    expect(await outcome(db.query(`delete from public.transaction_events where transaction_id = $1`, [id]))).toMatch(/append-only/);
    // Our trigger refuses; for a table other tables point at, Postgres refuses first. Either way, nothing is removed.
    for (const t of ["transaction_events", "transactions", "transaction_operations", "transaction_anomalies"])
      expect(await outcome(db.exec(`truncate public.${t}`))).toMatch(/append-only|cannot truncate a table referenced/);
    expect(await count("transaction_events", id)).toBe(2);
  });

  it("an anomaly row, once there, can't be altered", async () => {
    const id = await orderAt(HAPPY.slice(0, 1));
    await outcome(dbApply(id, "payment_confirmed", "provider", { amount: 7, providerEventId: "test:keep-me" }));
    expect(await outcome(db.query(`update public.transaction_anomalies set code = 'fine' where provider_event_id = 'test:keep-me'`))).toMatch(/append-only/);
    expect(await outcome(db.query(`delete from public.transaction_anomalies where provider_event_id = 'test:keep-me'`))).toMatch(/append-only/);
  });

  it("a finished operation can't be rewritten or removed", async () => {
    const id = await orderAt(HAPPY.slice(0, 2));
    expect(await outcome(db.query(`update public.transaction_operations set status = 'failed', failure_category = 'cancelled' where transaction_id = $1`, [id]))).toMatch(/finished operation/);
    expect(await outcome(db.query(`delete from public.transaction_operations where transaction_id = $1`, [id]))).toMatch(/can't be deleted/);
  });

  it("an order can't be deleted, re-assigned, skipped ahead, jumped versions or have its chargeback cleared", async () => {
    const id = await orderAt([...HAPPY.slice(0, 2), ["chargeback", "provider"]]);
    const v = (await row(id)).version;
    expect(await outcome(db.query(`delete from public.transactions where id = $1`, [id]))).toMatch(/can't be deleted/);
    expect(await outcome(db.query(`update public.transactions set buyer_id = $2, version = version + 1 where id = $1`, [id, stranger]))).toMatch(/can't change/);
    expect(await outcome(db.query(`update public.transactions set state = 'PAYOUT_COMPLETED', version = version + 1 where id = $1`, [id]))).toMatch(/invalid_transition/);
    expect(await outcome(db.query(`update public.transactions set version = version + 5 where id = $1`, [id]))).toMatch(/version_conflict/);
    expect(await outcome(db.query(`update public.transactions set chargeback = false, version = version + 1 where id = $1`, [id]))).toMatch(/can't be cleared/);
    expect((await row(id)).version).toBe(v);
  });

  it("a state change without its event fails when the database transaction commits", async () => {
    const id = await orderAt([]);
    expect(await outcome(db.query(`update public.transactions set state = 'PAYMENT_PENDING', version = 1 where id = $1`, [id]))).toMatch(/without a matching event/);
    expect(await row(id)).toMatchObject({ state: "OFFER_ACCEPTED", version: 0 });
  });
});

describe("all or nothing", () => {
  it("if the event can't be written, the state change and the operation are undone too", async () => {
    const id = await orderAt(HAPPY.slice(0, 2));
    expect(await outcome(dbApply(id, "open_dispute", "buyer", { note: "x".repeat(501) }))).toMatch(/transaction_events_note_check|check constraint/);
    expect(await row(id)).toMatchObject({ state: "PAYMENT_CONFIRMED", version: 2 });
    expect(await count("transaction_events", id)).toBe(2);
  });

  it("if the state change fails, no event or operation is left behind", async () => {
    const id = await orderAt([]);
    const r = await outcome(db.transaction(async (tx) => {
      await tx.exec(`create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end $$;
                     create trigger zz_boom before update on public.transactions for each row execute function pg_temp.boom();`);
      await tx.exec("set local role orbitly_system");
      await tx.query(`select private.record_system_event($1, 'request_payment', 'boom-1')`, [id]);
    }));
    expect(r).toMatch(/simulated failure/);
    expect(await row(id)).toMatchObject({ state: "OFFER_ACCEPTED", version: 0 });
    expect([await count("transaction_events", id), await count("transaction_operations", id)]).toEqual([0, 0]);
    expect((await db.query(`select count(*)::int n from pg_trigger where tgname = 'zz_boom'`)).rows[0]).toEqual({ n: 0 });
  });
});

// PGlite runs one backend, so "simultaneous" requests here are serialised by the client. Real two-connection races are
// in tests/db/phaseb-concurrency.mjs (run by hand on a throwaway Postgres).
describe("simultaneous requests (serialised)", () => {
  it("two payouts started at once: exactly one goes through", async () => {
    const id = await orderAt(HAPPY.slice(0, 9));
    const results = await Promise.all([outcome(dbApply(id, "start_payout", "admin")), outcome(dbApply(id, "start_payout", "admin"))]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r !== "ok")[0]).toMatch(/invalid_transition|duplicate_payout|version_conflict/);
    expect((await ops(id)).filter((o) => o.startsWith("payout"))).toHaveLength(1);
  });

  it("a refund and a payout requested at once: never both", async () => {
    for (const first of [0, 1]) {
      const id = await orderAt([...HAPPY.slice(0, 2), ["require_manual_review", "admin"]]);
      const calls = [() => outcome(dbApply(id, "initiate_refund", "admin")), () => outcome(dbApply(id, "approve_payout", "admin"))];
      const results = await Promise.all(first ? [calls[1](), calls[0]()] : [calls[0](), calls[1]()]);
      expect(results.filter((r) => r === "ok")).toHaveLength(1);
      await outcome(dbApply(id, "start_payout", "admin"));
      expect((await db.query(`select count(*)::int n from public.transaction_operations where transaction_id = $1 and kind in ('refund', 'payout') and status <> 'failed'`, [id])).rows[0]).toEqual({ n: 1 });
    }
  });

  it("the database itself refuses a second live payout, a refund beside a payout, or a second open payment", async () => {
    const id = await orderAt(HAPPY.slice(0, 10));
    const ins = (txId: string, kind: string, attempt: number) =>
      db.query(`insert into public.transaction_operations (transaction_id, kind, attempt, idempotency_key, amount_minor) values ($1, $2, $3, $4, 100)`, [txId, kind, attempt, `orbitly:${kind}:${txId}:${attempt}`]);
    expect(await outcome(ins(id, "payout", 2))).toMatch(/transaction_operations_one_money_out/);
    expect(await outcome(ins(id, "refund", 1))).toMatch(/transaction_operations_one_money_out/);
    const paying = await orderAt(HAPPY.slice(0, 1));
    expect(await outcome(ins(paying, "payment", 2))).toMatch(/transaction_operations_one_live_payment/);
  });
});
