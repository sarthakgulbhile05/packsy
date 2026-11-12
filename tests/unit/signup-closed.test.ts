// Production builds keep sign-ups closed: the action must refuse before doing any work, so calling it
// directly (bypassing the hidden form) can't create an account.
import { describe, expect, it, vi } from "vitest";

vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("NEXT_PUBLIC_SIGNUPS_OPEN", "");
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient }));
const captcha = vi.fn();
vi.mock("@/lib/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/turnstile")>()),
  verifyTurnstile: captcha,
}));

const { SIGNUPS_CLOSED, SIGNUPS_OPEN } = await import("@/lib/preview");
const { signup } = await import("@/app/signup/actions");

describe("sign-ups closed (production build)", () => {
  it("refuses a direct call before checking the CAPTCHA or contacting Supabase", async () => {
    expect(SIGNUPS_OPEN).toBe(false);
    const fd = new FormData();
    fd.set("full_name", "Asha");
    fd.set("email", "a@orbitly.test");
    fd.set("password", "secret123");
    expect((await signup({}, fd)).error).toBe(SIGNUPS_CLOSED);
    expect(captcha).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
});
