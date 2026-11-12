// The draft Privacy Policy and Terms: they must read as drafts and must not invent facts or promises.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const pages = { privacy: read("app/privacy/page.tsx"), terms: read("app/terms/page.tsx") };
const layout = read("components/legal/legal-page.tsx");

describe("draft legal pages", () => {
  it("show the draft notice and say they aren't in effect", () => {
    expect(layout).toContain('DRAFT_NOTICE = "Draft — Pending Legal Review"');
    expect(layout).toMatch(/Not yet in effect/);
    expect(layout).toMatch(/hasn’t been legally approved/);
  });

  it("publish no invented contact details", () => {
    for (const [name, src] of Object.entries(pages)) {
      expect(src, name).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i); // email address
      expect(src, name).not.toMatch(/\+?\d[\d\s-]{8,}\d/); // phone or registration number
      expect(src, name).toMatch(/not yet\s+available in this draft/);
    }
  });

  it("make no payment, escrow, guarantee or compliance claims", () => {
    const all = Object.values(pages).join("\n");
    expect(all).toMatch(/doesn’t take or process payments/);
    for (const claim of [/we guarantee/i, /fully compliant/i, /compliant with/i, /\bis insured\b/i, /track your (parcel|shipment)/i, /refund within/i]) {
      expect(all).not.toMatch(claim);
    }
    // Every mention of escrow or buyer protection is a denial.
    for (const line of all.split("\n").filter((l) => /escrow|buyer protection/i.test(l))) expect(line).toMatch(/doesn’t|isn’t|no /);
  });
});

// Until legal review is complete the drafts aren't public: both routes 404 and nothing links to them.
describe("draft legal pages while unpublished", () => {
  it("are switched off", async () => {
    expect((await import("@/lib/preview")).LEGAL_PAGES_PUBLISHED).toBe(false);
  });

  it.each([
    ["/privacy", () => import("@/app/privacy/page")],
    ["/terms", () => import("@/app/terms/page")],
  ])("%s returns 404 without rendering the draft", async (_route, load) => {
    const Page = (await load()).default;
    let thrown: unknown;
    try {
      Page();
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { digest?: string })?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("aren't linked from any page, navigation or footer", () => {
    const linking: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        // The drafts may link to each other: they never render while unpublished.
        else if (/\.tsx?$/.test(entry.name) && !/app\/(privacy|terms)\/|components\/legal\//.test(path)) {
          if (/["'`]\/(privacy|terms)\b/.test(readFileSync(path, "utf8"))) linking.push(path); // a quoted path: href, Link, redirect
        }
      }
    };
    walk(fileURLToPath(new URL("../../src", import.meta.url)));
    expect(linking).toEqual([]);
  });

  it("aren't in the sitemap", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    expect(sitemap().map((e) => new URL(e.url).pathname)).not.toEqual(expect.arrayContaining(["/privacy"]));
    expect(sitemap().map((e) => new URL(e.url).pathname)).not.toEqual(expect.arrayContaining(["/terms"]));
  });
});
