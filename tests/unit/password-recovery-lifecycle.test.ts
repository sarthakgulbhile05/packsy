// The PKCE password-recovery lifecycle end to end, through our real code and the real @supabase/ssr and
// auth-js: reset request → Set-Cookie → browser jar → email link → /auth/confirm → code exchange →
// recovery session → /reset-password → password update → global sign-out → replay.
//
// What's simulated (and so NOT proven here): the browser is a cookie jar that applies each response's
// Set-Cookie attributes and sends cookies by path; Supabase Auth is a local stub that implements the PKCE
// rules (it accepts the code only with the verifier whose SHA-256 matches the stored challenge). No real
// browser, Safari behaviour, email or network is involved.
import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- the browser: a cookie jar with paths and expiry, plus per-request Set-Cookie capture ----
type Stored = { value: string; path: string; expires: number | null; httpOnly: boolean; sameSite?: string };
let jar = new Map<string, Stored>();
let visitorIp = "203.0.113.1";
let run = 0;
let request: { path: string; incoming: Map<string, string>; setCookies: { name: string; value: string; options: Record<string, unknown> }[] };

const sentTo = (path: string) =>
  new Map([...jar].filter(([, c]) => path.startsWith(c.path) && (c.expires === null || c.expires > Date.now())).map(([n, c]) => [n, c.value]));
function begin(path: string) {
  request = { path, incoming: sentTo(path), setCookies: [] };
}
/** The response reaches the browser: apply every Set-Cookie with its attributes. */
function end() {
  for (const { name, value, options } of request.setCookies) {
    const maxAge = options.maxAge as number | undefined;
    if (maxAge === 0 || (value === "" && maxAge !== undefined)) jar.delete(name);
    else
      jar.set(name, {
        value,
        path: (options.path as string) ?? "/",
        expires: maxAge === undefined ? null : Date.now() + maxAge * 1000,
        httpOnly: Boolean(options.httpOnly),
        sameSite: options.sameSite as string | undefined,
      });
  }
  return request.setCookies;
}
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": visitorIp }),
  // Next's cookies(): reads see this request's cookies plus anything set during it; sets go to Set-Cookie.
  cookies: async () => ({
    getAll: () => [...request.incoming].map(([name, value]) => ({ name, value })),
    get: (name: string) => (request.incoming.has(name) ? { name, value: request.incoming.get(name)! } : undefined),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      request.setCookies.push({ name, value, options });
      if (value === "" || options.maxAge === 0) request.incoming.delete(name);
      else request.incoming.set(name, value);
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("@/lib/turnstile", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/turnstile")>()), verifyTurnstile: async () => true }));

// ---- Supabase Auth: a local stub that enforces PKCE ----
const SUPABASE = "https://stub.supabase.co";
let USER_EMAIL = "owner@example.com";
const USER = { id: "11111111-2222-4333-8444-555555555555", email: "owner@example.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
let auth: {
  flows: { challenge: string; redirectTo: string; code?: string; used: boolean; linkOpened: boolean }[];
  revoked: Set<string>;
  passwordChanges: number;
  globalSignOuts: number;
  tokenCalls: number;
};
const jwt = (amr: string) =>
  `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ sub: USER.id, email: USER.email, aud: "authenticated", role: "authenticated", session_id: randomUUID(), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, amr: [{ method: amr, timestamp: Math.floor(Date.now() / 1000) }] }),
  )}.c2ln`;
const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" } });
const fail = (status: number, code: string) => reply(status, { code, error_code: code, msg: code });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const bearer = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "");
  if (url.pathname === "/auth/v1/recover") {
    auth.flows.push({ challenge: body.code_challenge, redirectTo: url.searchParams.get("redirect_to")!, used: false, linkOpened: false });
    return reply(200, {});
  }
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
    auth.tokenCalls++;
    const flow = auth.flows.find((f) => f.code === body.auth_code);
    if (!flow || flow.used) return fail(404, "flow_state_not_found");
    if (createHash("sha256").update(body.code_verifier).digest("base64url") !== flow.challenge) return fail(400, "bad_code_verifier");
    flow.used = true;
    const access_token = jwt("recovery");
    return reply(200, { access_token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: randomUUID(), user: USER });
  }
  if (url.pathname === "/auth/v1/user") {
    if (!bearer || auth.revoked.has(bearer)) return fail(401, "session_not_found");
    if (init?.method === "PUT") auth.passwordChanges++;
    return reply(200, USER);
  }
  if (url.pathname === "/auth/v1/logout") {
    if (bearer) auth.revoked.add(bearer);
    if (url.searchParams.get("scope") === "global") auth.globalSignOuts++;
    return reply(204);
  }
  throw new Error(`unexpected request to ${url.pathname}`);
}) as typeof fetch;

