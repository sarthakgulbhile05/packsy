import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const calls: string[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    calls.push("createClient");
    return { auth: { getUser } };
  },
}));
vi.mock("next/server", () => ({
  connection: async () => {
    calls.push("connection");
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const { isPhoneVerified, requireUser, requireVerifiedPhone } = await import("@/lib/auth");

const user = (extra: Partial<User> = {}) => ({ id: "u1", phone: "", ...extra }) as User;

describe("isPhoneVerified", () => {
  it("needs both a phone and Supabase's confirmation time", () => {
    expect(isPhoneVerified(user())).toBe(false);
    expect(isPhoneVerified(user({ phone: "919000000001" }))).toBe(false);
    expect(isPhoneVerified(user({ phone_confirmed_at: "2026-10-27T00:00:00Z" }))).toBe(false);
    expect(isPhoneVerified(user({ phone: "919000000001", phone_confirmed_at: "2026-10-27T00:00:00Z" }))).toBe(
      true,
    );
  });

  it("ignores a pending (unverified) new number", () => {
    expect(isPhoneVerified(user({ new_phone: "919000000001" }))).toBe(false);
  });
});

describe("guards", () => {
  beforeEach(() => getUser.mockReset());

  it("requireUser waits for the request before Supabase reads the clock, so signed-in pages can't break prerendering", async () => {
    calls.length = 0;
    getUser.mockResolvedValue({ data: { user: user() } });
    await requireUser();
    expect(calls).toEqual(["connection", "createClient"]);
  });

  it("requireUser sends logged-out visitors to login with a return path", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireUser("/profile")).rejects.toThrow("REDIRECT /login?next=%2Fprofile");
  });

  it("requireUser returns the user from Supabase Auth", async () => {
    getUser.mockResolvedValue({ data: { user: user() } });
    const { user: u } = await requireUser();
    expect(u.id).toBe("u1");
  });

  it("requireVerifiedPhone sends unverified users to /verify-phone", async () => {
    getUser.mockResolvedValue({ data: { user: user({ phone: "919000000001" }) } });
    await expect(requireVerifiedPhone("/requests/new")).rejects.toThrow(
      "REDIRECT /verify-phone?next=%2Frequests%2Fnew",
    );
  });

  it("requireVerifiedPhone lets verified users through", async () => {
    getUser.mockResolvedValue({
      data: { user: user({ phone: "919000000001", phone_confirmed_at: "2026-10-27T00:00:00Z" }) },
    });
    await expect(requireVerifiedPhone("/requests/new")).resolves.toMatchObject({ user: { id: "u1" } });
  });

  it("requireVerifiedPhone sends logged-out visitors to login first", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireVerifiedPhone("/requests/new")).rejects.toThrow("REDIRECT /login?next=");
  });
});
