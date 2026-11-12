// Password recovery, loops 1–2: the reset-request action, the email-link routing and the recovery proof.
// Supabase and Cloudflare are mocked: these check our logic, not real Supabase behaviour.
import { AuthApiError } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasFreshRecovery, isTokenHash, RECOVERY_TOKEN_COOKIE, RECOVERY_WINDOW_SECONDS } from "@/lib/recovery";
import { safeNext } from "@/lib/redirect";

const auth = {
  resetPasswordForEmail: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  getClaims: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));
let visitorIp = "203.0.113.1";
// A tiny cookie jar: set() with maxAge 0 deletes, like a browser would.
const jar = new Map<string, string>();
const cookieSet = vi.fn((name: string, value: string, opts?: { maxAge?: number }) => {
  if (opts?.maxAge === 0) jar.delete(name);
  else jar.set(name, value);
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": visitorIp }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: { maxAge?: number }) => cookieSet(name, value, opts),
  }),
}));
// The reset page's gate waits for connection() before reading the clock; outside Next that's a no-op.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
const captcha = vi.fn();
vi.mock("@/lib/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/turnstile")>()),
  verifyTurnstile: (token: unknown, action: unknown) => captcha(token, action),
}));

const { requestPasswordReset } = await import("@/app/forgot-password/actions");
const { GET: confirm } = await import("@/app/auth/confirm/route");
const { resetPassword } = await import("@/app/reset-password/actions");
const { ResetFromRequest } = await import("@/app/reset-password/reset-gate");
const { ExpiredLink, ResetPasswordForm } = await import("@/app/reset-password/reset-password-form");
const { NextRequest } = await import("next/server");

const NOW = 1_800_000_000;
const TOKEN = "a".repeat(56);
// What real reset emails carry: our reset requests use PKCE, so Supabase prefixes the stored hash.
const PKCE_TOKEN = `pkce_${"0123456789abcdef".repeat(3)}01234567`;
let n = 0;
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
  return fd;
};
const apiError = (code: string, status = 400) => new AuthApiError(`raw supabase text for ${code}`, status, code);
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const fn of Object.values(auth)) fn.mockReset();
  auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  jar.clear();
  cookieSet.mockClear();
  captcha.mockReset().mockResolvedValue(true);
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  visitorIp = `203.0.113.${++n}`; // a fresh visitor per test, so the limiter doesn't leak between tests
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the recovery proof", () => {
  const amr = (method: string, timestamp: number) => ({ amr: [{ method, timestamp }] });

  it("accepts only a recovery from the last 15 minutes", () => {
    expect(hasFreshRecovery(amr("recovery", NOW - 60), NOW)).toBe(true);
    expect(hasFreshRecovery(amr("recovery", NOW - RECOVERY_WINDOW_SECONDS), NOW)).toBe(true);
    expect(hasFreshRecovery(amr("recovery", NOW - RECOVERY_WINDOW_SECONDS - 1), NOW)).toBe(false);
    expect(hasFreshRecovery(amr("recovery", NOW + 3600), NOW)).toBe(false); // never a future one
  });

  it("an ordinary signed-in session is not a recovery: password, phone-code (otp), refresh or missing amr", () => {
    for (const method of ["password", "otp", "token_refresh", "oauth", "email/signup"]) {
      expect(hasFreshRecovery(amr(method, NOW - 10), NOW), method).toBe(false);
    }
    expect(hasFreshRecovery({ amr: [{ method: "password", timestamp: NOW - 10 }, { method: "otp", timestamp: NOW - 5 }] }, NOW)).toBe(false);
    expect(hasFreshRecovery({ amr: ["recovery"] }, NOW)).toBe(false); // no timestamp, so freshness can't be shown
    expect(hasFreshRecovery({ amr: [{ method: "recovery", timestamp: String(NOW) }] }, NOW)).toBe(false);
    for (const claims of [null, undefined, {}, { amr: "recovery" }]) expect(hasFreshRecovery(claims, NOW)).toBe(false);
  });

  it("token hashes must look like Supabase's before they're stored", () => {
    expect(isTokenHash(TOKEN)).toBe(true);
    expect(isTokenHash(`pkce_${"0".repeat(56)}`)).toBe(true);
    for (const bad of ["", "short", "x".repeat(201), "a b".repeat(10), "<script>alert(1)</script>", "../../etc/passwd", null, 5]) {
      expect(isTokenHash(bad), String(bad)).toBe(false);
    }
  });

  it("?next= can never point at the recovery pages (no loops, no bouncing a session through them)", () => {
    for (const path of ["/reset-password", "/forgot-password", "/reset-password?x=1", "/forgot-password/again"]) {
      expect(safeNext(path)).toBe("/profile");
    }
  });
});

