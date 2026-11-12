#!/usr/bin/env node
// Phase B real-concurrency check. Run by hand: `node tests/db/phaseb-concurrency.mjs [--work <dir>] [--keep-log <file>]`.
// Not a vitest file (it needs Homebrew Postgres), so it never runs as part of `npm test`.
//
// It creates a throwaway Postgres (initdb), listening on a Unix socket only (no TCP), verifies that isolation, loads a
// Supabase stub + migrations 1-12 + the Phase B draft, races independent connections against each other, then stops
// the server and deletes every file it created, whether the run passes or fails. It never reads a connection string
// or environment credentials: every psql call gets an explicit socket path and a scrubbed environment.
//
// Each connection is its own psql process (its own backend). A "gate" connection holds an advisory lock; racers block
// on it, an observer confirms both are waiting, then the gate opens so they genuinely compete. Racers hold their
// transaction briefly after their call so the observer can confirm the loser is waiting on the row lock.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const PORT = 55439;
// macOS limits socket paths to ~104 bytes, so the socket lives in a short /tmp directory; data can live elsewhere.
const SOCK = mkdtempSync("/tmp/obpg-");
const WORK = mkdtempSync(join(opt("--work") ?? tmpdir(), "phaseb-pg-"));
const DATA = join(WORK, "data");
const LOG = join(WORK, "server.log");
const SUPER = "phaseb_test";

// No PG* variables, no DATABASE_URL: psql can only reach the socket we name.
// LC_ALL: on macOS the postmaster refuses to start without a valid locale in its environment.
const ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PG|DATABASE_URL|SUPABASE/i.test(k))), LC_ALL: "C" };
const PSQL = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", SOCK, "-p", String(PORT), "-U", SUPER, "-d", "postgres"];

const report = { postgres: null, isolation: {}, scenarios: [], failures: [], cleanup: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, cmdArgs, input) {
  const r = spawnSync(cmd, cmdArgs, { env: ENV, input, encoding: "utf8" });
  if (r.status !== 0) {
    const text = (r.stderr || r.stdout).trim();
    // Postgres prints CONTEXT lines after the ERROR line; the ERROR line is the one that matters.
    throw new Error(`${cmd} failed: ${text.match(/ERROR:.*$/m)?.[0] ?? text.split("\n").slice(-3).join(" | ")}`);
  }
  return r.stdout.trim();
}
const q = (sql) => run("psql", PSQL, sql);
const q1 = (sql) => q(sql).split("\n").filter(Boolean).at(-1);

