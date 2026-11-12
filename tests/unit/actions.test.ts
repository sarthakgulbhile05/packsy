// Server actions with Supabase and Cloudflare mocked: these check our logic (validation, error
// handling, redirects, never trusting the browser), not real Supabase behaviour.
import { AuthApiError, type User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
};
const profilesUpdate = { eq: vi.fn() };
const from = vi.fn(() => ({ update: vi.fn(() => profilesUpdate) }));
const createClient = vi.fn<(opts?: { sessionOnly?: boolean }) => Promise<{ auth: typeof auth; from: typeof from }>>(
  async () => ({ auth, from }),
);
// verifyOtp's own client: a session it receives never reaches the login cookie.
const verifier = { verifyOtp: vi.fn(), signOut: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({
  createClient: (opts?: { sessionOnly?: boolean }) => createClient(opts),
  createStatelessClient: () => ({ auth: verifier }),
}));
const cookieJar = { set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));

const captcha = vi.fn();
vi.mock("@/lib/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/turnstile")>()),
  verifyTurnstile: (token: unknown, action: unknown) => captcha(token, action),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { login } = await import("@/app/login/actions");
const { signup } = await import("@/app/signup/actions");
const { phoneAction } = await import("@/app/verify-phone/actions");
const { updateProfile, logout } = await import("@/app/profile/actions");
const { GET: confirm } = await import("@/app/auth/confirm/route");
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
const { NextRequest } = await import("next/server");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
  return fd;
};
const apiError = (code: string, status = 400) => new AuthApiError(`raw supabase text for ${code}`, status, code);
const VERIFIED_AT = "2026-10-27T00:00:00Z";
const user = (extra: Partial<User> = {}) => ({ id: "u1", email: "a@orbitly.test", phone: "", ...extra }) as User;

beforeEach(() => {
  for (const fn of Object.values(auth)) fn.mockReset();
  verifier.verifyOtp.mockReset();
  verifier.signOut.mockReset().mockResolvedValue({ error: null });
  captcha.mockReset().mockResolvedValue(true);
  profilesUpdate.eq.mockReset().mockResolvedValue({ error: null });
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("login", () => {
  beforeEach(() => {
    cookieJar.set.mockReset();
    cookieJar.delete.mockReset();
    createClient.mockClear();
  });

  it("Remember me ticked: normal persistent session, marker cookie removed", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: user() }, error: null });
    await expect(login({}, form({ email: "a@orbitly.test", password: "secret123", remember: "on" }))).rejects.toThrow("REDIRECT");
    expect(createClient).toHaveBeenCalledWith({ sessionOnly: false });
    expect(cookieJar.delete).toHaveBeenCalledWith("orbitly_session_only");
    expect(cookieJar.set).not.toHaveBeenCalled();
  });

  it("Remember me unticked: browser-session cookies plus an httpOnly marker", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: user() }, error: null });
    await expect(login({}, form({ email: "a@orbitly.test", password: "secret123" }))).rejects.toThrow("REDIRECT");
    expect(createClient).toHaveBeenCalledWith({ sessionOnly: true });
    expect(cookieJar.set).toHaveBeenCalledWith("orbitly_session_only", "1", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });

  it("doesn't touch the Remember-me marker when login fails", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: apiError("invalid_credentials") });
    await login({}, form({ email: "a@orbitly.test", password: "wrong1234" }));
    expect(cookieJar.set).not.toHaveBeenCalled();
    expect(cookieJar.delete).not.toHaveBeenCalled();
  });

  it("logout clears the Remember-me marker", async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await expect(logout()).rejects.toThrow("REDIRECT /login");
    expect(cookieJar.delete).toHaveBeenCalledWith("orbitly_session_only");
  });

  it("rejects bad input before calling CAPTCHA or Supabase", async () => {
    const state = await login({}, form({ email: "not-an-email", password: "x" }));
    expect(state.error).toMatch(/email address and password/);
    expect(captcha).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("stops when the CAPTCHA fails", async () => {
    captcha.mockResolvedValue(false);
    const state = await login({}, form({ email: "a@orbitly.test", password: "secret123" }));
    expect(state.error).toMatch(/security check/);
    expect(captcha).toHaveBeenCalledWith("XXXX.DUMMY.TOKEN.XXXX", "login");
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("shows a friendly error, keeps the email, and never the raw Supabase text", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: apiError("invalid_credentials") });
    const state = await login({}, form({ email: "a@orbitly.test", password: "wrong1234" }));
    expect(state).toEqual({ error: "Incorrect email or password.", email: "a@orbitly.test" });
  });

  it("sends unverified users to phone verification, keeping a safe return path", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: user() }, error: null });
    await expect(
      login({}, form({ email: "a@orbitly.test", password: "secret123", next: "/requests/1" })),
    ).rejects.toThrow("REDIRECT /verify-phone?next=%2Frequests%2F1");
  });

  it("sends verified users to their page, ignoring off-site ?next=", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: user({ phone: "919000000001", phone_confirmed_at: VERIFIED_AT }) },
      error: null,
    });
    await expect(
      login({}, form({ email: "a@orbitly.test", password: "secret123", next: "https://evil.example" })),
    ).rejects.toThrow("REDIRECT /profile");
  });
});