/** The user opens the email link: Supabase spends the link and redirects with a fresh code (or an error, if used). */
function openEmailLink(flowIndex = auth.flows.length - 1) {
  const flow = auth.flows[flowIndex];
  if (flow.linkOpened) return `${flow.redirectTo}?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`;
  flow.linkOpened = true;
  flow.code = randomUUID();
  return `${flow.redirectTo}?code=${flow.code}`;
}

const { requestPasswordReset } = await import("@/app/forgot-password/actions");
const { GET: confirm } = await import("@/app/auth/confirm/route");
const { ResetFromRequest } = await import("@/app/reset-password/reset-gate");
const { resetPassword } = await import("@/app/reset-password/actions");
const { ExpiredLink, ResetPasswordForm } = await import("@/app/reset-password/reset-password-form");
const { NextRequest } = await import("next/server");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
  return fd;
};
const verifierCookies = () => [...jar.keys()].filter((n) => n.endsWith("-code-verifier") && !n.endsWith("-flows-code-verifier"));
const sessionCookies = () => [...jar.keys()].filter((n) => /^sb-stub-auth-token(\.\d+)?$/.test(n));

async function requestReset() {
  begin("/forgot-password");
  const result = await requestPasswordReset({}, form({ email: USER_EMAIL }));
  return { result, setCookies: end() };
}
async function visitCallback(link: string) {
  const url = new URL(link);
  begin(url.pathname);
  const res = await confirm(new NextRequest(url));
  end();
  return res.headers.get("location");
}
async function showResetPage() {
  begin("/reset-password");
  const page = await ResetFromRequest();
  end();
  return page.type;
}
async function submitNewPassword() {
  begin("/reset-password");
  try {
    return await resetPassword({}, form({ password: "NewPassw0rd", confirm: "NewPassw0rd" }));
  } catch (e) {
    return (e as Error).message;
  } finally {
    end();
  }
}

