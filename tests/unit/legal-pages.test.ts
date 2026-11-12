// The draft Privacy Policy and Terms: they must read as drafts and must not invent facts or promises.
import { readFileSync } from "node:fs";
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

  it("are linked from the footer", () => {
    const footer = read("components/nav/site-footer.tsx");
    expect(footer).toContain('href: "/privacy"');
    expect(footer).toContain('href: "/terms"');
  });
});