describe("requesting a reset email", () => {
  const ask = (email: string, extra: Record<string, string> = {}) => requestPasswordReset({}, form({ email, ...extra }));

  it("sends through Supabase with a fixed link back to this site's /auth/confirm", async () => {
    const result = await ask("  Asha@Example.COM ");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("asha@example.com", { redirectTo: "http://localhost:3000/auth/confirm" });
    expect(result).toEqual({ notice: expect.stringMatching(/^If an Orbitly account uses this email/) });
  });

  it("gives exactly the same reply for known and unknown addresses, and whatever Supabase says", async () => {
    const replies = [];
    for (const error of [null, apiError("over_email_send_rate_limit", 429), apiError("email_address_not_authorized"), apiError("unexpected_failure", 500)]) {
      auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error });
      replies.push(await ask(`person${++n}@example.com`));
    }
    expect(new Set(replies.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(JSON.stringify(replies)).not.toMatch(/raw supabase text|not_authorized|rate_limit/);
  });

  it("ignores any redirect or next the browser sends (invalid redirect attempts)", async () => {
    await ask("asha@example.com", { redirectTo: "https://evil.example/steal", next: "//evil.example", redirect_to: "https://evil.example" });
    expect(auth.resetPasswordForEmail.mock.calls[0][1]).toEqual({ redirectTo: "http://localhost:3000/auth/confirm" });
  });

  it("refuses to send links when SITE_URL isn't a safe address", async () => {
    for (const bad of ["", "http://evil.example", "javascript:alert(1)", "not a url"]) {
      vi.stubEnv("SITE_URL", bad);
      expect(await ask(`p${++n}@example.com`)).toMatchObject({ error: expect.stringMatching(/temporarily unavailable/) });
    }
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("checks the email format and the security check before calling Supabase", async () => {
    for (const bad of ["", "asha", "asha@", "@example.com", "a b@example.com"]) {
      expect(await ask(bad)).toMatchObject({ error: "Enter a valid email address." });
    }
    captcha.mockResolvedValue(false);
    expect(await ask("asha@example.com")).toMatchObject({ error: expect.stringMatching(/security check/) });
    expect(captcha).toHaveBeenCalledWith("XXXX.DUMMY.TOKEN.XXXX", "password_reset");
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("limits repeated requests for one address the same way whether or not it has an account", async () => {
    const email = `repeat${++n}@example.com`;
    for (let i = 0; i < 3; i++) {
      visitorIp = `198.51.100.${i}`;
      expect(await ask(email)).toHaveProperty("notice");
    }
    visitorIp = "198.51.100.99";
    expect(await ask(email)).toEqual({ error: expect.stringMatching(/Too many reset requests/), email });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(3);
  });

  it("limits one visitor asking for many addresses", async () => {
    for (let i = 0; i < 5; i++) expect(await ask(`spray${n}-${i}@example.com`)).toHaveProperty("notice");
    expect(await ask(`spray${n}-6@example.com`)).toMatchObject({ error: expect.stringMatching(/Too many/) });
  });

  it("never logs the email address or Supabase's text", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: apiError("unexpected_failure", 500) });
    await ask("secret.person@example.com");
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret\.person|example\.com|raw supabase text/);
  });
});

