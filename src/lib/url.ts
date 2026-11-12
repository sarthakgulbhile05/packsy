// Pure URL helpers, safe to use in the browser and on the server.

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_[a-z]+|igshid|_hsenc|_hsmi|ref_src)$/i;

/**
 * Turns what a buyer pasted into a clean http(s) URL, or null if it isn't a usable web link.
 * Adds https:// when missing, drops credentials, fragments and common tracking parameters.
 */
export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s || s.length > 2048 || /\s/.test(s)) return null;
  if (!/^[a-z][a-z\d+.-]*:/i.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  // Public sites have a dotted host name (or are an IP literal, which the server checks further).
  if (!url.hostname.includes(".") && !url.hostname.startsWith("[")) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

/** Short, readable host for display, e.g. "amazon.com". */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