/** A psql process kept open; each write is executed as it arrives. */
function session(name, script) {
  const p = spawn("psql", [...PSQL, "-v", `app=${name}`], { env: ENV });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (err += d));
  // Safety net: no session may outlive 30s, so a stuck connection can't hang the run (or skip the cleanup).
  const timer = setTimeout(() => p.kill("SIGKILL"), 30_000);
  const done = new Promise((resolve) => p.on("close", (code) => (clearTimeout(timer), resolve({ name, code, out, err }))));
  if (script !== undefined) p.stdin.end(script);
  return { p, done, write: (s) => p.stdin.write(s), end: () => p.stdin.end(), get out() { return out; } };
}
async function waitFor(sql, label, ms = 10_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (q1(sql) === "t") return true;
    await sleep(25);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Instance lifecycle and isolation.
function start() {
  report.postgres = run("postgres", ["--version"]);
  run("initdb", ["-D", DATA, "-U", SUPER, "--auth=trust", "--no-instructions", "-E", "UTF8", "--locale=C"]);
  // Local socket connections only: no host lines at all.
  writeFileSync(join(DATA, "pg_hba.conf"), "local all all trust\n");
  run("pg_ctl", ["-D", DATA, "-l", LOG, "-w", "-o", `-c listen_addresses='' -c port=${PORT} -c unix_socket_directories='${SOCK}' -c unix_socket_permissions=0700 -c max_connections=20 -c deadlock_timeout=200ms`, "start"]);
}
function verifyIsolation() {
  const pid = q1("select pg_backend_pid()");
  const postmaster = readFileSync(join(DATA, "postmaster.pid"), "utf8").split("\n")[0].trim();
  const tcp = spawnSync("lsof", ["-nP", "-a", "-p", postmaster, "-iTCP", "-iUDP"], { env: ENV, encoding: "utf8" }).stdout.trim();
  const iso = {
    // Bracketed so an empty value (no TCP listening at all) can't be confused with a missing one.
    listen_addresses: q1("select '[' || current_setting('listen_addresses') || ']'"),
    unix_socket_directories: q1("show unix_socket_directories"),
    server_addr: q1("select coalesce(inet_server_addr()::text, 'none')"),
    hba_rules: q("select type || ' ' || array_to_string(database, ',') || ' ' || array_to_string(user_name, ',') || ' ' || auth_method from pg_hba_file_rules").split("\n"),
    tcp_or_udp_sockets_open: tcp ? tcp.split("\n").length - 1 : 0,
    fresh_cluster_databases: q("select datname from pg_database order by 1").split("\n"),
    data_directory_is_ours: q1("show data_directory") === DATA,
    backend_pid_sample: pid,
  };
  report.isolation = iso;
  const ok = iso.listen_addresses === "[]" && iso.unix_socket_directories === SOCK && iso.server_addr === "none" && iso.tcp_or_udp_sockets_open === 0
    && iso.hba_rules.length === 1 && iso.hba_rules[0].startsWith("local ") && iso.data_directory_is_ours
    && iso.fresh_cluster_databases.join(",") === "postgres,template0,template1";
  if (!ok) throw new Error(`isolation not verified: ${JSON.stringify(iso)}`);
  iso.verified = true;
}
function cleanup() {
  const c = report.cleanup;
  try {
    if (existsSync(join(DATA, "postmaster.pid"))) run("pg_ctl", ["-D", DATA, "-m", "immediate", "-w", "stop"]);
    c.stopped = true;
  } catch (e) {
    c.stopped = `error: ${e.message}`;
  }
  c.process_still_running = spawnSync("pgrep", ["-f", DATA], { encoding: "utf8" }).stdout.trim() !== "";
  if (opt("--keep-log") && existsSync(LOG)) writeFileSync(opt("--keep-log"), readFileSync(LOG));
  rmSync(WORK, { recursive: true, force: true });
  rmSync(SOCK, { recursive: true, force: true });
  c.data_dir_removed = !existsSync(WORK);
  c.socket_dir_removed = !existsSync(SOCK);
}

// ---------------------------------------------------------------------------------------------------------------
// Schema: the same Supabase stub the PGlite tests use, migrations 1-12, then the Phase B draft.
let BUYER, TRAVELLER, ADMIN;
function load() {
  const stub = readFileSync(join(ROOT, "tests/db/local-supabase.ts"), "utf8").match(/const SUPABASE_STUB = `([\s\S]*?)`;/)[1];
  q(stub);
  const migrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migrations) q(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
  q(readFileSync(join(ROOT, "tests/db/phaseb-supabase-stub.sql"), "utf8"));
  q(readFileSync(join(ROOT, "supabase/drafts/phaseb_transactions.sql"), "utf8"));
  report.loaded = { migrations: migrations.length, stub: "tests/db/phaseb-supabase-stub.sql", draft: "supabase/drafts/phaseb_transactions.sql" };

  const user = (n, verified) => {
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    q(`insert into auth.users (id, email, phone, phone_confirmed_at, raw_user_meta_data) values ('${id}', 'u${n}@orbitly.test', ${verified ? `'91900000000${n}'` : "null"}, ${verified ? "now()" : "null"}, '{"full_name":"U${n}"}')`);
    return id;
  };
  BUYER = user(1, true);
  TRAVELLER = user(2, true);
  ADMIN = user(3, false);
  q(`insert into private.transaction_admins (user_id, note) values ('${ADMIN}', 'race test reviewer')`);
  // Test kit, only in this throwaway database: builds an accepted, priced order the way the app would.
  q(`
    create schema testkit;
    create function testkit.trip(p_from text, p_to text) returns uuid language plpgsql as $$
    declare v uuid;
    begin
      perform set_config('request.jwt.claim.sub', '${TRAVELLER}', true);
      insert into public.trips (departure_country, destination_country, departure_date, arrival_date)
        values (p_from, p_to, current_date + 1, current_date + 5) returning id into v;
      return v;
    end $$;
    create table testkit.trips (route text primary key, id uuid);
    insert into testkit.trips values ('into_india', testkit.trip('US', 'IN')), ('out_of_india', testkit.trip('IN', 'GB'));
    create function testkit.new_order(p_route text) returns uuid language plpgsql as $$
    declare r uuid; o uuid;
    begin
      perform set_config('request.jwt.claim.sub', '${BUYER}', true);
      insert into public.requests (title, delivery_city, source_country, destination_country)
        values ('A product', 'Pune', case p_route when 'into_india' then 'US' else 'IN' end, case p_route when 'into_india' then 'IN' else 'GB' end)
        returning id into r;
      perform public.publish_request(r);
      perform set_config('request.jwt.claim.sub', '${TRAVELLER}', true);
      insert into public.offers (request_id, trip_id, service_fee_inr, product_price_amount, product_currency, fx_rate_to_inr,
          arrival_date, handoff_method, declares_lawful_import, delivery_inr, other_costs_inr, customs_estimate_inr)
        values (r, (select id from testkit.trips where route = p_route), 1800, 299, 'USD', 83.5, current_date + 5, 'meet_in_person', true, 250, 0, 1500)
        returning id into o;
      perform set_config('request.jwt.claim.sub', '${BUYER}', true);
      perform public.accept_offer(o);
      return private.open_transaction(o);
    end $$;
  `);
}

// ---------------------------------------------------------------------------------------------------------------
// Building calls. Each role goes through the entry point it really uses: provider events as orbitly_webhook,
// system events as orbitly_system, admins from their own multi-factor session, buyers and travellers through
// transaction_act. Provider answers carry the open attempt's key and the snapshot's amount, as a verified webhook would.
const AMOUNT = { payment_confirmed: "buyer_total_minor", refund_completed: "buyer_total_minor", payout_completed: "net_reward_minor" };
const OUTCOME = { payment_confirmed: "payment", payment_failed: "payment", cancel_payment: "payment", payout_completed: "payout", payout_failed: "payout", refund_completed: "refund", refund_failed: "refund" };
const EVIDENCE = ["confirm_purchase", "record_delivery"];
let n = 0;
// The version is read as the table owner, just before switching role, at the moment the statement runs (after the gate).
const versionNow = (tx) => `select set_config('orbitly.v', (select version::text from public.transactions where id = '${tx}'), true);`;
function serviceCall(tx, type, role, o = {}) {
  const eventId = o.eventId ?? `ev-${++n}`;
  const version = o.version ?? "current_setting('orbitly.v')::int";
  if (role === "provider") {
    const amount = AMOUNT[type] ? `(select s.${AMOUNT[type]} from public.transactions t join public.offer_pricing_snapshots s on s.offer_id = t.offer_id where t.id = '${tx}')` : "null";
    const key = o.operationKey !== undefined ? (o.operationKey === null ? "null" : `'${o.operationKey}'`)
      : OUTCOME[type] ? `(select idempotency_key from public.transaction_operations where transaction_id = '${tx}' and kind = '${OUTCOME[type]}' and status = 'started')` : "null";
    const pid = o.providerEventId ?? `pe-${++n}`;
    // Computed as the owner, then passed in: the webhook role itself can't read any table.
    return `select set_config('orbitly.amount', coalesce(${amount}::text, ''), true), set_config('orbitly.key', coalesce(${key}, ''), true);
      set local role orbitly_webhook;
      select 'RESULT:' || private.record_provider_event('${tx}', '${type}', '${pid.includes(":") ? pid : `test:${pid}`}',
        nullif(current_setting('orbitly.key'), ''), nullif(current_setting('orbitly.amount'), '')::bigint, ${AMOUNT[type] ? "'INR'" : "null"})::text;`;
  }
  if (role === "system") {
    return `set local role orbitly_system; select 'RESULT:' || private.record_system_event('${tx}', '${type}', '${eventId}', ${o.version ?? "null"})::text;`;
  }
  if (role === "admin") {
    return `${versionNow(tx)} set local role authenticated; select set_config('request.jwt.claim.sub', '${ADMIN}', true);
      select set_config('request.jwt.claims', '{"sub":"${ADMIN}","aal":"aal2"}', true);
      select 'RESULT:' || public.transaction_admin_act('${tx}', '${type}', '${eventId}', ${version}, 'Concurrency test review step',
        ${type === "resolve_dispute" ? `'${o.resolution ?? "pay_traveller"}'` : "null"})::text;`;
  }
  return asUser(role === "buyer" ? BUYER : TRAVELLER, tx, type, o.version ?? null, eventId, o.note);
}
const asService = (body) => body;
/** A buyer's or traveller's own step. Evidence is a file uploaded first into the order's folder, as that user. */
function asUser(uid, tx, type, version, eventId = `act-${++n}`, note) {
  const file = `transactions/${tx}/r${++n}.jpg`;
  const upload = EVIDENCE.includes(type) ? `insert into storage.objects (bucket_id, name, owner_id) values ('transaction-evidence', '${file}', '${uid}');` : "";
  return `${upload} ${versionNow(tx)} set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);
   select 'RESULT:' || public.transaction_act('${tx}', '${type}', '${eventId}', ${version ?? "current_setting('orbitly.v')::int"},
     ${EVIDENCE.includes(type) ? `'{${file}}'` : "null"}, ${note ? `'${note}'` : "null"})::text;`;
}

/** Moves a fresh order through the given steps, one committed transaction each, as the server would. */
function orderAt(steps, route = "into_india") {
  const tx = q1(`select testkit.new_order('${route}')`);
  for (const [type, role, o] of steps) {
    const out = q(`begin; ${asService(serviceCall(tx, type, role, o))} commit;`);
    const r = JSON.parse(out.match(/RESULT:(.*)/)?.[1] ?? "{}");
    if (r.anomaly) throw new Error(`setup step ${type} became an anomaly: ${r.anomaly}`);
  }
  return tx;
}
const HAPPY = [
  ["request_payment", "system"], ["payment_confirmed", "provider"], ["request_purchase", "system"], ["confirm_purchase", "traveller"],
  ["start_transit", "traveller"], ["arrive", "traveller"], ["record_delivery", "traveller"], ["request_buyer_confirmation", "system"],
  ["buyer_confirms_delivery", "buyer"], ["start_payout", "admin"], ["payout_completed", "provider"],
];
const state = (tx) => {
  const [s, v] = q1(`select state || '|' || version from public.transactions where id = '${tx}'`).split("|");
  return { state: s, version: Number(v) };
};
const events = (tx) => Number(q1(`select count(*) from public.transaction_events where transaction_id = '${tx}'`));
const ops = (tx) => q(`select kind || ':' || attempt || ':' || status from public.transaction_operations where transaction_id = '${tx}' order by kind, attempt`).split("\n").filter(Boolean);
const liveMoneyOut = (tx) => Number(q1(`select count(*) from public.transaction_operations where transaction_id = '${tx}' and kind in ('refund','payout') and status <> 'failed'`));
const succeededOps = (tx) => Number(q1(`select count(*) from (select kind from public.transaction_operations where transaction_id = '${tx}' and status = 'succeeded' group by kind having count(*) > 1) d`));

// ---------------------------------------------------------------------------------------------------------------
// The race harness.
let gateId = 4000;
/**
 * Starts each racer on its own connection, blocks them all on a gate, confirms (from an observer connection) that
 * all are waiting, opens the gate, and confirms a racer waited on a row/transaction lock while another held it.
 */
async function race(bodies, { hold = 0.8, expectLockWait = true, stagger = [] } = {}) {
  const gate = ++gateId;
  const tag = `race${gate}`;
  const g = session(`${tag}_gate`);
  g.write(`set application_name = '${tag}_gate'; select 'GATE:' || pg_advisory_lock(${gate});\n`);
  await waitFor(`select exists (select 1 from pg_locks where locktype = 'advisory' and objid = ${gate} and granted)`, "gate held");
  const racers = bodies.map((body, i) =>
    // `stagger` (seconds after the gate opens) decides which racer reaches the row lock first, so both orders can be
    // run; the later one still genuinely blocks on the lock the first one holds.
    session(`${tag}_${i}`, `set application_name = '${tag}_${i}';\nselect 'PID:' || pg_backend_pid();\nselect pg_advisory_lock_shared(${gate});\n${stagger[i] ? `select pg_sleep(${stagger[i]});\n` : ""}begin;\n${body}\nselect pg_sleep(${hold});\ncommit;\n`),
  );
  await waitFor(`select count(*) = ${bodies.length} from pg_stat_activity where application_name like '${tag}\\_%' and application_name <> '${tag}_gate' and wait_event_type = 'Lock' and wait_event = 'advisory'`, "all racers at the gate");
  g.write(`select pg_advisory_unlock(${gate});\n`);
  g.end();
  let lockWaitSeen = false;
  const until = Date.now() + hold * 1000 + 3000;
  const finished = Promise.all(racers.map((r) => r.done));
  let settled = false;
  finished.then(() => (settled = true));
  while (!settled && Date.now() < until && !lockWaitSeen) {
    lockWaitSeen = q1(`select exists (select 1 from pg_stat_activity where application_name like '${tag}\\_%' and wait_event_type = 'Lock' and wait_event in ('transactionid', 'tuple'))`) === "t";
    await sleep(20);
  }
  const results = await finished;
  await g.done;
  const parsed = results.map((r) => ({
    pid: (r.out.match(/PID:(\d+)/) ?? [])[1],
    result: (r.out.match(/RESULT:(.*)/) ?? [])[1] ?? null,
    error: (r.err.match(/ERROR:\s+(.*)/) ?? [])[1] ?? null,
  }));
  const pids = new Set(parsed.map((p) => p.pid));
  if (pids.size !== bodies.length || parsed.some((p) => !p.pid)) throw new Error(`racers did not run on distinct backends: ${JSON.stringify(parsed)}`);
  if (expectLockWait && !lockWaitSeen) throw new Error("no racer was observed waiting on the row lock");
  return { racers: parsed, distinctBackends: pids.size, lockWaitObserved: lockWaitSeen };
}
// A provider fact that couldn't be applied comes back as an anomaly (recorded, not raised): that is not an "ok".
const outcomeOf = (x) => {
  if (x.error) return x.error;
  const r = JSON.parse(x.result);
  return r.anomaly ?? (r.duplicate ? "duplicate" : "ok");
};
const okCount = (r) => r.racers.filter((x) => outcomeOf(x) === "ok").length;

function check(name, cond, detail) {
  if (!cond) report.failures.push({ scenario: name, detail });
  return cond;
}
async function scenario(name, expected, fn) {
  const entry = { name, expected };
  try {
    Object.assign(entry, await fn());
    entry.pass = !report.failures.some((f) => f.scenario === name);
  } catch (e) {
    entry.pass = false;
    report.failures.push({ scenario: name, detail: e.message });
  }
  report.scenarios.push(entry);
}

// ---------------------------------------------------------------------------------------------------------------
async function scenarios() {
  await scenario("1. Two simultaneous payout starts for the same order", "exactly one succeeds; one payout operation", async () => {
    const tx = orderAt(HAPPY.slice(0, 9));
    const r = await race([asService(serviceCall(tx, "start_payout", "admin")), asService(serviceCall(tx, "start_payout", "admin"))]);
    const after = { ...state(tx), events: events(tx), ops: ops(tx) };
    check("1. Two simultaneous payout starts for the same order", okCount(r) === 1 && after.ops.filter((o) => o.startsWith("payout")).length === 1 && after.events === 10, after);
    return { ...r, outcomes: r.racers.map(outcomeOf), after };
  });

  await scenario("2a. Refund and payout racing (both allowed from manual review)", "exactly one succeeds; never a refund and a payout", async () => {
    const tx = orderAt([...HAPPY.slice(0, 2), ["require_manual_review", "admin"]]);
    const r = await race([asService(serviceCall(tx, "initiate_refund", "admin")), asService(serviceCall(tx, "approve_payout", "admin"))]);
    const winnerPayout = state(tx).state === "PAYOUT_ELIGIBLE";
    // If the payout side won, push it all the way to a live payout and try the refund again: still refused.
    let followUp = null;
    if (winnerPayout) {
      q(`begin; ${asService(serviceCall(tx, "start_payout", "admin"))} commit;`);
      try { q(`begin; ${asService(serviceCall(tx, "initiate_refund", "admin"))} commit;`); followUp = "refund accepted (BAD)"; } catch (e) { followUp = e.message.match(/ERROR:\s+(\S+)/)?.[1] ?? e.message; }
    }
    const after = { ...state(tx), ops: ops(tx), liveMoneyOut: liveMoneyOut(tx) };
    check("2a. Refund and payout racing (both allowed from manual review)", okCount(r) === 1 && after.liveMoneyOut <= 1 && followUp !== "refund accepted (BAD)", after);
    return { ...r, outcomes: r.racers.map(outcomeOf), followUp, after };
  });

  await scenario("2b. Refund and payout operation rows inserted on two connections, bypassing the function", "the unique index lets exactly one commit", async () => {
    const tx = orderAt(HAPPY.slice(0, 2));
    const ins = (kind) => `insert into public.transaction_operations (transaction_id, kind, attempt, idempotency_key, amount_minor) values ('${tx}', '${kind}', 1, 'orbitly:${kind}:${tx}:1', 100) returning 'RESULT:{"duplicate":false}';`;
    const r = await race([ins("refund"), ins("payout")]);
    const after = { ops: ops(tx), liveMoneyOut: liveMoneyOut(tx) };
    check("2b. Refund and payout operation rows inserted on two connections, bypassing the function", okCount(r) === 1 && after.liveMoneyOut === 1 && r.racers.some((x) => /transaction_operations_one_money_out/.test(x.error ?? "")), after);
    return { ...r, outcomes: r.racers.map((x) => x.error ?? "inserted"), after };
  });

  await scenario("3. Two state changes based on the same version", "one succeeds; the other is refused (version_conflict or invalid_transition), never both", async () => {
    const tx = orderAt(HAPPY.slice(0, 2)); // PAYMENT_CONFIRMED, version 2
    const r = await race([asService(serviceCall(tx, "request_purchase", "system", { version: 2 })), asUser(BUYER, tx, "open_dispute", 2)]);
    const after = { ...state(tx), events: events(tx) };
    check("3. Two state changes based on the same version", okCount(r) === 1 && after.version === 3 && after.events === 3 && r.racers.some((x) => /version_conflict|invalid_transition/.test(x.error ?? "")), after);
    return { ...r, outcomes: r.racers.map(outcomeOf), after };
  });

  await scenario("4a. The same provider event delivered twice at once (same event id)", "one applies it, the other is a no-op duplicate; one event, one succeeded payment", async () => {
    const tx = orderAt(HAPPY.slice(0, 1));
    const call = () => asService(serviceCall(tx, "payment_confirmed", "provider", { eventId: "wh-1", providerEventId: "prov-evt-1" }));
    const r = await race([call(), call()]);
    const after = { ...state(tx), events: events(tx), ops: ops(tx) };
    check("4a. The same provider event delivered twice at once (same event id)", r.racers.map(outcomeOf).sort().join(",") === "duplicate,ok" && after.events === 2 && after.ops.join() === "payment:1:succeeded", after);
    return { ...r, outcomes: r.racers.map(outcomeOf), after };
  });

  await scenario("4b. One provider event id replayed against two different orders at once", "different rows, so no shared row lock: the global unique key lets exactly one apply; the other is kept as an anomaly for investigation", async () => {
    const one = orderAt(HAPPY.slice(0, 1));
    const two = orderAt(HAPPY.slice(0, 1));
    const r = await race([
      asService(serviceCall(one, "payment_confirmed", "provider", { providerEventId: "prov-evt-shared" })),
      asService(serviceCall(two, "payment_confirmed", "provider", { providerEventId: "prov-evt-shared" })),
    ]);
    const after = { one: state(one).state, two: state(two).state, rowsWithThatEvent: Number(q1(`select count(*) from public.transaction_events where provider_event_id = 'test:prov-evt-shared'`)), anomalies: q(`select code from public.transaction_anomalies where provider_event_id = 'test:prov-evt-shared'`) };
    check("4b. One provider event id replayed against two different orders at once", okCount(r) === 1 && after.rowsWithThatEvent === 1 && after.anomalies === "provider_event_conflict" && [after.one, after.two].sort().join() === "PAYMENT_CONFIRMED,PAYMENT_PENDING", after);
    return { ...r, outcomes: r.racers.map(outcomeOf), after };
  });

  await scenario("5. Two operations competing for the same idempotency key", "the unique key lets exactly one commit", async () => {
    const tx = orderAt(HAPPY.slice(0, 2));
    const ins = `insert into public.transaction_operations (transaction_id, kind, attempt, idempotency_key, status, amount_minor, failure_category) values ('${tx}', 'payment', 7, 'orbitly:payment:${tx}:7', 'failed', 100, 'cancelled') returning 'RESULT:{"duplicate":false}';`;
    const r = await race([ins, ins]);
    const after = { attempt7Rows: Number(q1(`select count(*) from public.transaction_operations where idempotency_key = 'orbitly:payment:${tx}:7'`)) };
    check("5. Two operations competing for the same idempotency key", okCount(r) === 1 && after.attempt7Rows === 1 && r.racers.some((x) => /duplicate key/.test(x.error ?? "")), after);
    return { ...r, outcomes: r.racers.map((x) => x.error ?? "inserted"), after };
  });

  // Both orders. When the real answer holds the lock, the late one waits on it, then is refused. When the late one gets
  // there first it is refused at once (a refusal releases the lock immediately, so there is no wait to observe).
  for (const [label, stagger, expectLockWait] of [["real answer locks first", [0.15, 0], true], ["late answer locks first", [0, 0.15], false]]) {
    const name = `6. A late provider answer for attempt 1 racing the real answer for attempt 2 (${label})`;
    // Refused either way: by the attempt key while attempt 2 is open, or because no attempt is open once it settled.
    await scenario(name, "the late answer is refused (operation_mismatch, or operation_missing once attempt 2 has settled) and kept as an anomaly; attempt 2 succeeds", async () => {
      const tx = orderAt([...HAPPY.slice(0, 10), ["payout_failed", "provider"], ["start_payout", "admin"]]);
      const r = await race([
        asService(serviceCall(tx, "payout_failed", "provider", { operationKey: `orbitly:payout:${tx}:1` })),
        asService(serviceCall(tx, "payout_completed", "provider", { operationKey: `orbitly:payout:${tx}:2` })),
      ], { stagger, expectLockWait });
      const after = { ...state(tx), ops: ops(tx) };
      check(name, /^(operation_mismatch|operation_missing)$/.test(outcomeOf(r.racers[0])) && outcomeOf(r.racers[1]) === "ok" && after.state === "PAYOUT_COMPLETED" && after.ops.join() === "payment:1:succeeded,payout:1:failed,payout:2:succeeded", after);
      return { ...r, outcomes: r.racers.map(outcomeOf), after };
    });
  }

  await scenario("7. A dispute opened while a payout is being started", "exactly one wins; if the dispute wins there is no payout operation", async () => {
    const tx = orderAt(HAPPY.slice(0, 9)); // PAYOUT_ELIGIBLE, version 9
    const r = await race([asUser(BUYER, tx, "open_dispute", 9), asService(serviceCall(tx, "start_payout", "admin"))]);
    const after = { ...state(tx), ops: ops(tx) };
    const payoutOps = after.ops.filter((o) => o.startsWith("payout")).length;
    check("7. A dispute opened while a payout is being started", okCount(r) === 1 && (after.state === "DISPUTE_OPEN" ? payoutOps === 0 : after.state === "PAYOUT_PROCESSING" && payoutOps === 1), after);
    return { ...r, outcomes: r.racers.map(outcomeOf), after };
  });

  // record_delivery is invalid from IN_TRANSIT but valid from DELIVERY_PENDING. Sent with version 5 (IN_TRANSIT), it
  // must fail either way: invalid_transition if it locks first, version_conflict if it waits for `arrive` to commit.
  for (const [label, stagger, expectLockWait, expected] of [["change locks first", [0, 0.15], true, "version_conflict"], ["invalid step locks first", [0.15, 0], false, "invalid_transition"]]) {
    const name = `8. An order changed while another connection tries a step that is invalid for what it saw (${label})`;
    await scenario(name, `the stale step is refused (${expected}); the change commits once`, async () => {
      const tx = orderAt(HAPPY.slice(0, 5)); // IN_TRANSIT, version 5
      const r = await race([asUser(TRAVELLER, tx, "arrive", 5), asUser(TRAVELLER, tx, "record_delivery", 5)], { stagger, expectLockWait });
      const after = { ...state(tx), events: events(tx) };
      check(name, outcomeOf(r.racers[0]) === "ok" && outcomeOf(r.racers[1]) === expected && after.state === "DELIVERY_PENDING" && after.version === 6 && after.events === 6, after);
      return { ...r, outcomes: r.racers.map(outcomeOf), after };
    });
  }

  await scenario("9. The provider captures a payment while the buyer cancels it", "the capture is always recorded (never lost); one successful payment; review if it arrived after the cancel", async () => {
    const tx = orderAt(HAPPY.slice(0, 1)); // PAYMENT_PENDING, version 1, payment attempt open
    const r = await race([asUser(BUYER, tx, "cancel_payment", 1), asService(serviceCall(tx, "payment_confirmed", "provider"))]);
    const after = { ...state(tx), ops: ops(tx), captures: Number(q1(`select count(*) from public.transaction_events where transaction_id = '${tx}' and event_type = 'payment_confirmed'`)) };
    check("9. The provider captures a payment while the buyer cancels it", outcomeOf(r.racers[1]) === "ok" && after.ops.join() === "payment:1:succeeded" && after.captures === 1 && ["PAYMENT_CONFIRMED", "MANUAL_REVIEW_REQUIRED"].includes(after.state), after);
    return { ...r, outcomes: r.racers.map(outcomeOf), after };
  });

  await scenario("10. A payment retry racing a late capture of the cancelled attempt", "the retry is always refused, so the buyer is never charged twice; the capture is recorded and goes to review", async () => {
    const tx = orderAt([["request_payment", "system"], ["cancel_payment", "buyer"]]); // PAYMENT_CANCELLED, attempt 1 still open
    const r = await race([asService(serviceCall(tx, "retry_payment", "system")), asService(serviceCall(tx, "payment_confirmed", "provider"))], { expectLockWait: false });
    const after = { ...state(tx), ops: ops(tx) };
    check("10. A payment retry racing a late capture of the cancelled attempt", /payment_attempt_open|invalid_transition/.test(outcomeOf(r.racers[0])) && outcomeOf(r.racers[1]) === "ok" && after.ops.join() === "payment:1:succeeded" && after.state === "MANUAL_REVIEW_REQUIRED", after);
    return { ...r, outcomes: r.racers.map(outcomeOf), after };
  });
}

async function failureScenarios() {
  await scenario("F1. Connection killed mid-operation, then retried", "nothing from the killed attempt survives; the retry creates exactly one payout operation", async () => {
    const tx = orderAt(HAPPY.slice(0, 9));
    const s = session("f1_victim", undefined);
    s.write(`set application_name = 'f1_victim';\nbegin;\n${asService(serviceCall(tx, "start_payout", "admin", { eventId: "f1-payout" }))}\nselect 'HOLDING';\n`);
    await waitFor(`select exists (select 1 from pg_stat_activity where application_name = 'f1_victim' and state = 'idle in transaction')`, "victim mid-transaction");
    const killed = q1(`select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'f1_victim'`);
    s.end(); // psql otherwise waits for more input on a connection the server has closed
    await s.done;
    const afterKill = { ...state(tx), ops: ops(tx), events: events(tx) };
    q(`begin; ${asService(serviceCall(tx, "start_payout", "admin", { eventId: "f1-payout" }))} commit;`);
    const replay = q1(`begin; ${asService(serviceCall(tx, "start_payout", "admin", { eventId: "f1-payout" }))} commit;`);
    const after = { ...state(tx), ops: ops(tx), events: events(tx) };
    check("F1. Connection killed mid-operation, then retried", killed === "t" && afterKill.state === "PAYOUT_ELIGIBLE" && afterKill.ops.join() === "payment:1:succeeded" && after.ops.join() === "payment:1:succeeded,payout:1:started" && /"duplicate": true/.test(replay), { afterKill, after, replay });
    return { killed: killed === "t", afterKill, after, retryReplay: replay.replace("RESULT:", "") };
  });

  await scenario("F2. Event insert fails (note too long): everything rolls back; a retry succeeds once", "no state or event from the failed call", async () => {
    const tx = orderAt(HAPPY.slice(0, 2)); // PAYMENT_CONFIRMED, version 2
    let err = null;
    try { q(`begin; ${asService(serviceCall(tx, "open_dispute", "buyer", { note: "x".repeat(501), eventId: "f2" }))} commit;`); } catch (e) { err = e.message.match(/ERROR:\s+(.*)/)?.[1] ?? e.message; }
    const afterFail = { ...state(tx), events: events(tx), ops: ops(tx) };
    q(`begin; ${asService(serviceCall(tx, "open_dispute", "buyer", { eventId: "f2" }))} commit;`);
    const after = { ...state(tx), events: events(tx), ops: ops(tx) };
    check("F2. Event insert fails (note too long): everything rolls back; a retry succeeds once", /check constraint/.test(err ?? "") && afterFail.version === 2 && afterFail.events === 2 && after.state === "DISPUTE_OPEN" && after.events === 3, { err, afterFail, after });
    return { error: err, afterFail, after };
  });

  await scenario("F3. Lock timeout while another connection holds the order", "the waiting call gives up after the functions' own 3s lock limit, writes nothing; its retry sees the new state", async () => {
    const tx = orderAt(HAPPY.slice(0, 9));
    const holder = session("f3_holder", `set application_name = 'f3_holder';\nbegin;\n${asService(serviceCall(tx, "start_payout", "admin"))}\nselect pg_sleep(4);\ncommit;\n`);
    await waitFor(`select exists (select 1 from pg_stat_activity where application_name = 'f3_holder' and wait_event = 'PgSleep')`, "holder has the lock");
    let err = null;
    try { q(`set lock_timeout = '300ms'; begin; ${asService(serviceCall(tx, "start_payout", "admin"))} commit;`); } catch (e) { err = e.message.match(/ERROR:\s+(.*)/)?.[1] ?? e.message; }
    await holder.done;
    let retry;
    try { q(`begin; ${asService(serviceCall(tx, "start_payout", "admin"))} commit;`); retry = "ok (BAD)"; } catch (e) { retry = e.message.match(/ERROR:\s+(\S+)/)?.[1]; }
    const after = { ...state(tx), ops: ops(tx) };
    check("F3. Lock timeout while another connection holds the order", /lock timeout/.test(err ?? "") && retry === "invalid_transition" && after.ops.filter((o) => o.startsWith("payout")).length === 1, { err, retry, after });
    return { timeoutError: err, retry, after };
  });

  await scenario("F4. Retry after a failed payout attempt", "a new attempt with a new key; never two live payouts", async () => {
    const tx = orderAt([...HAPPY.slice(0, 10), ["payout_failed", "provider"]]);
    const r = await race([asService(serviceCall(tx, "start_payout", "admin")), asService(serviceCall(tx, "start_payout", "admin"))]);
    const after = { ...state(tx), ops: ops(tx), liveMoneyOut: liveMoneyOut(tx) };
    check("F4. Retry after a failed payout attempt", okCount(r) === 1 && after.ops.join() === "payment:1:succeeded,payout:1:failed,payout:2:started" && after.liveMoneyOut === 1, after);
    return { ...r, outcomes: r.racers.map(outcomeOf), after };
  });

  await scenario("F5. Duplicate requests after a successful payout, sent at once", "both are no-ops; no new event or operation", async () => {
    const tx = orderAt([...HAPPY.slice(0, 9), ["start_payout", "admin", { eventId: "f5-start" }], ["payout_completed", "provider", { eventId: "f5-done", providerEventId: "prov-f5" }]]);
    const before = { events: events(tx), ops: ops(tx) };
    const r = await race([
      asService(serviceCall(tx, "start_payout", "admin", { eventId: "f5-start" })),
      asService(serviceCall(tx, "payout_completed", "provider", { eventId: "f5-done", providerEventId: "prov-f5", operationKey: null })),
    ]);
    const after = { ...state(tx), events: events(tx), ops: ops(tx), duplicateSucceeded: succeededOps(tx) };
    check("F5. Duplicate requests after a successful payout, sent at once", r.racers.every((x) => outcomeOf(x) === "duplicate") && after.events === before.events && after.ops.join() === before.ops.join() && after.duplicateSucceeded === 0, after);
    return { ...r, outcomes: r.racers.map(outcomeOf), after };
  });
}

// ---------------------------------------------------------------------------------------------------------------
try {
  start();
  verifyIsolation();
  load();
  await scenarios();
  await failureScenarios();
  // Across every order in the run: never two succeeded operations of one kind, never a live refund beside a payout.
  report.globalInvariants = {
    ordersWithTwoSucceededOfOneKind: Number(q1(`select count(*) from (select transaction_id, kind from public.transaction_operations where status = 'succeeded' group by 1, 2 having count(*) > 1) d`)),
    ordersWithRefundAndPayoutLive: Number(q1(`select count(*) from (select transaction_id from public.transaction_operations where kind in ('refund','payout') and status <> 'failed' group by 1 having count(*) > 1) d`)),
    ordersWithRefundAndPayoutSucceeded: Number(q1(`select count(*) from (select transaction_id from public.transaction_operations where status = 'succeeded' and kind in ('refund','payout') group by 1 having count(distinct kind) = 2) d`)),
    stateChangesWithoutEvent: Number(q1(`select count(*) from public.transactions t where t.version > 0 and not exists (select 1 from public.transaction_events e where e.transaction_id = t.id and e.seq = t.version and e.to_state = t.state)`)),
  };
  const g = report.globalInvariants;
  if (g.ordersWithTwoSucceededOfOneKind || g.ordersWithRefundAndPayoutLive || g.ordersWithRefundAndPayoutSucceeded || g.stateChangesWithoutEvent) report.failures.push({ scenario: "global invariants", detail: g });
} catch (e) {
  report.failures.push({ scenario: "setup", detail: e.message });
} finally {
  cleanup();
}
report.passed = report.failures.length === 0 && report.scenarios.length === 19 && report.scenarios.every((s) => s.pass);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