describe("the link in the email (/auth/confirm)", () => {
  const visit = (query: string, init?: { headers?: Record<string, string> }) =>
    confirm(new NextRequest(`http://localhost:3000/auth/confirm${query}`, init));

  it("token-hash reset link: keeps the unused token in a short-lived httpOnly cookie for /reset-password only", async () => {
    const res = await visit(`?token_hash=${TOKEN}&type=recovery`);
    expect(res.headers.get("location")).toBe("http://localhost:3000/reset-password");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${RECOVERY_TOKEN_COOKIE}=${TOKEN}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/reset-password/);
    expect(cookie).toMatch(/Max-Age=900/);
    expect(cookie).toMatch(/SameSite=lax/i);
    // Not spent here (link scanners can't use it up), and never put back into a URL.
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).not.toContain(TOKEN);
  });

  it("refuses a malformed token hash without storing it", async () => {
    const res = await visit(`?token_hash=${encodeURIComponent("<script>")}&type=recovery`);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=link_invalid");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("PKCE reset link: goes to /reset-password only when Supabase marks the session as a fresh recovery", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { access_token: "jwt" } }, error: null });
    auth.getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "recovery", timestamp: Math.floor(Date.now() / 1000) - 5 }] } }, error: null });
    expect((await visit("?code=abc")).headers.get("location")).toBe("http://localhost:3000/reset-password");
    expect(auth.getClaims).toHaveBeenCalledWith("jwt");
  });

  it("sign-up confirmation (PKCE or token hash) still continues to phone verification", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { access_token: "jwt" } }, error: null });
    auth.getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null });
    expect((await visit("?code=abc")).headers.get("location")).toBe("http://localhost:3000/verify-phone");
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "jwt" } }, error: null });
    expect((await visit(`?token_hash=${TOKEN}&type=email`)).headers.get("location")).toBe("http://localhost:3000/verify-phone");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: TOKEN });
  });

  it("expired, used or other-browser PKCE links get the fixed link error, with no raw text", async () => {
    for (const code of ["flow_state_expired", "flow_state_not_found", "bad_code_verifier", "otp_expired"]) {
      auth.exchangeCodeForSession.mockResolvedValueOnce({ data: { session: null }, error: apiError(code) });
      const res = await visit("?code=abc");
      expect(res.headers.get("location"), code).toBe("http://localhost:3000/login?error=link_invalid");
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("raw supabase text");
  });

  it("nothing in the link chooses the destination (open-redirect attempts)", async () => {
    vi.stubEnv("SITE_URL", "https://orbitly.example");
    for (const query of [
      `?token_hash=${TOKEN}&type=recovery&next=https://evil.example`,
      `?token_hash=${TOKEN}&type=recovery&redirect_to=//evil.example`,
    ]) {
      const res = await confirm(new NextRequest(`http://evil.example/auth/confirm${query}`, { headers: { host: "evil.example" } }));
      expect(res.headers.get("location")).toBe("https://orbitly.example/reset-password");
    }
  });
});

