import { describe, expect, it } from "vitest";
import { as, asAndKeep, createLocalSupabase, createUser, type Db } from "./local-supabase";

// Profiles are private to their owner: migration 20261030164247_profiles_own_row_read.sql (applied to dev
// 2026-10-30; it supersedes the Stage 3b draft). Runs on every real migration in an in-memory Postgres.

const names = async (db: Db, user: string | null) =>
  (await as(db, user, (tx) => tx.query<{ full_name: string }>(`select full_name from public.profiles order by full_name`))).rows.map((r) => r.full_name);

// Each test builds its own database from every migration, which can pass 5 s when the whole suite runs in parallel.
describe("profiles are private to their owner", { timeout: 20_000 }, () => {
  it("a signed-in user reads only their own name, never anyone else's", async () => {
    const { db } = await createLocalSupabase();
    const asha = await createUser(db, { name: "Asha" });
    const ravi = await createUser(db, { name: "Ravi" });
    expect(await names(db, asha)).toEqual(["Asha"]);
    expect(await names(db, ravi)).toEqual(["Ravi"]);
  });

  it("signed-out visitors still can't read profiles at all", async () => {
    const { db } = await createLocalSupabase();
    await createUser(db, { name: "Asha" });
    await expect(names(db, null)).rejects.toThrow(/permission denied/);
  });

  it("owners can still edit their own name, and still can't edit anyone else's", async () => {
    const { db } = await createLocalSupabase();
    const asha = await createUser(db, { name: "Asha" });
    const ravi = await createUser(db, { name: "Ravi" });
    const rename = (who: string, id: string) =>
      as(db, who, (tx) => tx.query(`update public.profiles set full_name = 'Changed' where id = $1`, [id]));
    expect((await rename(asha, asha)).affectedRows).toBe(1);
    expect((await rename(asha, ravi)).affectedRows).toBe(0);
  });

  it("requests and offers still work: foreign keys to profiles don't need read access", async () => {
    const { db } = await createLocalSupabase();
    const buyer = await createUser(db, { phoneVerified: true, name: "Buyer" });
    const traveller = await createUser(db, { phoneVerified: true, name: "Traveller" });
    const request = (await asAndKeep(db, buyer, (tx) =>
      tx.query<{ id: string }>(`insert into public.requests (title, delivery_city) values ('Grinder', 'Pune') returning id`),
    )).rows[0].id;
    // New requests are private drafts (stage 3a); travellers can only offer once the owner publishes.
    await asAndKeep(db, buyer, (tx) => tx.query(`select public.publish_request($1)`, [request]));
    const offer = await as(db, traveller, (tx) =>
      tx.query(`insert into public.offers (request_id, service_fee_inr, product_price_amount, product_currency, fx_rate_to_inr,
        arrival_date, handoff_method, declares_lawful_import) values ($1, 500, 10, 'USD', 83, current_date + 3, 'meet_in_person', true)
        returning estimated_total_inr::int`, [request]),
    );
    expect(offer.rows).toEqual([{ estimated_total_inr: 1330 }]);
  });

  it("profiles have exactly two rules: read your own, edit your own", async () => {
    const { db } = await createLocalSupabase();
    const { rows } = await db.query<{ l: string }>(
      `select policyname || ' ' || cmd || ' ' || coalesce(qual, '-') l from pg_policies where tablename = 'profiles' order by policyname`,
    );
    expect(rows.map((r) => r.l)).toEqual([
      expect.stringMatching(/^Users can read their own profile SELECT .*id = .*auth\.uid\(\)/),
      expect.stringMatching(/^Users can update their own profile UPDATE .*auth\.uid\(\).*= id/),
    ]);
  });
});
