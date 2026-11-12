import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/lib/turnstile";

// Cloudflare's documented always-pass test secret (public, test-only).
const TEST_SECRET = "1x0000000000000000000000000000000AA";

describe("verifyTurnstile", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TURNSTILE_SECRET_KEY", TEST_SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  const reply = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body });

  it("passes when Cloudflare says success, sending secret and token server-side", async () => {
    reply({ success: true });
    expect(await verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", "login")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = new URLSearchParams(init.body);
    expect(body.get("secret")).toBe(TEST_SECRET);
    expect(body.get("response")).toBe("XXXX.DUMMY.TOKEN.XXXX");
  });

  it("fails when Cloudflare says failure", async () => {
    reply({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstile("bad", "login")).toBe(false);
  });

  it("fails on HTTP errors, odd replies and network errors", async () => {
    reply({ success: true }, false);
    expect(await verifyTurnstile("t", "login")).toBe(false);
    reply({ success: "true" });
    expect(await verifyTurnstile("t", "login")).toBe(false);
    reply(null);
    expect(await verifyTurnstile("t", "login")).toBe(false);
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await verifyTurnstile("t", "login")).toBe(false);
  });

  it("fails without calling Cloudflare when the token is missing or too long", async () => {
    expect(await verifyTurnstile(null, "login")).toBe(false);
    expect(await verifyTurnstile("", "login")).toBe(false);
    expect(await verifyTurnstile(new File(["x"], "x.txt"), "login")).toBe(false);
    expect(await verifyTurnstile("x".repeat(2049), "login")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses Cloudflare's test secrets in Vercel production, allows them elsewhere", async () => {
    reply({ success: true });
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", "login")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAArealLookingSecret");
    vi.stubEnv("SITE_URL", "https://orbitly.example");
    reply({ success: true, hostname: "orbitly.example", action: "login" });
    expect(await verifyTurnstile("token", "login")).toBe(true);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TEST_SECRET);
    expect(await verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", "login")).toBe(true);
  });

  it("fails closed when the secret key is not configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(await verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", "login")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("with real keys (F-07)", () => {
    beforeEach(() => {
      vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAArealLookingSecret");
      vi.stubEnv("SITE_URL", "https://orbitly.example");
    });

    it("passes only for a token issued on this site, for this form", async () => {
      reply({ success: true, hostname: "orbitly.example", action: "signup" });
      expect(await verifyTurnstile("t", "signup")).toBe(true);
    });

    it("fails for a token issued on another host", async () => {
      reply({ success: true, hostname: "evil.example", action: "signup" });
      expect(await verifyTurnstile("t", "signup")).toBe(false);
    });

    it("fails for a token from another form, so one form's token can't be spent on another", async () => {
      reply({ success: true, hostname: "orbitly.example", action: "login" });
      expect(await verifyTurnstile("t", "password_reset")).toBe(false);
    });

    it("fails when Cloudflare leaves out the hostname or action", async () => {
      reply({ success: true });
      expect(await verifyTurnstile("t", "login")).toBe(false);
      reply({ success: true, hostname: "orbitly.example" });
      expect(await verifyTurnstile("t", "login")).toBe(false);
    });

    it("fails closed when SITE_URL isn't set, since the hostname can't be checked", async () => {
      vi.stubEnv("SITE_URL", "");
      reply({ success: true, hostname: "orbitly.example", action: "login" });
      expect(await verifyTurnstile("t", "login")).toBe(false);
    });

    it("fails for expired or reused tokens (Cloudflare says so)", async () => {
      reply({ success: false, "error-codes": ["timeout-or-duplicate"] });
      expect(await verifyTurnstile("t", "login")).toBe(false);
    });
  });
});
