// Page titles, descriptions and icons for the public preview. Reads the real route modules and files.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// next/font only works inside Next's compiler.
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "" });
  return { Geist: font, Geist_Mono: font, Poppins: font };
});

const NEXT_DEFAULT_FAVICON_MD5 = "2be26fb5639bc7a24d9c816567b0de5f"; // create-next-app's black "N"

const pages = {
  layout: await import("@/app/layout"),
  login: await import("@/app/login/page"),
  signup: await import("@/app/signup/page"),
  verifyPhone: await import("@/app/verify-phone/page"),
  forgotPassword: await import("@/app/forgot-password/page"),
  resetPassword: await import("@/app/reset-password/page"),
  profile: await import("@/app/profile/page"),
  travel: await import("@/app/travel/page"),
  explore: await import("@/app/explore/page"),
  tracking: await import("@/app/tracking/page"),
  request: await import("@/app/request/new/page"),
  myRequests: await import("@/app/requests/page"),
  requestDetail: await import("@/app/requests/[id]/page"),
  notFound: await import("@/app/not-found"),
  privacy: await import("@/app/privacy/page"),
  terms: await import("@/app/terms/page"),
};
const home = await import("@/app/page");

describe("page titles", () => {
  it("the layout gives a default title and a ' · Orbitly' template", () => {
    expect(pages.layout.metadata.title).toEqual({ default: expect.stringMatching(/^Orbitly/), template: "%s · Orbitly" });
    expect(pages.layout.metadata.description).toMatch(/India/);
  });

  it("every page has its own non-empty title", () => {
    const titles = Object.entries(pages)
      .filter(([name]) => name !== "layout")
      .map(([, mod]) => (mod as { metadata: { title: string } }).metadata.title);
    expect(titles.every((t) => typeof t === "string" && t.length > 2 && !t.includes("Orbitly"))).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("icons", () => {
  const md5 = (path: string) => createHash("md5").update(readFileSync(path)).digest("hex");

  it("the favicon is no longer Next.js's default", () => {
    expect(md5("src/app/favicon.ico")).not.toBe(NEXT_DEFAULT_FAVICON_MD5);
  });

  it.each(["src/app/icon.png", "src/app/apple-icon.png"])("%s is a real PNG", (path) => {
    expect(readFileSync(path).subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("search engines", () => {
  it("the layout carries Google's Search Console token exactly, once", () => {
    expect(pages.layout.metadata.verification).toEqual({ google: "DENiEuoAnU-B6iSKzgcOh8ZOiha5sya0G2iaCUx0kyA" });
    // No page overrides or duplicates it.
    for (const [name, page] of Object.entries(pages)) {
      if (name !== "layout") expect((page as { metadata?: { verification?: unknown } }).metadata?.verification, name).toBeUndefined();
    }
  });

  const meta = (mod: unknown) => (mod as { metadata: { robots?: { index: boolean }; alternates?: { canonical: string } } }).metadata;
  const PRIVATE = ["login", "signup", "verifyPhone", "forgotPassword", "resetPassword", "profile", "request", "myRequests", "requestDetail", "tracking", "privacy", "terms"] as const;

  it("private and sign-in pages are noindex; public pages are indexable with a canonical URL", () => {
    expect(PRIVATE.filter((name) => meta(pages[name]).robots?.index !== false)).toEqual([]);
    expect(meta(home).alternates?.canonical).toBe("/");
    expect(meta(pages.travel).alternates?.canonical).toBe("/travel");
    expect(meta(home).robots).toBeUndefined();
    expect(meta(pages.travel).robots).toBeUndefined();
    // /explore is public but shows only illustrative examples: reachable, followed, not indexed.
    expect(meta(pages.explore).alternates?.canonical).toBe("/explore");
    expect(meta(pages.explore).robots).toEqual({ index: false, follow: true });
  });

  it("the sitemap lists only the public pages, and robots.txt points to it", async () => {
    vi.stubEnv("SITE_URL", "https://orbitly.example");
    const sitemap = (await import("@/app/sitemap")).default;
    const robots = (await import("@/app/robots")).default;
    expect(sitemap().map((e) => e.url)).toEqual(["https://orbitly.example/", "https://orbitly.example/travel"]);
    expect(robots().sitemap).toBe("https://orbitly.example/sitemap.xml");
    vi.unstubAllEnvs();
  });

  it("the FAQ structured data comes from the same list the page shows", async () => {
    const { QUESTIONS } = await import("@/components/home/faq");
    const { JsonLd } = await import("@/components/seo/json-ld");
    // The page's top-level children, without rendering the client components below them.
    const children = (home.default() as React.ReactElement<{ children: React.ReactElement<{ data: object }>[] }>).props.children;
    const json = JSON.parse(JSON.stringify(children.find((c) => c?.type === JsonLd)!.props.data));
    const faq = json["@graph"].find((n: { "@type": string }) => n["@type"] === "FAQPage");
    expect(faq.mainEntity.map((e: { name: string }) => e.name)).toEqual(QUESTIONS.map((q) => q.q));
    expect(JSON.stringify(json)).not.toMatch(/"(aggregateRating|review|offers|price)":/);
  });

  it("home and /travel share the generated 1200×630 card on Open Graph and Twitter", async () => {
    const card = await import("@/app/opengraph-image");
    type Img = { url: string; width: number; height: number; alt: string };
    const social = (mod: unknown) => (mod as { metadata: { openGraph?: { images?: Img[] }; twitter?: { card: string; images?: Img[] } } }).metadata;
    const expected = { url: "/opengraph-image", width: card.size.width, height: card.size.height, alt: card.alt };
    expect(card.size).toEqual({ width: 1200, height: 630 });
    expect(social(home).openGraph?.images).toEqual([expected]);
    expect(social(pages.travel).openGraph?.images).toEqual([expected]);
    expect(social(pages.travel).twitter).toEqual({ card: "summary_large_image", images: [expected] });
  });
});