describe("signup", () => {
  const valid = { full_name: "Asha", email: "a@orbitly.test", password: "secret123" };

  it("validates name, email and password strength", async () => {
    expect((await signup({}, form({ ...valid, full_name: "x".repeat(101) }))).error).toMatch(/100 characters/);
    expect((await signup({}, form({ ...valid, email: "nope" }))).error).toMatch(/valid email/);
    expect((await signup({}, form({ ...valid, password: "password" }))).error).toMatch(/letters and numbers/);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("builds the email link from SITE_URL, not request headers", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const state = await signup({}, form(valid));
    expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe("http://localhost:3000/auth/confirm");
    expect(state.notice).toMatch(/Check your email/);
  });

  it("refuses to sign up when SITE_URL is missing", async () => {
    vi.stubEnv("SITE_URL", "");
    const state = await signup({}, form(valid));
    expect(state.error).toMatch(/temporarily unavailable/);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("gives the same reply for an existing email, so accounts can't be discovered", async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: apiError("user_already_exists", 422) });
    auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: null });
    const fresh = await signup({}, form(valid));
    const existing = await signup({}, form(valid));
    expect(existing).toEqual(fresh);
  });

  it("stops when the CAPTCHA fails", async () => {
    captcha.mockResolvedValue(false);
    expect((await signup({}, form(valid))).error).toMatch(/security check/);
    expect(captcha).toHaveBeenCalledWith("XXXX.DUMMY.TOKEN.XXXX", "signup");
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("says sign-ups are closed when Supabase refuses new users (dashboard setting off)", async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: apiError("signup_disabled", 422) });
    expect((await signup({}, form(valid))).error).toBe("Sign-ups are currently closed.");
  });
});

