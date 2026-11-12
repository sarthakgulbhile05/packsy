// Public-preview switches: sign-ups are closed in production builds unless explicitly opened.
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("@/lib/preview");
  vi.doUnmock("@/lib/supabase/server");
});

const load = async () => (await import("@/lib/preview")).SIGNUPS_OPEN;

describe("SIGNUPS_OPEN", () => {
  it("is closed in a production build by default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SIGNUPS_OPEN", "");
    expect(await load()).toBe(false);
  });

  it.each(["true", "yes", "0", " 1"])("stays closed for %j (only exactly 1 opens it)", async (value) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SIGNUPS_OPEN", value);
    expect(await load()).toBe(false);
  });

  it("opens in production only with NEXT_PUBLIC_SIGNUPS_OPEN=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SIGNUPS_OPEN", "1");
    expect(await load()).toBe(true);
  });

  it("stays open for local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SIGNUPS_OPEN", "");
    expect(await load()).toBe(true);
  });
});

describe("signup action while sign-ups are closed", () => {
  it("refuses before checking the captcha or calling Supabase, even when called directly", async () => {
    const createClient = vi.fn();
    vi.doMock("@/lib/preview", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/preview")>()), SIGNUPS_OPEN: false }));
    vi.doMock("@/lib/supabase/server", () => ({ createClient }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { signup } = await import("@/app/signup/actions");
    const data = new FormData();
    data.set("full_name", "Asha");
    data.set("email", "asha@example.com");
    data.set("password", "goodpass123");
    expect(await signup({}, data)).toEqual({ email: "asha@example.com", fullName: "Asha", error: expect.stringMatching(/open soon/) });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
