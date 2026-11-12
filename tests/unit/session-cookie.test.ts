import { describe, expect, it } from "vitest";
import { authCookieOptions } from "@/lib/supabase/session-cookie";

const persistent = { path: "/", sameSite: "lax" as const, maxAge: 34560000 };
// Tests run with NODE_ENV=test, so secure is off here; production builds turn it on.
const locked = { httpOnly: true, secure: false };

describe("authCookieOptions", () => {
  it("keeps cookies persistent when Remember me is on", () => {
    expect(authCookieOptions("token", persistent, false)).toEqual({ ...persistent, ...locked });
  });

  it("drops maxAge and expires when Remember me is off, keeping other options", () => {
    const result = authCookieOptions("token", { ...persistent, expires: new Date(2030, 0, 1) }, true);
    expect(result).toEqual({ path: "/", sameSite: "lax", ...locked });
    expect(persistent.maxAge).toBe(34560000); // input not mutated
  });

  it("never turns a deletion into a lingering cookie", () => {
    const deletion = { path: "/", maxAge: 0 };
    expect(authCookieOptions("", deletion, true)).toEqual({ ...deletion, ...locked });
    expect(authCookieOptions("x", deletion, true)).toEqual({ ...deletion, ...locked });
  });

  it("keeps session tokens away from page scripts, even if Supabase asks otherwise", () => {
    expect(authCookieOptions("token", { ...persistent, httpOnly: false }, false).httpOnly).toBe(true);
  });

  it("marks cookies secure in production builds", () => {
    const env = process.env as Record<string, string | undefined>;
    const before = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(authCookieOptions("token", persistent, false).secure).toBe(true);
    } finally {
      env.NODE_ENV = before;
    }
  });
});