describe("setting the new password (/reset-password)", () => {
  const PASSWORD = "NewPassw0rd";
  const submit = (password = PASSWORD, confirm = password) => resetPassword({}, form({ password, confirm }));
  const nowS = () => Math.floor(Date.now() / 1000);
  const claims = (method: string, ageSeconds = 5) => ({ data: { claims: { amr: [{ method, timestamp: nowS() - ageSeconds }] } }, error: null });
  const cleared = () => cookieSet.mock.calls.some(([name, value, opts]) => name === RECOVERY_TOKEN_COOKIE && value === "" && opts?.maxAge === 0);
  const withToken = (value = TOKEN) => jar.set(RECOVERY_TOKEN_COOKIE, value);

  beforeEach(() => {
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "jwt" } }, error: null });
    auth.updateUser.mockResolvedValue({ data: {}, error: null });
    auth.signOut.mockResolvedValue({ error: null });
    auth.getClaims.mockResolvedValue({ data: null, error: null }); // no session unless a test says so
  });

  it("token-hash recovery: verifies the token at submit, clears it, updates the password and signs out everywhere", async () => {
    withToken();
    await expect(submit()).rejects.toThrow("REDIRECT /login?reset=done");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: TOKEN });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(auth.verifyOtp.mock.invocationCallOrder[0]).toBeLessThan(auth.updateUser.mock.invocationCallOrder[0]);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(cleared()).toBe(true);
    expect(jar.has(RECOVERY_TOKEN_COOKIE)).toBe(false);
  });

  it("PKCE recovery: a fresh 'recovery' session can update the password; no token is involved", async () => {
    auth.getClaims.mockResolvedValue(claims("recovery"));
    await expect(submit()).rejects.toThrow("REDIRECT /login?reset=done");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it.each([
    ["an ordinary signed-in session", () => auth.getClaims.mockResolvedValue(claims("password"))],
    ["a session from a phone-code (OTP) check", () => auth.getClaims.mockResolvedValue(claims("otp"))],
    ["a recovery older than 15 minutes", () => auth.getClaims.mockResolvedValue(claims("recovery", RECOVERY_WINDOW_SECONDS + 1))],
    ["no session and no token", () => auth.getClaims.mockResolvedValue({ data: null, error: null })],
  ])("refuses %s, without touching the password", async (_name, setup) => {
    setup();
    expect(await submit()).toEqual({ error: expect.stringMatching(/invalid, has expired or was already used/), expired: true });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("refuses and clears a malformed token without sending it to Supabase", async () => {
    withToken("<script>alert(1)</script>");
    expect(await submit()).toMatchObject({ expired: true });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(cleared()).toBe(true);
  });

  it.each(["otp_expired", "flow_state_not_found", "validation_failed"])("an expired or already-used token (%s) is cleared and refused", async (code) => {
    withToken();
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: apiError(code, 403) });
    expect(await submit()).toEqual({ error: expect.stringMatching(/Request a new one/), expired: true });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(cleared()).toBe(true);
  });

  it("an ordinary signed-in session doesn't rescue a dead token", async () => {
    withToken();
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: apiError("otp_expired", 403) });
    auth.getClaims.mockResolvedValue(claims("password"));
    expect(await submit()).toMatchObject({ expired: true });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("when Supabase is rate-limiting, the token is kept (not spent) so the user can try again", async () => {
    withToken();
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: apiError("over_request_rate_limit", 429) });
    expect(await submit()).toEqual({ error: expect.stringMatching(/Too many attempts/) });
    expect(cleared()).toBe(false);
    expect(jar.get(RECOVERY_TOKEN_COOKIE)).toBe(TOKEN);
  });

  it.each([
    ["too short", "abc1", "abc1", /at least 8/],
    ["no number", "onlyletters", "onlyletters", /letters and numbers/],
    ["over 72 characters", `a1${"x".repeat(71)}`, `a1${"x".repeat(71)}`, /at most 72/],
    ["not matching", PASSWORD, "NewPassw0rd!", /don’t match/],
  ])("validates on the server before spending anything: %s", async (_name, password, confirm, message) => {
    withToken();
    expect(await submit(password, confirm)).toEqual({ error: expect.stringMatching(message) });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(jar.get(RECOVERY_TOKEN_COOKIE)).toBe(TOKEN);
  });

  it("a duplicate submission after success can't change the password again", async () => {
    withToken();
    await expect(submit()).rejects.toThrow("REDIRECT /login?reset=done");
    // The cookie is gone and every session was signed out, so the second try has no proof.
    expect(await submit()).toMatchObject({ expired: true });
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it("if Supabase rejects the new password after the token was spent: clear message, local sign-out, no success claimed", async () => {
    withToken();
    auth.updateUser.mockResolvedValue({ data: null, error: apiError("same_password", 422) });
    const result = await submit();
    expect(result).toEqual({ error: expect.stringMatching(/must be different.*Request a new reset link/), expired: true });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(auth.signOut).not.toHaveBeenCalledWith({ scope: "global" });
    expect(cleared()).toBe(true);
  });

  it("PKCE: a rejected new password can be retried while the recovery is still fresh", async () => {
    auth.getClaims.mockResolvedValue(claims("recovery"));
    auth.updateUser.mockResolvedValue({ data: null, error: apiError("weak_password", 422) });
    expect(await submit()).toEqual({ error: expect.stringMatching(/stronger password/) });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("if signing out other devices fails, says so honestly (the password did change) and signs out this browser", async () => {
    withToken();
    auth.signOut.mockImplementation(async ({ scope }: { scope: string }) => ({ error: scope === "global" ? apiError("unexpected_failure", 500) : null }));
    await expect(submit()).rejects.toThrow("REDIRECT /login?reset=signout_failed");
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("never logs the token, the password or Supabase's text", async () => {
    withToken();
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: apiError("otp_expired", 403) });
    await submit();
    withToken();
    auth.verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });
    auth.updateUser.mockResolvedValue({ data: null, error: apiError("weak_password", 422) });
    await submit();
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(new RegExp(`${TOKEN}|${PASSWORD}|raw supabase text`));
  });
});

