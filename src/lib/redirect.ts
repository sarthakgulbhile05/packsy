const AUTH_PAGES = ["/login", "/signup", "/verify-phone", "/forgot-password", "/reset-password", "/auth/"];

/**
 * Returns `value` only if it is a path on this site (and not an auth page, which would loop);
 * otherwise `fallback`. Stops ?next= from sending users to another website.
 */
export function safeNext(value: unknown, fallback = "/profile"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 500) return fallback;
  if (/[\x00-\x1f\x7f\\]/.test(value)) return fallback; // browsers strip/convert these into "//host"
  const url = new URL(value, "http://orbitly.invalid");
  if (url.origin !== "http://orbitly.invalid") return fallback;
  if (AUTH_PAGES.some((p) => url.pathname === p || url.pathname.startsWith(p.endsWith("/") ? p : `${p}/`))) {
    return fallback;
  }
  return url.pathname + url.search;
}

/** The app's own address from SITE_URL, used for links in emails. Null if missing or invalid. */
export function siteUrl(): string | null {
  try {
    const url = new URL(process.env.SITE_URL ?? "");
    return url.protocol === "https:" || url.hostname === "localhost" ? url.origin : null;
  } catch {
    return null;
  }
}
