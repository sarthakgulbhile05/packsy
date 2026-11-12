import { EventEmitter } from "node:events";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookup(...args) }));

// Fake transport that behaves like Node's http(s).request: hostnames go through options.lookup,
// and a "connection" is recorded only for the address that lookup handed back.
type Conn = { host: string; address: string; agent: unknown };
const connections: Conn[] = [];
let respond: (url: URL) => Readable | "hang" = () => "hang";
function fakeRequest(url: URL, opts: { lookup: (h: string, o: object, cb: (err: Error | null, answers: { address: string }[]) => void) => void; agent: unknown; signal: AbortSignal }, onResponse: (r: Readable) => void) {
  const req = Object.assign(new EventEmitter(), {
    end() {
      const connect = (address: string) => {
        connections.push({ host: url.hostname, address, agent: opts.agent });
        const res = respond(url);
        if (res === "hang") {
          opts.signal.addEventListener("abort", () => req.emit("error", Object.assign(new Error("aborted"), { name: "AbortError" })));
          return;
        }
        opts.signal.addEventListener("abort", () => res.destroy(Object.assign(new Error("aborted"), { name: "AbortError" })));
        onResponse(res);
      };
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (isIP(host)) return connect(host);
      opts.lookup(host, { all: true }, (err, answers) => (err ? req.emit("error", err) : connect(answers[0].address)));
    },
  });
  return req;
}
vi.mock("node:http", () => ({ default: { request: (...a: Parameters<typeof fakeRequest>) => fakeRequest(...a) } }));
vi.mock("node:https", () => ({ default: { request: (...a: Parameters<typeof fakeRequest>) => fakeRequest(...a) } }));

