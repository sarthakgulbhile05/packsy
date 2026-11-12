import { afterEach, describe, expect, it, vi } from "vitest";
import { safeNext, siteUrl } from "@/lib/redirect";

describe("safeNext", () => {
  it.each(["/profile", "/requests/123?tab=offers", "/"])("keeps same-site path %s", (path) => {
    expect(safeNext(path)).toBe(path);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "javascript:alert(1)",
    "profile",
    "",
    undefined,
    null,
    42,
    "/" + "a".repeat(600),
  ])("rejects unsafe value %j", (value) => {
    expect(safeNext(value)).toBe("/profile");
  });

  it.each(["/login", "/signup", "/verify-phone", "/verify-phone?next=/x", "/auth/confirm"])(
    "rejects auth page %s so redirects can't loop",
    (path) => {
      expect(safeNext(path)).toBe("/profile");
    },
  );

  it("does not treat look-alike paths as auth pages", () => {
    expect(safeNext("/login-help")).toBe("/login-help");
  });

  it("uses the given fallback", () => {
    expect(safeNext("//evil", "/")).toBe("/");
  });
});

describe("siteUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the origin for https or localhost", () => {
    vi.stubEnv("SITE_URL", "https://orbitly.example/some/path");
    expect(siteUrl()).toBe("https://orbitly.example");
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    expect(siteUrl()).toBe("http://localhost:3000");
  });

  it("returns null when missing, invalid or plain http on a real host", () => {
    vi.stubEnv("SITE_URL", "");
    expect(siteUrl()).toBeNull();
    vi.stubEnv("SITE_URL", "not a url");
    expect(siteUrl()).toBeNull();
    vi.stubEnv("SITE_URL", "http://orbitly.example");
    expect(siteUrl()).toBeNull();
  });
});
