// Shared design-system components and the header's menus, rendered to HTML (first render only;
// opening, Escape and outside clicks are checked in the browser).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormMessage } from "@/components/form-message";
import { AccountMenu } from "@/components/nav/account-menu";
import { MobileMenu } from "@/components/nav/mobile-menu";
import { accountLinks, SIGNED_OUT_LINKS } from "@/components/nav/nav-items";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("Alert and FormMessage", () => {
  it("errors interrupt screen readers; every other tone is announced politely", () => {
    expect(html(h(Alert, { tone: "error" }, "No"))).toMatch(/^<div role="alert"/);
    for (const tone of ["success", "info", "warning"] as const) expect(html(h(Alert, { tone }, "Ok"))).toMatch(/^<div role="status"/);
  });

  it("shows one message: error, then success, then notice; success is green, not the warning amber", () => {
    expect(html(h(FormMessage, { error: "Bad", success: "Saved.", notice: "Hi" }))).toContain("Bad");
    const success = html(h(FormMessage, { success: "Saved.", notice: "Hi" }));
    expect(success).toContain("Saved.");
    expect(success).toContain("bg-success-soft");
    expect(html(h(FormMessage, { notice: "Check your email" }))).toContain("bg-info-soft");
    expect(html(h(FormMessage, {}))).toBe("");
  });
});

describe("Button and Field", () => {
  it("a loading button is disabled, marked busy and says what it's doing", () => {
    const out = html(h(Button, { loading: true, loadingText: "Saving…" }, "Save"));
    expect(out).toMatch(/disabled=""/);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Saving…");
    expect(out).not.toContain(">Save<");
  });

  it("links the label, hint and error to the control", () => {
    const out = html(h(Field, { label: "City", hint: "In India", error: "Required", children: (p: object) => h(Input, p) }));
    const id = out.match(/<label for="([^"]+)"/)![1];
    expect(out).toContain(`id="${id}"`);
    expect(out).toContain(`aria-describedby="${id}-hint ${id}-error"`);
    expect(out).toContain('aria-invalid="true"');
  });
});

describe("header menus", () => {
  it("My requests is offered only once saving requests to an account is open", () => {
    expect(accountLinks(false).map((l) => l.href)).toEqual(["/#start", "/travel", "/profile"]);
    expect(accountLinks(true).map((l) => l.href)).toEqual(["/#start", "/travel", "/requests", "/profile"]);
  });

  it("menus start closed, with a labelled toggle that controls the panel", () => {
    for (const out of [
      html(h(MobileMenu, { account: null, links: SIGNED_OUT_LINKS })),
      html(h(AccountMenu, { account: { email: "asha@example.com", phoneVerified: false }, links: accountLinks(false) })),
    ]) {
      expect(out).toContain('aria-expanded="false"');
      expect(out).toMatch(/aria-controls="[^"]+"/);
      expect(out).not.toContain("Log out");
    }
  });
});