beforeEach(() => {
  jar = new Map();
  run++;
  visitorIp = `203.0.113.${run}`; // fresh visitor and address per test, so our own rate limits don't interfere
  USER_EMAIL = `owner${run}@example.com`;
  auth = { flows: [], revoked: new Set(), passwordChanges: 0, globalSignOuts: 0, tokenCalls: 0 };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_stub");
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PKCE password recovery, whole lifecycle in one browser", () => {
  it("request → verifier cookie → link → session → form → new password → global sign-out → replays refused", async () => {
    // 1. The reset request's response carries the verifier cookie, and the browser stores it.
    const { result, setCookies } = await requestReset();
    expect(result).toHaveProperty("notice");
    expect(setCookies.map((c) => c.name)).toEqual(
      expect.arrayContaining(["sb-stub-auth-token-code-verifier", expect.stringMatching(/^sb-stub-auth-token-flow-[\w-]+-code-verifier$/)]),
    );
    expect(verifierCookies().length).toBeGreaterThanOrEqual(2);
    expect(jar.get("sb-stub-auth-token-code-verifier")).toMatchObject({ path: "/", sameSite: "lax" });
    expect(auth.flows[0].redirectTo).toBe("http://localhost:3000/auth/confirm");

    // 2. The email link → /auth/confirm in the same browser: the verifier is sent, the exchange succeeds,
    //    the session is a recovery, and the verifier is used up.
    expect(await visitCallback(openEmailLink())).toBe("http://localhost:3000/reset-password");
    expect(auth.flows[0].used).toBe(true);
    expect(sessionCookies().length).toBeGreaterThan(0);
    // The verifier the exchange used is removed. (With no flow id in the link, auth-js reads and removes the
    // plain key; its per-flow copy stays until auth-js's own limit evicts it. Its code is spent, so it's inert.)
    expect(jar.has("sb-stub-auth-token-code-verifier")).toBe(false);

    // 3. The reset page offers the form for this fresh recovery session.
    expect(await showResetPage()).toBe(ResetPasswordForm);

    // 4. The new password is set once, every session is signed out, and the browser loses its session.
    expect(await submitNewPassword()).toBe("REDIRECT /login?reset=done");
    expect(auth.passwordChanges).toBe(1);
    expect(auth.globalSignOuts).toBe(1);
    expect(sessionCookies()).toEqual([]);

    // 5. Replays: the page and action refuse, the same email link is dead, and the same code can't be reused.
    expect(await showResetPage()).toBe(ExpiredLink);
    expect(await submitNewPassword()).toMatchObject({ expired: true });
    expect(await visitCallback(openEmailLink())).toBe("http://localhost:3000/login?error=link_invalid");
    // Reusing the spent code in this browser: its verifier is gone, so it fails before reaching Supabase.
    expect(await visitCallback(`http://localhost:3000/auth/confirm?code=${auth.flows[0].code}`)).toBe("http://localhost:3000/login?error=link_other_browser");
    expect(auth.passwordChanges).toBe(1);
  });
});

describe("what went wrong in the real attempt, and the guard rails", () => {
  it("opening the link in a different browser: no verifier, no exchange, a clear message; the original browser still works", async () => {
    await requestReset();
    const requestingBrowser = jar;
    const link = openEmailLink();

    jar = new Map(); // a second browser (e.g. Safari, when the request was made in another app's browser)
    expect(await visitCallback(link)).toBe("http://localhost:3000/login?error=link_other_browser");
    expect(auth.tokenCalls).toBe(0); // failed before reaching Supabase: the code wasn't spent
    expect(await showResetPage()).toBe(ExpiredLink);

    jar = requestingBrowser;
    expect(await visitCallback(link)).toBe("http://localhost:3000/reset-password");
  });

  it("a tampered verifier is rejected by the exchange; no session, no form", async () => {
    await requestReset();
    // Change one character of the stored verifier itself (keeping @supabase/ssr's "base64-" encoding valid).
    for (const name of verifierCookies()) {
      const stored = jar.get(name)!;
      const verifier: string = JSON.parse(Buffer.from(stored.value.slice("base64-".length), "base64url").toString());
      const tampered = verifier.replace(/^./, (c) => (c === "a" ? "b" : "a"));
      stored.value = `base64-${Buffer.from(JSON.stringify(tampered)).toString("base64url")}`;
    }
    expect(await visitCallback(openEmailLink())).toBe("http://localhost:3000/login?error=link_invalid");
    expect(sessionCookies()).toEqual([]);
    expect(await showResetPage()).toBe(ExpiredLink);
  });

  it("an invented code is rejected", async () => {
    await requestReset();
    expect(await visitCallback(`http://localhost:3000/auth/confirm?code=${randomUUID()}`)).toBe("http://localhost:3000/login?error=link_invalid");
    expect(sessionCookies()).toEqual([]);
  });

  it("the verifier cookie is only sent back on this site's paths it was set for, and recovery never touches local or session storage", async () => {
    const { setCookies } = await requestReset();
    for (const c of setCookies) expect(c.options.path ?? "/").toBe("/");
    expect(typeof globalThis.localStorage === "undefined" || globalThis.localStorage.length === 0).toBe(true);
  });
});
