import { afterEach, describe, expect, it, vi } from "vitest";
import { createLimiter } from "@/lib/rate-limit";

const ok = async () => "done";

describe("createLimiter", () => {
  it("limits each key within the window, then allows again", async () => {
    const run = createLimiter({ perKey: 2, global: 100, windowMs: 1000, maxInFlight: 10 });
    expect(await run("a", ok, 0)).toEqual({ value: "done" });
    expect(await run("a", ok, 10)).toEqual({ value: "done" });
    expect(await run("a", ok, 20)).toEqual({ limited: "rate" });
    expect(await run("b", ok, 20)).toEqual({ value: "done" });
    expect(await run("a", ok, 1001)).toEqual({ value: "done" });
  });

  it("has a global ceiling that rotating keys can't get around", async () => {
    const run = createLimiter({ perKey: 5, global: 3, windowMs: 1000, maxInFlight: 10 });
    for (const k of ["a", "b", "c"]) expect(await run(k, ok, 0)).toEqual({ value: "done" });
    expect(await run("d", ok, 0)).toEqual({ limited: "rate" });
  });

  it("caps concurrent tasks and frees the slot even when a task fails", async () => {
    const run = createLimiter({ perKey: 10, global: 100, windowMs: 1000, maxInFlight: 2 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = [run("a", () => gate, 0), run("b", () => gate, 0)];
    expect(await run("c", ok, 0)).toEqual({ limited: "busy" });
    release();
    await Promise.all(slow);
    await expect(run("c", () => Promise.reject(new Error("boom")), 0)).rejects.toThrow("boom");
    expect(await run("c", ok, 0)).toEqual({ value: "done" });
  });

  it("bounds memory used for keys", async () => {
    const run = createLimiter({ perKey: 5, global: 100, windowMs: 1000, maxInFlight: 10, maxKeys: 2 });
    await run("a", ok, 0);
    await run("b", ok, 0);
    expect(await run("c", ok, 0)).toEqual({ limited: "busy" });
    expect(await run("c", ok, 2000)).toEqual({ value: "done" }); // stale keys pruned
  });
});

const fetchLinkPreview = vi.fn(async (url: string) => ({ ok: true as const, preview: { url } }));
let ip = "203.0.113.1";
vi.mock("@/lib/link-preview", () => ({ fetchLinkPreview: (u: string) => fetchLinkPreview(u) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": `${ip}, 10.0.0.1` }) }));
const { previewLink } = await import("@/app/request/actions");

describe("previewLink action", () => {
  afterEach(() => fetchLinkPreview.mockClear());

  it("validates input before doing any work or using up the visitor's allowance", async () => {
    for (const bad of [42, null, "not a link", "x".repeat(3000)]) expect(await previewLink(bad)).toMatchObject({ ok: false });
    expect(fetchLinkPreview).not.toHaveBeenCalled();
  });

  it("rate-limits one visitor with a friendly message, without blocking others", async () => {
    for (let i = 0; i < 8; i++) expect(await previewLink(`https://shop.example/${i}`)).toMatchObject({ ok: true });
    const limited = await previewLink("https://shop.example/9");
    expect(limited).toMatchObject({ ok: false, code: "rate_limited", reason: expect.stringMatching(/wait a minute/) });
    expect(fetchLinkPreview).toHaveBeenCalledTimes(8);
    ip = "198.51.100.2";
    expect(await previewLink("https://shop.example/x")).toMatchObject({ ok: true });
  });
});