describe("realistic pkce_-prefixed token hashes (what real emails carry)", () => {
  beforeEach(() => {
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "jwt" } }, error: null });
    auth.updateUser.mockResolvedValue({ data: {}, error: null });
    auth.signOut.mockResolvedValue({ error: null });
  });

  it("the callback stores the prefixed token unchanged, unspent, and redirects to a clean URL", async () => {
    const res = await confirm(new NextRequest(`http://localhost:3000/auth/confirm?token_hash=${PKCE_TOKEN}&type=recovery`));
    expect(res.headers.get("location")).toBe("http://localhost:3000/reset-password");
    expect(res.cookies.get(RECOVERY_TOKEN_COOKIE)?.value).toBe(PKCE_TOKEN);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("the reset action sends the prefixed token to Supabase exactly as stored", async () => {
    jar.set(RECOVERY_TOKEN_COOKIE, PKCE_TOKEN);
    await expect(resetPassword({}, form({ password: "NewPassw0rd", confirm: "NewPassw0rd" }))).rejects.toThrow("REDIRECT /login?reset=done");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: PKCE_TOKEN });
    expect(jar.has(RECOVERY_TOKEN_COOKIE)).toBe(false);
  });
});

describe("the whole token-hash path with one shared cookie jar", () => {
  beforeEach(() => {
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "jwt" } }, error: null });
    auth.updateUser.mockResolvedValue({ data: {}, error: null });
    auth.signOut.mockResolvedValue({ error: null });
    auth.getClaims.mockResolvedValue({ data: null, error: null }); // no session in this browser
  });

  it("callback → cookie → page shows the form → reset → cookie cleared → page and action refuse a replay", async () => {
    // 1. The email link: the browser stores the cookie it's given, with its attributes.
    const res = await confirm(new NextRequest(`http://localhost:3000/auth/confirm?token_hash=${PKCE_TOKEN}&type=recovery`));
    const cookie = res.cookies.get(RECOVERY_TOKEN_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, path: "/reset-password", sameSite: "lax", maxAge: RECOVERY_WINDOW_SECONDS });
    jar.set(cookie.name, cookie.value); // sent back only on /reset-password, which is where the page and its action live

    // 2. The page offers the form, without spending anything or handing the token to the browser.
    const page = await ResetFromRequest();
    expect(page.type).toBe(ResetPasswordForm);
    expect(renderToStaticMarkup(page)).not.toContain(PKCE_TOKEN);
    expect(auth.verifyOtp).not.toHaveBeenCalled();

    // 3. Submitting spends the token, changes the password and clears the cookie.
    await expect(resetPassword({}, form({ password: "NewPassw0rd", confirm: "NewPassw0rd" }))).rejects.toThrow("REDIRECT /login?reset=done");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: PKCE_TOKEN });
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(jar.has(RECOVERY_TOKEN_COOKIE)).toBe(false);

    // 4. Back button or a second submit: no proof left.
    expect((await ResetFromRequest()).type).toBe(ExpiredLink);
    expect(await resetPassword({}, form({ password: "NewPassw0rd", confirm: "NewPassw0rd" }))).toMatchObject({ expired: true });
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
  });
});

