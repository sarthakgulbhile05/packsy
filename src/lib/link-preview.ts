import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { pipeline } from "node:stream";
import zlib from "node:zlib";
import { normalizeUrl } from "./url";

// Server-only: fetches a product page once to read its public title/image/description.
// It never retries with disguised headers or works around a site's refusal.

export type LinkPreview = { url: string; title?: string; description?: string; image?: string; siteName?: string };
/** Which layer named the product: JSON-LD, Open Graph, other meta tags/<title>, or a retailer adapter. */
export type PreviewMethod = "json-ld" | "open-graph" | "meta" | "retailer";
/** "partial": the product is named but its image (and maybe description) couldn't be read. */
export type PreviewResult =
  | { ok: true; status: "success" | "partial"; method: PreviewMethod; missing: ("image" | "description")[]; preview: LinkPreview }
  | { ok: false; status: "failed"; url?: string; reason: string; code?: "rate_limited" };

const TIMEOUT_MS = 5000; // whole preview, all redirects included
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;
const MAX_HTML_BYTES = 512_000; // decoded bytes we keep; meta tags live in <head>
const MAX_REDIRECTS = 3;
const USER_AGENT = "OrbitlyLinkPreview/0.2 (reads page title and image to prefill a buyer's request)";

const NOT_PUBLIC = "That link doesn’t point to a public website we can preview. You can add the details yourself.";
const NOT_READABLE = "That link isn’t a web page we can read. You can add the details yourself.";

// IANA special-purpose ranges. IPv6 must also be global unicast (2000::/3), which rules out
// ::1, ::, IPv4-mapped/compatible (::ffff:…, ::a.b.c.d), fc00::/7, fe80::/10 and ff00::/8.
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) blocked.addSubnet(net, bits, "ipv6");
const globalUnicast = new BlockList();
globalUnicast.addSubnet("2000::", 3, "ipv6");

/** True for anything that isn't a plain public address: private, loopback, link-local, multicast, reserved, mapped, or not an IP. */
export function isPrivateAddress(ip: string): boolean {
  try {
    if (isIP(ip) === 4) return blocked.check(ip, "ipv4");
    if (isIP(ip) === 6) return ip.includes("%") || !globalUnicast.check(ip, "ipv6") || blocked.check(ip, "ipv6");
  } catch {}
  return true; // fail closed
}

const INTERNAL_HOST = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa)\.?$/i;

/** A public host name or public IP literal (brackets allowed): never private, internal or single-label. */
export function isPublicHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  return isIP(host) ? !isPrivateAddress(host) : !INTERNAL_HOST.test(host) && host.includes(".");
}

/**
 * A third-party product image that is safe to load in other people's browsers: https, a public named host
 * (no IP literals), no credentials, the default port. Null otherwise. The database draft enforces
 * the same rule more loosely (requests_preview_image_https).
 */
export function safeImageUrl(value: string): string | null {
  if (value.length > 2000 || /[\s\x00-\x1f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (isIP(url.hostname.replace(/^\[|\]$/g, ""))) return null; // the database refuses IP literals too
    return isPublicHost(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

class PreviewError extends Error {}

type Answer = { address: string; family: number };
type Resolve = (host: string) => Promise<Answer[]>;
const resolveAll: Resolve = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * A socket `lookup` that resolves, checks every answer, and hands the socket only those checked
 * addresses. The check and the connection use the same answer, so DNS can't switch in between.
 */
export function pinnedLookup(resolve: Resolve = resolveAll, isBlocked = isPrivateAddress): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then((answers) => {
        // A mix of public and private answers is refused outright: we can't know which one the socket would pick.
        if (answers.length === 0 || answers.some((a) => isBlocked(a.address))) throw new PreviewError(NOT_PUBLIC);
        if (options.all) callback(null, answers);
        else callback(null, answers[0].address, answers[0].family);
      })
      .catch((error) => callback(error instanceof PreviewError ? error : new PreviewError("dns"), ""));
  };
}

/** Checks what can be known from the URL alone, before any network activity. */
function assertAllowedUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PreviewError("That link redirects somewhere we can’t open.");
  if (url.username || url.password) throw new PreviewError(NOT_PUBLIC);
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) throw new PreviewError(NOT_PUBLIC);
  if (!isPublicHost(url.hostname)) throw new PreviewError(NOT_PUBLIC);
}