const { clearPreviewCache, fetchLinkPreview, isPrivateAddress, parseMetadata, safeImageUrl } = await import("@/lib/link-preview");
beforeEach(() => clearPreviewCache());
const { normalizeUrl, displayHost } = await import("@/lib/url");

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];
const html = (body: string | Buffer | Iterable<Buffer>, status = 200, headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" }) =>
  Object.assign(Readable.from(typeof body === "string" || Buffer.isBuffer(body) ? [Buffer.from(body)] : body, { objectMode: false }), { statusCode: status, headers });
const redirect = (location: string) => html("", 302, { location });

describe("normalizeUrl", () => {
  it.each([
    ["amazon.com/dp/B0ABC", "https://amazon.com/dp/B0ABC"],
    ["  https://shop.example/item?id=7&utm_source=ig&fbclid=x#reviews ", "https://shop.example/item?id=7"],
    ["http://store.example.co.uk/p", "http://store.example.co.uk/p"],
  ])("%s → %s", (input, out) => expect(normalizeUrl(input)).toBe(out));

  it.each(["", "not a link", "javascript:alert(1)", "ftp://files.example/x", "https://user:pw@shop.example", "http://localhost:3000", "file:///etc/passwd", `https://x.com/${"a".repeat(2100)}`])(
    "rejects %j",
    (input) => expect(normalizeUrl(input)).toBeNull(),
  );

  it("displayHost drops www", () => expect(displayHost("https://www.ebay.com/itm/1")).toBe("ebay.com"));
});

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "240.0.0.1", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.7", "203.0.113.9",
    "::1", "::", "fd00::1", "fc00::1", "fe80::1", "fe80::1%en0", "ff02::1", "fec0::1",
    // IPv4 hidden inside IPv6: mapped (both spellings), compatible, NAT64, 6to4, Teredo
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::", "2001::1",
    "2001:db8::1", "not-an-ip", "", "1.2.3",
  ])("blocks %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "172.32.0.1", "104.16.0.1", "2606:4700::1111", "2001:4860:4860::8888"])("allows public %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("parseMetadata", () => {
  const page = "https://shop.example/products/grinder";

  it("prefers Open Graph tags, decodes entities and resolves relative images", () => {
    const doc = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Vintage Zassenhaus &amp; Co. Coffee Grinder">
      <meta content='/img/grinder.jpg' property='og:image'>
      <meta name="description" content="Hand-cranked, 1960s &#8211; works">
      <meta property="og:site_name" content="Shop Example"></head></html>`;
    expect(parseMetadata(doc, page)).toEqual({
      title: "Vintage Zassenhaus & Co. Coffee Grinder",
      image: "https://shop.example/img/grinder.jpg",
      description: "Hand-cranked, 1960s – works",
      siteName: "Shop Example",
      method: "open-graph",
    });
  });

  it("falls back to <title> and ignores non-http image URLs", () => {
    const doc = `<title>  Phone   X  </title><meta property="og:image" content="javascript:alert(1)">`;
    expect(parseMetadata(doc, page)).toEqual({ title: "Phone X", image: undefined, description: undefined, siteName: undefined, method: "meta" });
  });

  it("caps very long values", () => {
    expect(parseMetadata(`<meta property="og:title" content="${"x".repeat(500)}">`, page).title).toHaveLength(200);
  });

  it("survives malformed markup and out-of-range entities", () => {
    expect(parseMetadata(`<meta property="og:title" content="A &#9999999; B &#x110000;"><meta <<< <title>unclosed`, page).title).toBe("A B");
    expect(() => parseMetadata("<".repeat(100_000) + "<meta " + "a".repeat(100_000), page)).not.toThrow();
  });
});

describe("fetchLinkPreview", () => {
  beforeEach(() => {
    lookup.mockResolvedValue(PUBLIC);
  });
  afterEach(() => {
    lookup.mockReset();
    connections.length = 0;
    respond = () => "hang";
    vi.useRealTimers();
  });
  const leaksNothing = (reason: string) => expect(reason).not.toMatch(/\d+\.\d+\.\d+\.\d+|::|ENOTFOUND|Error|\bat\b/);

  it.each(["shop.example/sneakers", "http://shop.example/sneakers", "http://shop.example:80/sneakers", "https://shop.example:443/sneakers"])("reads real metadata from %s", async (input) => {
    respond = () => html(`<meta property="og:title" content="Collectible sneakers"><meta property="og:image" content="https://cdn.example/s.jpg">`);
    const r = await fetchLinkPreview(input);
    expect(r).toMatchObject({ ok: true, preview: { title: "Collectible sneakers", image: "https://cdn.example/s.jpg" } });
    expect(connections).toEqual([{ host: "shop.example", address: "93.184.216.34", agent: false }]);
  });

  it.each([
    ["non-web port", "https://shop.example:8443/x"],
    ["SSH port", "http://shop.example:22/"],
    ["loopback literal", "http://127.0.0.1/"],
    ["cloud metadata literal", "http://169.254.169.254/latest/meta-data/"],
    ["hex IPv4", "http://0x7f.1/"],
    ["short IPv4 with trailing dot", "http://127.1./"],
    ["IPv4-mapped IPv6", "http://[::ffff:127.0.0.1]/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["localhost with trailing dot", "http://localhost./"],
    ["mDNS name", "http://printer.local/"],
    ["cloud metadata name", "http://metadata.google.internal/"],
    ["home network name", "http://router.home.arpa/"],
    ["decimal IPv4", "http://2130706433/"],
    ["credentials", "https://admin:pw@shop.example/"],
  ])("refuses %s without any DNS lookup or connection", async (_, input) => {
    const r = await fetchLinkPreview(input);
    expect(r.ok).toBe(false);
    if (!r.ok) leaksNothing(r.reason);
    expect(lookup).not.toHaveBeenCalled();
    expect(connections).toEqual([]);
  });

  it.each([
    ["only private", [{ address: "10.0.0.5", family: 4 }]],
    ["public and private mixed", [...PUBLIC, { address: "127.0.0.1", family: 4 }]],
    ["mapped IPv6 answer", [{ address: "::ffff:7f00:1", family: 6 }]],
    ["no answers", []],
  ])("refuses a host whose DNS has %s, before connecting", async (_, answers) => {
    lookup.mockResolvedValue(answers);
    const r = await fetchLinkPreview("https://intranet.example/admin");
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/public website/) });
    expect(connections).toEqual([]);
  });

  it("fails closed when DNS errors, without echoing the error", async () => {
    lookup.mockRejectedValue(Object.assign(new Error("getaddrinfo ENOTFOUND nope.example"), { code: "ENOTFOUND" }));
    const r = await fetchLinkPreview("https://nope.example/");
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/couldn’t reach/) });
    if (!r.ok) leaksNothing(r.reason);
    expect(connections).toEqual([]);
  });

  it("re-checks a redirect to a host that resolves privately", async () => {
    lookup.mockResolvedValueOnce(PUBLIC).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    respond = () => redirect("https://evil.example/");
    expect(await fetchLinkPreview("https://shop.example/x")).toMatchObject({ ok: false, reason: expect.stringMatching(/public website/) });
    expect(connections.map((c) => c.host)).toEqual(["shop.example"]);
  });

  it.each(["http://169.254.169.254/", "http://[::1]:80/", "https://shop.example:8080/", "file:///etc/passwd", "gopher://shop.example/"])(
    "refuses a redirect to %s before connecting",
    async (location) => {
      respond = () => redirect(location);
      expect((await fetchLinkPreview("https://shop.example/x")).ok).toBe(false);
      expect(connections).toHaveLength(1);
    },
  );

  it("stops DNS rebinding: each hop is resolved once, inside the connection, and connects to exactly that answer", async () => {
    lookup.mockResolvedValueOnce(PUBLIC).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    respond = (url) => (url.pathname === "/a" ? redirect("/b") : html("<title>Should never load</title>"));
    const r = await fetchLinkPreview("https://shop.example/a");
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/public website/) });
    expect(lookup).toHaveBeenCalledTimes(2); // one per hop, no separate pre-check that could disagree
    expect(connections).toEqual([{ host: "shop.example", address: "93.184.216.34", agent: false }]);
  });

  it("follows up to 3 redirects, then stops", async () => {
    let n = 0;
    respond = () => redirect(`/hop${++n}`);
    expect(await fetchLinkPreview("https://shop.example/start")).toMatchObject({ ok: false, reason: expect.stringMatching(/too many/) });
    expect(connections).toHaveLength(4);

    connections.length = 0;
    respond = (url) => (url.pathname === "/3" ? html("<title>Grinder</title>") : redirect(`/${Number(url.pathname.slice(1) || 0) + 1}`));
    expect(await fetchLinkPreview("https://shop.example/")).toMatchObject({ ok: true, preview: { title: "Grinder" } });
  });

  it("detects redirect loops", async () => {
    respond = (url) => redirect(url.pathname === "/a" ? "/b" : "/a");
    expect(await fetchLinkPreview("https://shop.example/a")).toMatchObject({ ok: false, reason: expect.stringMatching(/loop/) });
    expect(connections).toHaveLength(2);
  });

  it("is honest when a site blocks previews, and keeps the link for manual entry", async () => {
    respond = () => html("blocked", 403);
    expect(await fetchLinkPreview("https://shop.example/x")).toEqual({ ok: false, status: "failed", url: "https://shop.example/x", reason: expect.stringMatching(/doesn’t allow automatic previews/) });
  });

  it("reports pages without product details as not found, not as success", async () => {
    respond = () => html("<html><body>hello</body></html>");
    expect(await fetchLinkPreview("https://shop.example/x")).toMatchObject({ ok: false, reason: expect.stringMatching(/no product details/) });
  });

  it.each([["application/pdf"], ["image/png"], ["application/json"], ["text/plain"], ["text/htmlx"], [""]])("rejects content-type %j as not a product page", async (type) => {
    respond = () => html("<title>Looks like html</title>", 200, type ? { "content-type": type } : {});
    expect(await fetchLinkPreview("https://shop.example/x")).toMatchObject({ ok: false, reason: expect.stringMatching(/isn’t a web page/) });
  });

  it("times out the whole preview, redirects included", async () => {
    vi.useFakeTimers();
    respond = () => "hang";
    const pending = fetchLinkPreview("https://shop.example/x");
    await vi.advanceTimersByTimeAsync(6000);
    expect(await pending).toMatchObject({ ok: false, reason: expect.stringMatching(/too long/) });
  });

  it("times out a page that starts but never finishes sending", async () => {
    vi.useFakeTimers();
    respond = () => Object.assign(new Readable({ read() {} }), { statusCode: 200, headers: { "content-type": "text/html" } });
    const pending = fetchLinkPreview("https://shop.example/x");
    await vi.advanceTimersByTimeAsync(6000);
    expect(await pending).toMatchObject({ ok: false, reason: expect.stringMatching(/too long/) });
  });

  it("stops reading an endless page part-way through the stream", async () => {
    let produced = 0;
    function* endless() {
      yield Buffer.from("<title>Huge page</title>");
      for (;;) {
        produced++;
        yield Buffer.alloc(64 * 1024, 32);
      }
    }
    respond = () => html(endless());
    expect(await fetchLinkPreview("https://shop.example/x")).toMatchObject({ ok: true, preview: { title: "Huge page" } });
    expect(produced).toBeLessThan(20); // ~512 KB read, not the infinite body
  });

  it("caps a gzip bomb at the decompressed limit", async () => {
    const bomb = gzipSync(Buffer.concat([Buffer.from("<title>Small title</title>"), Buffer.alloc(30_000_000, 32)]));
    respond = () => html(bomb, 200, { "content-type": "text/html", "content-encoding": "gzip" });
    expect(await fetchLinkPreview("https://shop.example/x")).toMatchObject({ ok: true, preview: { title: "Small title" } });
  });

  it("handles corrupt compression and unknown encodings", async () => {
    respond = () => html("<title>not really gzip</title>", 200, { "content-type": "text/html", "content-encoding": "gzip" });
    expect(await fetchLinkPreview("https://shop.example/x")).toMatchObject({ ok: false });
    respond = () => html("<title>x</title>", 200, { "content-type": "text/html", "content-encoding": "compress" });
    expect(await fetchLinkPreview("https://shop.example/x")).toMatchObject({ ok: false, reason: expect.stringMatching(/isn’t a web page/) });
  });

  it("decodes declared charsets and tolerates invalid bytes or unknown charset labels", async () => {
    respond = () => html(Buffer.from([...Buffer.from("<title>Caf"), 0xe9, ...Buffer.from("</title>")]), 200, { "content-type": "text/html; charset=iso-8859-1" });
    expect(await fetchLinkPreview("https://shop.example/x")).toMatchObject({ ok: true, preview: { title: "Café" } });
    respond = () => html(Buffer.from([...Buffer.from("<title>Bad "), 0xff, 0xfe, ...Buffer.from(" bytes</title>")]), 200, { "content-type": "text/html; charset=no-such-charset" });
    expect(await fetchLinkPreview("https://shop.example/y")).toMatchObject({ ok: true, preview: { title: "Bad �� bytes" } });
  });

  it("rejects things that aren't links without any network activity", async () => {
    expect(await fetchLinkPreview("vintage coffee grinder")).toMatchObject({ ok: false });
    expect(lookup).not.toHaveBeenCalled();
    expect(connections).toEqual([]);
  });
});

// MOCKED: synthetic pages shaped like what real shops returned in a manual check on 2026-10-29
// (a product page, amazon.com's bare "Amazon.com" page, a robot check). No real retailer is contacted.
describe("fetchLinkPreview: does the page really identify a product?", () => {
  beforeEach(() => {
    lookup.mockResolvedValue(PUBLIC);
  });
  afterEach(() => {
    lookup.mockReset();
    connections.length = 0;
    respond = () => "hang";
    vi.useRealTimers();
  });
  const product = `<title>Apple iPhone 15 (Black, 128 GB) | Shop</title>
    <meta property="og:title" content="Apple iPhone 15 (Black, 128 GB)">
    <meta property="og:image" content="https://img.shop.example/iphone.jpg">
    <meta property="og:site_name" content="Shop Example">`;
  const preview = (page: string, url = "https://www.amazon.com/dp/B0CHX1W1XY") => {
    respond = () => html(page);
    return fetchLinkPreview(url);
  };
  const NO_DETAILS = /found no product details/;

  it("1. a real product page succeeds, exactly as written (nothing invented)", async () => {
    expect(await preview(product, "https://shop.example/p/iphone-15")).toEqual({
      ok: true,
      status: "success",
      method: "open-graph",
      missing: ["description"],
      preview: { url: "https://shop.example/p/iphone-15", title: "Apple iPhone 15 (Black, 128 GB)", image: "https://img.shop.example/iphone.jpg", siteName: "Shop Example" },
    });
  });

  it("keeps a product title that starts with the shop's name", async () => {
    expect(await preview(`<title>Amazon.com: Apple iPhone 15, 128GB, Black</title>`)).toMatchObject({ ok: true, preview: { title: "Amazon.com: Apple iPhone 15, 128GB, Black" } });
  });

  it.each([
    ["the bare domain", "<title>Amazon.com</title>"],
    ["the brand only", "<title>Amazon</title>"],
    ["the site name from og:site_name", `<meta property="og:site_name" content="Flipkart"><title>Flipkart</title>`],
    ["the domain with a separator", "<title> Amazon.com | </title>"],
    ["a generic word", "<title>Home</title>"],
    ["a not-found page", "<title>Page Not Found</title>"],
    ["the domain, with the site's logo as image", `<title>Amazon.com</title><meta property="og:image" content="https://www.amazon.com/logo.png">`],
  ])("2. a generic title (%s) is not a product, even on a product URL", async (_, page) => {
    expect(await preview(page)).toEqual({ ok: false, status: "failed", url: "https://www.amazon.com/dp/B0CHX1W1XY", reason: expect.stringMatching(NO_DETAILS) });
  });

  it("2. a shop's home page is not a product, whatever its title says", async () => {
    expect(await preview(`<title>Online Shopping for Electronics, Apparel and more</title>`, "https://www.amazon.com/")).toMatchObject({
      ok: false, url: "https://www.amazon.com/", reason: expect.stringMatching(/home page/),
    });
  });

  it.each([
    ["Amazon-style robot check", `<title>Amazon.com</title><p>Enter the characters you see below</p><p>Sorry, we just need to make sure you're not a robot.</p><form action="/errors/validateCaptcha">`],
    ["a 'Robot Check' title", `<title>Robot Check</title>`],
    ["a Cloudflare challenge", `<title>Just a moment...</title><script>window._cf_chl_opt={}</script>`],
    ["an access-denied page served with 200", `<title>Access Denied</title><h1>Access Denied</h1>`],
    ["a human-verification page with a product-like title", `<title>Apple iPhone 15</title><p>Please verify you are a human</p>`],
  ])("3. %s is reported as a human check, not a product", async (_, page) => {
    expect(await preview(page)).toEqual({ ok: false, status: "failed", url: "https://www.amazon.com/dp/B0CHX1W1XY", reason: expect.stringMatching(/human check/) });
  });

  it("3. an ordinary product page that merely loads reCAPTCHA is still a product", async () => {
    expect(await preview(`${product}<script src="https://www.google.com/recaptcha/api.js"></script><div class="g-recaptcha"></div>`, "https://shop.example/p/1")).toMatchObject({ ok: true });
  });

  it.each([
    ["no metadata at all", "<html><body>hello</body></html>"],
    ["only an image, no title", `<meta property="og:image" content="https://img.shop.example/x.jpg">`],
    ["an empty title", "<title>   </title>"],
    ["a two-letter title", "<title>Hi</title>"],
  ])("4. a page with %s is not a product", async (_, page) => {
    expect(await preview(page)).toMatchObject({ ok: false, reason: expect.stringMatching(NO_DETAILS) });
  });

  it("5. a product with no image succeeds without inventing one", async () => {
    const r = await preview(`<title>Vintage hand-crank coffee grinder</title>`, "https://shop.example/p/grinder");
    expect(r).toEqual({ ok: true, status: "partial", method: "meta", missing: ["image", "description"], preview: { url: "https://shop.example/p/grinder", title: "Vintage hand-crank coffee grinder" } });
  });

  it.each([[500], [404], [503]])("6. a failed response (%i) keeps the link for manual entry", async (status) => {
    respond = () => html("<title>Apple iPhone 15</title>", status);
    expect(await fetchLinkPreview("https://shop.example/p/1")).toEqual({ ok: false, status: "failed", url: "https://shop.example/p/1", reason: expect.stringMatching(new RegExp(`error ${status}`)) });
  });

  it("6. a timeout keeps the link for manual entry", async () => {
    vi.useFakeTimers();
    const pending = fetchLinkPreview("https://shop.example/p/1");
    await vi.advanceTimersByTimeAsync(7000);
    expect(await pending).toEqual({ ok: false, status: "failed", url: "https://shop.example/p/1", reason: expect.stringMatching(/too long/) });
  });

  it("7. a product page reached through a redirect to a private address is never read", async () => {
    respond = (url) => (url.hostname === "shop.example" ? redirect("http://127.0.0.1/p/1") : html(product));
    expect(await fetchLinkPreview("https://shop.example/p/1")).toMatchObject({ ok: false });
    expect(connections.map((c) => c.address)).toEqual(["93.184.216.34"]);
  });
});

describe("layered product extraction", () => {
  const page = "https://shop.example/p/1";
  const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

  it("1. JSON-LD Product wins over Open Graph, across several blocks, @graph and a broken block", () => {
    const doc = `<meta property="og:title" content="Shop Example – Grinder"><meta property="og:image" content="/og.jpg">
      <script type="application/ld+json">{ not json</script>
      ${ld({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] })}
      ${ld({ "@graph": [{ "@type": "WebPage" }, { "@type": ["Product"], name: "Zassenhaus &amp; Co. <b>Grinder</b>", description: "<p>Hand-cranked</p>", image: [{ "@type": "ImageObject", url: "/img/g.jpg" }] }] })}`;
    expect(parseMetadata(doc, page)).toMatchObject({ method: "json-ld", title: "Zassenhaus & Co. Grinder", description: "Hand-cranked", image: "https://shop.example/img/g.jpg" });
  });

  it("1. a ProductGroup takes its image from a variant, and a javascript: image falls through to Open Graph", () => {
    expect(parseMetadata(ld({ "@type": "ProductGroup", name: "Running shoe", hasVariant: [{ "@type": "Product", name: "Running shoe, UK 9", image: "https://img.shop.example/uk9.jpg" }] }), page)).toMatchObject({
      method: "json-ld", title: "Running shoe", image: "https://img.shop.example/uk9.jpg",
    });
    expect(parseMetadata(ld({ "@type": "Product", name: "Lamp", image: "javascript:alert(1)" }) + `<meta property="og:image" content="https://img.shop.example/lamp.jpg">`, page)).toMatchObject({
      method: "json-ld", title: "Lamp", image: "https://img.shop.example/lamp.jpg",
    });
  });

  it("survives deeply nested JSON-LD", () => {
    const deep = `<script type="application/ld+json">${"[".repeat(50_000)}${"]".repeat(50_000)}</script><title>Lamp</title>`;
    expect(parseMetadata(deep, page)).toMatchObject({ method: "meta", title: "Lamp" });
  });

  // Representative of a real amazon.in product page (Nov 2026): no Open Graph or JSON-LD, the main image ~330 KB in.
  const amazonProduct = `<html><head><meta name="title" content="Apple iPhone 15"/><meta name="description" content="Apple iPhone 15 (256 GB) - Black : Amazon.in: Electronics"/>
    <title>Apple iPhone 15</title></head><body><script>${"var x=1;".repeat(40_000)}</script>
    <img alt="Apple iPhone 15 (256 GB) - Black" src="https://m.media-amazon.com/images/I/31Kx._SX342_.jpg" data-old-hires="https://m.media-amazon.com/images/I/71657TiFeHL._SL1500_.jpg" onload="this.onload='';" data-a-image-name="landingImage" class="a-dynamic-image" id="landingImage">
    <span id="productTitle" class="a-size-large"> Apple iPhone 15 (256 GB) - Black </span></body></html>`;
  // Amazon's current bot page: title is just the shop name, and the form posts to /errors_page/validateCaptcha.
  const amazonBotPage = `<html><head><title dir="ltr">Amazon.com</title></head><body><!-- To discuss automated access to Amazon data please contact api-services-support@amazon.com. -->
    <h4>Click the button below to continue shopping</h4><form method="get" action="/errors_page/validateCaptcha"><button type="submit">Continue shopping</button></form></body></html>`;

  it("4. the Amazon adapter reads the product title and main image only on Amazon hosts", () => {
    expect(parseMetadata(amazonProduct, "https://www.amazon.in/dp/B0CHX1W1XY")).toMatchObject({
      method: "retailer", title: "Apple iPhone 15 (256 GB) - Black", image: "https://m.media-amazon.com/images/I/71657TiFeHL._SL1500_.jpg",
    });
    expect(parseMetadata(amazonProduct, "https://amazon.in.evil.example/dp/1")).toMatchObject({ method: "meta", title: "Apple iPhone 15", image: undefined });
  });

  describe("through fetchLinkPreview", () => {
    beforeEach(() => lookup.mockResolvedValue(PUBLIC));
    afterEach(() => {
      lookup.mockReset();
      connections.length = 0;
      respond = () => "hang";
    });

    it("an Amazon product page succeeds with title and image, well within 2.5 s", async () => {
      respond = () => html(amazonProduct);
      const started = performance.now();
      const r = await fetchLinkPreview("https://www.amazon.in/dp/B0CHX1W1XY");
      expect(performance.now() - started).toBeLessThan(2500);
      expect(r).toMatchObject({ ok: true, status: "success", method: "retailer", missing: [], preview: { title: "Apple iPhone 15 (256 GB) - Black" } });
    });

    it("the reported bug: Amazon's current bot page is a human check, not 'no product details'", async () => {
      respond = () => html(amazonBotPage);
      expect(await fetchLinkPreview("https://www.amazon.com/dp/B0CHX1W1XY")).toEqual({
        ok: false, status: "failed", url: "https://www.amazon.com/dp/B0CHX1W1XY", reason: expect.stringMatching(/human check/),
      });
    });

    it("stops reading once the <head> identifies the product, instead of waiting for a slow body", async () => {
      const body = new Readable({ read() {} });
      body.push(`<html><head><meta property="og:title" content="Desk lamp"><meta property="og:image" content="https://img.shop.example/lamp.jpg"></head><body>`);
      respond = () => Object.assign(body, { statusCode: 200, headers: { "content-type": "text/html" } }); // body never ends
      const started = performance.now();
      expect(await fetchLinkPreview("https://shop.example/p/lamp")).toMatchObject({ ok: true, status: "success", method: "open-graph" });
      expect(performance.now() - started).toBeLessThan(500);
    });

    it("shares one fetch between concurrent requests and reuses a success, but retries a failure", async () => {
      respond = () => html(`<title>Desk lamp</title>`);
      const [a, b] = await Promise.all([fetchLinkPreview("https://shop.example/p/lamp"), fetchLinkPreview("shop.example/p/lamp")]);
      expect(a).toEqual(b);
      await fetchLinkPreview("https://shop.example/p/lamp");
      expect(connections).toHaveLength(1);

      respond = () => html("", 500);
      await fetchLinkPreview("https://shop.example/p/broken");
      await fetchLinkPreview("https://shop.example/p/broken");
      expect(connections).toHaveLength(3);
    });
  });
});

describe("safeImageUrl (F-11)", () => {
  it.each([
    ["https on a named host", "https://cdn.shop.example.com/p/1.jpg", "https://cdn.shop.example.com/p/1.jpg"],
    ["the default port, normalised", "https://cdn.example.com:443/a.png", "https://cdn.example.com/a.png"],
    ["plain http", "http://cdn.example.com/1.jpg", null],
    ["localhost", "https://localhost/1.jpg", null],
    ["an internal name", "https://images.internal/1.jpg", null],
    ["a private IPv4 address", "https://192.168.1.10/1.jpg", null],
    ["a public IP literal", "https://8.8.8.8/1.jpg", null],
    ["an IPv6 literal", "https://[::1]/1.jpg", null],
    ["credentials", "https://user:pw@example.com/1.jpg", null],
    ["another port", "https://example.com:8443/1.jpg", null],
    ["a single-label host", "https://intranet/1.jpg", null],
    ["javascript:", "javascript:alert(1)", null],
    ["data:", "data:image/png;base64,AAAA", null],
    ["a malformed URL", "https://exa mple.com/1.jpg", null],
    ["not a URL", "cdn.example.com/1.jpg", null],
  ])("%s", (_label, input, expected) => expect(safeImageUrl(input)).toBe(expected));

  it("upgrades http product images found on a page, and drops private ones", () => {
    const page = "https://shop.example/p/1";
    expect(parseMetadata(`<meta property="og:image" content="http://cdn.example.com/a.jpg">`, page).image).toBe("https://cdn.example.com/a.jpg");
    expect(parseMetadata(`<meta property="og:image" content="https://10.0.0.5/a.jpg">`, page).image).toBeUndefined();
  });
});