describe("the reset page's states (/reset-password)", () => {
  const nowS = () => Math.floor(Date.now() / 1000);
  const session = (method: string, ageSeconds = 5) => auth.getClaims.mockResolvedValue({ data: { claims: { amr: [{ method, timestamp: nowS() - ageSeconds }] } }, error: null });

  beforeEach(() => auth.getClaims.mockResolvedValue({ data: null, error: null }));

  it.each([["a plain token hash", TOKEN], ["a pkce_-prefixed token hash", PKCE_TOKEN]])("%s in the cookie: shows the form, never the token", async (_name, token) => {
    jar.set(RECOVERY_TOKEN_COOKIE, token);
    const page = await ResetFromRequest();
    expect(page.type).toBe(ResetPasswordForm);
    const html = renderToStaticMarkup(page);
    expect(html).toContain('name="password"');
    expect(html).toContain('name="confirm"');
    expect(html).not.toContain(token);
    expect(JSON.stringify(page.props)).not.toContain(token);
    expect(auth.verifyOtp).not.toHaveBeenCalled(); // nothing is spent on page load
  });

  it("a fresh PKCE recovery session (no cookie): shows the form", async () => {
    session("recovery");
    expect((await ResetFromRequest()).type).toBe(ResetPasswordForm);
  });

  it.each<[string, () => void]>([
    ["no cookie and no session", () => {}],
    ["a malformed cookie", () => jar.set(RECOVERY_TOKEN_COOKIE, "<script>")],
    ["an ordinary signed-in session", () => session("password")],
    ["a phone-code (otp) session", () => session("otp")],
    ["a recovery older than 15 minutes", () => session("recovery", RECOVERY_WINDOW_SECONDS + 1)],
  ])("%s: shows the expired-link message and no form", async (_name, setup) => {
    setup();
    const page = await ResetFromRequest();
    expect(page.type).toBe(ExpiredLink);
    const html = renderToStaticMarkup(page);
    expect(html).toContain("invalid, has expired or was already used");
    expect(html).toContain('href="/forgot-password"');
    expect(html).not.toContain('name="password"');
  });
});

describe("logging Supabase's link errors without leaking anything", () => {
  const visit = (query: string) => confirm(new NextRequest(`http://localhost:3000/auth/confirm${query}`));
  const logged = () => JSON.stringify(log.mock.calls);

  it("logs Supabase's error_code from the allowlist, and nothing else from the URL", async () => {
    const res = await visit("?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=link_invalid");
    expect(log).toHaveBeenCalledWith("[auth] email link failed", { code: "otp_expired" });
    expect(logged()).not.toMatch(/access_denied|Email link|error_description/);
  });

  it("an unknown or hostile error_code is logged only as 'other'; a bare visit as 'missing'", async () => {
    await visit(`?error_code=${encodeURIComponent(`<script>${PKCE_TOKEN}</script>`)}`);
    expect(log).toHaveBeenLastCalledWith("[auth] email link failed", { code: "other" });
    await visit("");
    expect(log).toHaveBeenLastCalledWith("[auth] email link failed", { code: "missing" });
    expect(logged()).not.toContain(PKCE_TOKEN);
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("failed code exchanges and token checks log only Supabase's error code, never the code or token", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: apiError("bad_code_verifier") });
    await visit("?code=11111111-2222-4333-8444-555555555555");
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: apiError("otp_expired", 403) });
    await visit(`?token_hash=${PKCE_TOKEN}&type=email`);
    expect(logged()).not.toMatch(new RegExp(`11111111-2222|${PKCE_TOKEN}|raw supabase text`));
  });
});
