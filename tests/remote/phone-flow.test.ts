// END-TO-END against the real dev Supabase project, using a Supabase TEST phone number
// (fixed code, no SMS is sent). It CHANGES dev data, so it only runs when asked:
//   RUN_REMOTE_TESTS=1 npx vitest run tests/remote
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
// TEST_USER_EMAIL, TEST_USER_PASSWORD (a confirmed user with no phone yet), and
// TEST_PHONE_OTPS_DASHBOARD (the "number=code,..." value pasted into the dashboard).
// Leaves behind: the test number on the test user and one request. Reset (SQL editor, dev only):
//   delete from public.requests where shopper_id = (select id from auth.users where email = '<TEST_USER_EMAIL>');
//   update auth.users set phone = null, phone_confirmed_at = null where email = '<TEST_USER_EMAIL>';
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
const [testPhone, testCode] = (env.TEST_PHONE_OTPS_DASHBOARD ?? "").split(",")[0].split("=");

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
const request = { title: "E2E test request", price_inr: 1000, delivery_city: "Pune", reward_inr: 100 };

describe("phone verification on dev (test number, no SMS)", () => {
  beforeAll(async () => {
    expect(testPhone && testCode, "TEST_PHONE_OTPS_DASHBOARD missing").toBeTruthy();
    const { error } = await supabase.auth.signInWithPassword({
      email: env.TEST_USER_EMAIL,
      password: env.TEST_USER_PASSWORD,
    });
    expect(error).toBeNull();
    const { data } = await supabase.auth.getUser();
    expect(data.user?.phone_confirmed_at, "test user already verified; reset it first").toBeFalsy();
  });

  it("blocks an unverified user from creating a request (RLS)", async () => {
    const { error } = await supabase.from("requests").insert(request);
    expect(error?.code).toBe("42501");
  });

  it("is_phone_verified() is false before verification", async () => {
    expect((await supabase.rpc("is_phone_verified")).data).toBe(false);
  });

  it("requests a code for the test number and rejects a wrong code", async () => {
    expect((await supabase.auth.updateUser({ phone: `+${testPhone}` })).error).toBeNull();
    const wrong = testCode === "000000" ? "111111" : "000000";
    const { error } = await supabase.auth.verifyOtp({ phone: testPhone, token: wrong, type: "phone_change" });
    expect(error?.code).toBe("otp_expired");
    expect((await supabase.auth.getUser()).data.user?.phone_confirmed_at).toBeFalsy();
  });

  it("verifies with the right code; Supabase reports the phone confirmed", async () => {
    const { error } = await supabase.auth.verifyOtp({ phone: testPhone, token: testCode, type: "phone_change" });
    // otp_expired here usually means the dashboard doesn't treat this number as a test number
    // (auth logs then show the Send SMS hook ran for it, which Supabase skips for test numbers).
    expect(error, "test number/code not active in the dashboard's Test Phone Numbers and OTPs?").toBeNull();
    await supabase.auth.refreshSession();
    const { data } = await supabase.auth.getUser();
    expect(data.user?.phone_confirmed_at).toBeTruthy();
    expect((await supabase.rpc("is_phone_verified")).data).toBe(true);
  });

  it("now allows creating a request", async () => {
    const { data, error } = await supabase.from("requests").insert(request).select("status").single();
    expect(error).toBeNull();
    expect(data?.status).toBe("open");
  });
});