describe("phone verification", () => {
  const pending = user({ new_phone: "919000000001" });

  it("sends logged-out visitors to login", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(phoneAction({ step: "phone" }, form({ intent: "send" }))).rejects.toThrow("REDIRECT /login");
  });

  it("forwards already-verified users instead of sending another code", async () => {
    auth.getUser.mockResolvedValue({ data: { user: user({ phone: "919000000001", phone_confirmed_at: VERIFIED_AT }) } });
    await expect(phoneAction({ step: "phone" }, form({ intent: "send", next: "/requests/1" }))).rejects.toThrow(
      "REDIRECT /requests/1",
    );
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects invalid numbers without contacting Supabase", async () => {
    auth.getUser.mockResolvedValue({ data: { user: user() } });
    const state = await phoneAction({ step: "phone" }, form({ intent: "send", country: "IN", phone: "12345" }));
    expect(state).toMatchObject({ step: "phone", error: expect.stringMatching(/valid mobile number/) });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("requires the CAPTCHA before requesting a code", async () => {
    auth.getUser.mockResolvedValue({ data: { user: user() } });
    captcha.mockResolvedValue(false);
    const state = await phoneAction({ step: "phone" }, form({ intent: "send", country: "IN", phone: "9000000001" }));
    expect(state.error).toMatch(/security check/);
    expect(captcha).toHaveBeenCalledWith("XXXX.DUMMY.TOKEN.XXXX", "phone");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("requests a code through Supabase and shows only the masked number", async () => {
    auth.getUser.mockResolvedValue({ data: { user: user() } });
    auth.updateUser.mockResolvedValue({ error: null });
    const state = await phoneAction({ step: "phone" }, form({ intent: "send", country: "IN", phone: "90000 00001" }));
    expect(auth.updateUser).toHaveBeenCalledWith({ phone: "+919000000001" });
    expect(state).toMatchObject({ step: "code", maskedPhone: "+91 ••••••0001", sentAt: expect.any(Number) });
    expect(JSON.stringify(state)).not.toContain("9000000001");
  });

  it.each([
    ["over_sms_send_rate_limit", 429, /wait a minute/],
    ["phone_exists", 422, /can't be used/],
    ["sms_send_failed", 500, /couldn't send a code/],
  ])("handles %s when sending", async (code, status, message) => {
    auth.getUser.mockResolvedValue({ data: { user: user() } });
    auth.updateUser.mockResolvedValue({ error: apiError(code, status) });
    const state = await phoneAction({ step: "phone" }, form({ intent: "send", country: "IN", phone: "9000000001" }));
    expect(state).toMatchObject({ step: "phone", error: expect.stringMatching(message) });
  });

  it("blocks resending within 60 seconds", async () => {
    auth.getUser.mockResolvedValue({ data: { user: pending } });
    const state = await phoneAction({ step: "code", sentAt: Date.now() - 10_000 }, form({ intent: "resend" }));
    expect(state.error).toMatch(/wait a minute/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("resends to the number Supabase has pending, not one from the browser", async () => {
    auth.getUser.mockResolvedValue({ data: { user: pending } });
    auth.updateUser.mockResolvedValue({ error: null });
    await phoneAction({ step: "code", sentAt: Date.now() - 61_000 }, form({ intent: "resend", phone: "9999999999" }));
    expect(auth.updateUser).toHaveBeenCalledWith({ phone: "+919000000001" });
  });

  it("rejects codes that aren't 6 digits without calling Supabase", async () => {
    auth.getUser.mockResolvedValue({ data: { user: pending } });
    for (const code of ["12345", "1234567", "abcdef", ""]) {
      const state = await phoneAction({ step: "code" }, form({ intent: "verify", code }));
      expect(state.error).toMatch(/6-digit code/);
    }
    expect(verifier.verifyOtp).not.toHaveBeenCalled();
  });

  it("reports wrong or expired codes without claiming success", async () => {
    auth.getUser.mockResolvedValue({ data: { user: pending } });
    verifier.verifyOtp.mockResolvedValue({ error: apiError("otp_expired", 403) });
    const state = await phoneAction({ step: "code" }, form({ intent: "verify", code: "000000" }));
    expect(verifier.verifyOtp).toHaveBeenCalledWith({ phone: "919000000001", token: "000000", type: "phone_change" });
    expect(state).toMatchObject({ step: "code", error: expect.stringMatching(/incorrect or has expired/) });
  });

  it("handles verification rate limits", async () => {
    auth.getUser.mockResolvedValue({ data: { user: pending } });
    verifier.verifyOtp.mockResolvedValue({ error: apiError("over_request_rate_limit", 429) });
    const state = await phoneAction({ step: "code" }, form({ intent: "verify", code: "123456" }));
    expect(state.error).toMatch(/Too many attempts/);
  });

  it("asks for a new code when nothing is pending", async () => {
    auth.getUser.mockResolvedValue({ data: { user: user() } });
    const state = await phoneAction({ step: "code" }, form({ intent: "verify", code: "123456" }));
    expect(state).toMatchObject({ step: "phone", error: expect.stringMatching(/request a new one/) });
    expect(verifier.verifyOtp).not.toHaveBeenCalled();
  });

  it("only redirects after Supabase confirms the phone", async () => {
    auth.getUser
      .mockResolvedValueOnce({ data: { user: pending } })
      .mockResolvedValueOnce({ data: { user: user({ phone: "919000000001", phone_confirmed_at: VERIFIED_AT }) } });
    verifier.verifyOtp.mockResolvedValue({ data: { user: pending }, error: null });
    await expect(
      phoneAction({ step: "code" }, form({ intent: "verify", code: "123456", next: "/requests/1" })),
    ).rejects.toThrow("REDIRECT /requests/1");
  });

  it("does not claim success if Supabase doesn't show the phone as confirmed", async () => {
    auth.getUser.mockResolvedValueOnce({ data: { user: pending } }).mockResolvedValueOnce({ data: { user: pending } });
    verifier.verifyOtp.mockResolvedValue({ data: { user: pending }, error: null });
    const state = await phoneAction({ step: "code" }, form({ intent: "verify", code: "123456" }));
    expect(state.error).toMatch(/couldn't confirm/);
  });

  it("ignores a browser-supplied 'verified' or masked number in the previous state", async () => {
    auth.getUser.mockResolvedValue({ data: { user: pending } });
    const spoofed = { step: "code", maskedPhone: "+1 fake", verified: true } as never;
    const state = await phoneAction(spoofed, form({ intent: "verify", code: "12" }));
    expect(state.maskedPhone).toBe("+91 ••••••0001");
  });
  describe("when the code belongs to another account", () => {
    // Auth's /verify finds the account by pending number, not by session. A fixed test code therefore confirmed
    // a number on orbitly-test-1 (pending since October) for someone signed in to a different account.
    const other = user({ id: "orbitly-test-1", phone: "919000000001", phone_confirmed_at: VERIFIED_AT });
    const verifyInSession = () => phoneAction({ step: "code" }, form({ intent: "verify", code: "123456", next: "/requests/1" }));

    it("keeps the signed-in session and doesn't accept the switch", async () => {
      cookieJar.set.mockReset();
      auth.getUser.mockResolvedValue({ data: { user: pending } });
      verifier.verifyOtp.mockResolvedValue({ data: { user: other, session: { access_token: "other" } }, error: null });
      const state = await verifyInSession();
      expect(state).toMatchObject({ step: "phone", error: expect.stringMatching(/another Orbitly account/) });
      expect(state.error).toMatch(/still signed in/);
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(cookieJar.set).not.toHaveBeenCalled();
    });

    it("ends the other account's session", async () => {
      auth.getUser.mockResolvedValue({ data: { user: pending } });
      verifier.verifyOtp.mockResolvedValue({ data: { user: other, session: { access_token: "other" } }, error: null });
      await verifyInSession();
      expect(verifier.signOut).toHaveBeenCalledWith({ scope: "local" });
    });

    it("fails closed if Auth names no account", async () => {
      auth.getUser.mockResolvedValue({ data: { user: pending } });
      verifier.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });
      const state = await verifyInSession();
      expect(state).toMatchObject({ step: "phone", error: expect.stringMatching(/another Orbitly account/) });
    });

    it("doesn't redirect if the session ends up on another account", async () => {
      auth.getUser.mockResolvedValueOnce({ data: { user: pending } }).mockResolvedValueOnce({ data: { user: other } });
      verifier.verifyOtp.mockResolvedValue({ data: { user: pending, session: null }, error: null });
      expect((await verifyInSession()).error).toMatch(/couldn't confirm/);
    });
  });

});

describe("profile", () => {
  it("saves only for the logged-in user and reports success", async () => {
    auth.getUser.mockResolvedValue({ data: { user: user() } });
    expect(await updateProfile({}, form({ full_name: "  Asha  " }))).toEqual({ notice: "Saved." });
    expect(profilesUpdate.eq).toHaveBeenCalledWith("id", "u1");
  });

  it("hides database error details", async () => {
    auth.getUser.mockResolvedValue({ data: { user: user() } });
    profilesUpdate.eq.mockResolvedValue({ error: { code: "42501", message: "permission denied for table profiles" } });
    const state = await updateProfile({}, form({ full_name: "Asha" }));
    expect(state.error).toBe("We couldn't save your profile. Please try again.");
  });

  it("rejects over-long names", async () => {
    auth.getUser.mockResolvedValue({ data: { user: user() } });
    expect((await updateProfile({}, form({ full_name: "x".repeat(101) }))).error).toMatch(/100 characters/);
  });
});

describe("email confirmation link", () => {
  const visit = (query: string) => confirm(new NextRequest(`http://localhost:3000/auth/confirm${query}`));

  it("continues to phone verification after a valid link", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await visit("?code=abc");
    expect(res.headers.get("location")).toBe("http://localhost:3000/verify-phone");
  });

  it("uses a fixed error code (no raw text) for bad links", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: apiError("flow_state_expired") });
    const res = await visit("?code=abc");
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=link_invalid");
    const missing = await visit("");
    expect(missing.headers.get("location")).toBe("http://localhost:3000/login?error=link_invalid");
  });

  it("redirects to SITE_URL, not to a forged Host header", async () => {
    vi.stubEnv("SITE_URL", "https://orbitly.example");
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await confirm(
      new NextRequest("http://evil.example/auth/confirm?code=abc", { headers: { host: "evil.example" } }),
    );
    expect(res.headers.get("location")).toBe("https://orbitly.example/verify-phone");
  });
});