function open(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        agent: false, // fresh connection every hop, never a pooled socket to some earlier address
        lookup: pinnedLookup(),
        signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml", "accept-encoding": "identity" },
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Streams the body (decompressing if the site insists), keeping at most MAX_HTML_BYTES. Stops early once
 * the <head> is in and `enough` says it already identifies the product, so a big or slow body isn't awaited.
 */
async function readHtml(res: IncomingMessage, enough: (head: string) => boolean = () => false): Promise<string> {
  const encoding = String(res.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  const decompress = { gzip: zlib.createGunzip, "x-gzip": zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress }[encoding];
  if (encoding !== "identity" && !decompress) throw new PreviewError(NOT_READABLE);
  // pipeline (not pipe) so an aborted or broken response also errors the decompressor instead of hanging it
  const body = decompress ? pipeline(res, decompress(), () => {}) : res;
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(String(res.headers["content-type"]))?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    decoder = new TextDecoder("utf-8"); // unknown charset label: read as UTF-8, bad bytes become �
  }
  const chunks: Buffer[] = [];
  const text = () => decoder.decode(Buffer.concat(chunks).subarray(0, MAX_HTML_BYTES));
  let size = 0;
  let headChecked = false;
  try {
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      size += chunk.byteLength;
      if (size >= MAX_HTML_BYTES) break; // stops a huge page or a decompression bomb mid-stream
      // last two chunks, so a tag split across a chunk boundary is still seen
      if (!headChecked && /<\/head\s*>/i.test(Buffer.concat(chunks.slice(-2)).toString("latin1"))) {
        headChecked = true;
        if (enough(text())) break;
      }
    }
  } finally {
    body.destroy();
    res.destroy();
  }
  return text();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string) {
  const char = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "");
  return s
    .replace(/&#x([\da-f]{1,6});/gi, (_, h) => char(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, d) => char(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** An HTML attribute's raw value from one tag, e.g. attrOf('<img src="a">', "src"). */
function attrOf(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`(?:^|[\\s<])${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

/** Plain text from untrusted markup: tags dropped, entities decoded, whitespace collapsed. Never empty. */
const plain = (v: unknown) => (typeof v === "string" ? decode(v.replace(/<[^>]*>/g, " ")) || undefined : undefined);

type Found = { title?: string; description?: string; image?: string };

/** Layer 1: schema.org Product / ProductGroup in any JSON-LD block, array, @graph or nesting. */
function jsonLdProduct(html: string): Found {
  const nodes: Record<string, unknown>[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 12 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    const o = v as Record<string, unknown>;
    if ([o["@type"]].flat().some((t) => t === "Product" || t === "ProductGroup")) nodes.push(o);
    for (const x of Object.values(o)) visit(x, depth + 1); // @graph, hasVariant, mainEntity…
  };
  for (const m of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1]), 0);
    } catch {} // one broken block mustn't hide the others
  }
  // image may be a URL, an ImageObject ({url} / {contentUrl}) or a list of either
  const image = (v: unknown, depth = 0): string | undefined => {
    if (depth > 4 || !v) return undefined;
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return image(v[0], depth + 1);
    if (typeof v === "object") return image((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).contentUrl, depth + 1);
  };
  const named = nodes.find((n) => plain(n.name));
  if (!named) return {};
  return { title: plain(named.name), description: plain(named.description), image: [named, ...nodes].map((n) => image(n.image)).find(Boolean) };
}

// Layer 4: shops whose public product HTML has no JSON-LD or Open Graph. Reads only the page already
// fetched (same request, no cookies, no scripts run); a shop's bot check is still reported, never worked around.
const RETAILERS: { host: RegExp; read: (html: string) => Found }[] = [
  {
    host: /(^|\.)amazon\.(com|in|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|ae|sg|nl|se|com\.mx|com\.br)$/i,
    read: (html) => {
      const img = html.match(/<img\b[^>]{0,4000}?\sid\s*=\s*["']landingImage["'][^>]{0,4000}>/i)?.[0] ?? "";
      return {
        title: plain(html.match(/<span\b[^>]{0,500}\sid\s*=\s*["']productTitle["'][^>]{0,500}>([\s\S]{0,2000}?)<\/span>/i)?.[1]),
        image: attrOf(img, "data-old-hires") || attrOf(img, "src"),
      };
    },
  },
];

/**
 * Reads a page's product details in layers: JSON-LD, Open Graph, Twitter/standard meta, retailer adapter,
 * then <title>. Each field comes from the first layer that has it; `method` is the layer that named the product.
 */
export function parseMetadata(html: string, pageUrl: string): Omit<LinkPreview, "url"> & { method?: PreviewMethod } {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]{0,2000}>/gi) ?? []) {
    const k = (attrOf(tag, "property") ?? attrOf(tag, "name"))?.toLowerCase();
    const v = attrOf(tag, "content");
    if (k && v && !meta.has(k)) meta.set(k, decode(v));
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]{0,2000}?)<\/title>/i)?.[1];
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v && v.length > 0);
  const host = URL.canParse(pageUrl) ? new URL(pageUrl).hostname : "";

  const layers: [PreviewMethod, Found][] = [
    ["json-ld", jsonLdProduct(html)],
    ["open-graph", { title: pick("og:title"), description: pick("og:description"), image: pick("og:image:secure_url", "og:image") }],
    ["meta", { title: pick("twitter:title"), description: pick("twitter:description", "description"), image: pick("twitter:image", "twitter:image:src") }],
    ["retailer", RETAILERS.find((r) => r.host.test(host))?.read(html) ?? {}],
    ["meta", { title: titleTag ? decode(titleTag) || undefined : undefined }],
  ];
  // Product images only as safe absolute URLs (see safeImageUrl); anything else (javascript:, data:, private hosts, junk) is dropped.
  for (const [, layer] of layers) {
    try {
      const resolved = layer.image ? new URL(layer.image, pageUrl) : undefined;
      if (resolved?.protocol === "http:" && !resolved.port) resolved.protocol = "https:"; // most shops serve both; a broken image is cleared in the browser
      layer.image = resolved ? (safeImageUrl(resolved.toString()) ?? undefined) : undefined;
    } catch {
      layer.image = undefined;
    }
  }
  const first = (key: keyof Found) => layers.find(([, l]) => l[key]);
  const clip = (s: string | undefined, n: number) => (s ? s.slice(0, n) : undefined);
  return {
    title: clip(first("title")?.[1].title, 200),
    description: clip(first("description")?.[1].description, 500),
    image: first("image")?.[1].image,
    siteName: clip(pick("og:site_name", "application-name"), 80),
    method: (first("title") ?? first("image"))?.[0],
  };
}

// A site's own challenge or error screen, not a product. Body phrases are narrow on purpose: ordinary
// product pages often load reCAPTCHA scripts, so the bare word "captcha" only counts in the title.
const BLOCKED_TITLE = /captcha|robot check|are you (a )?(human|robot)|access denied|attention required|just a moment|security check|verify (you are|you're) (a )?human|request blocked|unusual traffic|pardon our interruption/i;
const BLOCKED_BODY = /not a robot|enter the characters you see below|verify (that )?you are (a )?human|unusual traffic from your|pardon our interruption|\/errors[\w-]*\/validatecaptcha|automated access to amazon data|_cf_chl_opt/i;
const GENERIC_TITLE = /^(home( ?page)?|welcome|shop|store|online shopping|page not found|not found|404|error|sign in|log ?in|untitled)$/;

/** Why this page doesn't identify a product, or null if its title really names something. */
export function notAProduct(meta: Omit<LinkPreview, "url">, html: string, pageUrl: URL): string | null {
  if ((meta.title && BLOCKED_TITLE.test(meta.title)) || BLOCKED_BODY.test(html)) {
    return "That site asked for a human check, so we couldn’t read the product. You can add the details yourself.";
  }
  if (pageUrl.pathname === "/" && !pageUrl.search) {
    return "That’s the shop’s home page, not a product. Paste the product’s own link, or add the details yourself.";
  }
  // Remove the site's own name ("Amazon.com", "amazon", its og:site_name) and see whether anything is left.
  const words = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const host = pageUrl.hostname.replace(/^www\./, "");
  let rest = words(meta.title ?? "");
  for (const name of [host, host.split(".")[0], meta.siteName ?? ""].map(words)) {
    if (name.trim()) rest = rest.replaceAll(name, " ");
  }
  rest = rest.trim();
  if (rest.length < 3 || GENERIC_TITLE.test(rest)) {
    return "We opened the page but found no product details. Please add them yourself.";
  }
  return null;
}

const fail = (reason: string, url?: string): PreviewResult => ({ ok: false, status: "failed", ...(url && { url }), reason });

// Same link, same answer for everyone (no cookies are sent), so successes are reused for a while and
// concurrent requests for one link share one fetch. Failures are shared only while in flight: they may clear up.
const cache = new Map<string, { at: number; result: Promise<PreviewResult> }>();
export const clearPreviewCache = () => cache.clear();

/** Fetches a page (following up to 3 checked redirects) and returns whatever product details it really has. */
export async function fetchLinkPreview(input: string): Promise<PreviewResult> {
  const normalized = normalizeUrl(input);
  if (!normalized) return fail("That doesn’t look like a web link. Check it, or describe the item instead.");
  const hit = cache.get(normalized);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!); // oldest first
  const result = loadPreview(normalized);
  cache.set(normalized, { at: Date.now(), result });
  result.then((r) => {
    if (!r.ok && cache.get(normalized)?.result === result) cache.delete(normalized);
  });
  return result;
}

async function loadPreview(normalized: string): Promise<PreviewResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let current = new URL(normalized);
  const seen = new Set<string>();
  try {
    for (let hop = 0; ; hop++) {
      assertAllowedUrl(current);
      seen.add(current.href);
      const res = await open(current, controller.signal);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.destroy();
        if (hop >= MAX_REDIRECTS) throw new PreviewError("That link redirects too many times. You can add the details yourself.");
        current = new URL(location, current);
        if (seen.has(current.href)) throw new PreviewError("That link redirects in a loop. You can add the details yourself.");
        continue;
      }
      if ([401, 403, 429, 451].includes(status)) {
        res.destroy();
        throw new PreviewError("This site doesn’t allow automatic previews. You can add the details yourself.");
      }
      if (status < 200 || status >= 300) {
        res.destroy();
        throw new PreviewError(`We couldn’t open that page (error ${status}). You can add the details yourself.`);
      }
      if (!/^\s*(text\/html|application\/xhtml\+xml)\s*(;|$)/i.test(String(res.headers["content-type"] ?? ""))) {
        res.destroy();
        throw new PreviewError(NOT_READABLE);
      }

      const pageUrl = current.toString();
      const page = await readHtml(res, (head) => {
        const m = parseMetadata(head, pageUrl);
        return Boolean(m.title && m.image && !notAProduct(m, head, current));
      });
      const { method, ...meta } = parseMetadata(page, pageUrl);
      const problem = notAProduct(meta, page, current);
      if (problem || !method) return fail(problem ?? "We opened the page but found no product details. Please add them yourself.", normalized);
      const missing = (["image", "description"] as const).filter((k) => !meta[k]);
      return { ok: true, status: meta.image ? "success" : "partial", method, missing, preview: { url: normalized, ...meta } };
    }
  } catch (error) {
    // Messages are fixed strings: no addresses, hostnames' IPs or stack traces reach the user.
    if (controller.signal.aborted) return fail("That site took too long to respond. You can add the details yourself.", normalized);
    if (error instanceof PreviewError && error.message !== "dns") return fail(error.message, normalized);
    return fail("We couldn’t reach that site. You can add the details yourself.", normalized);
  } finally {
    clearTimeout(timer);
  }
}
