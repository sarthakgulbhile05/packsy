// Request server actions with Supabase and auth mocked: these check our logic (the gate, ownership
// scoping, never trusting the browser, honest errors), not real database behaviour. The database rules
// themselves are tested in tests/db/requests-stage3a.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft } from "@/lib/request-draft";

const flags = vi.hoisted(() => ({ open: true }));
vi.mock("@/lib/preview", () => ({
  get ACCOUNT_REQUESTS_OPEN() {
    return flags.open;
  },
  SIGNUPS_OPEN: true,
  SIGNUPS_CLOSED: "",
}));

// A chainable stand-in for supabase.from("requests"), recording every call.
const calls: { method: string; args: unknown[] }[] = [];
let reply: { data: unknown; error: unknown } = { data: [{ id: "11111111-1111-4111-8111-111111111111" }], error: null };
const chain: Record<string, unknown> = {};
for (const method of ["insert", "update", "delete", "eq", "select"]) {
  chain[method] = (...args: unknown[]) => {
    calls.push({ method, args });
    return chain;
  };
}
chain.then = (resolve: (v: unknown) => void) => resolve(reply);
const rpc = vi.fn();
const supabase = { from: vi.fn(() => chain), rpc };
const USER = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const auth = vi.hoisted(() => ({ requireUser: vi.fn(), requireVerifiedPhone: vi.fn() }));
vi.mock("@/lib/auth", () => auth);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { saveRequest, publishRequest, deleteRequest } = await import("@/app/request/actions");

const ID = "3f1c2b8a-1d2e-4f5a-9b6c-7d8e9f0a1b2c";
const draft = { ...emptyDraft("text"), title: "Vintage coffee grinder", from: "US", to: "IN", deliverTo: "Pune" };
let users = 0;

beforeEach(() => {
  flags.open = true;
  calls.length = 0;
  reply = { data: [{ id: "11111111-1111-4111-8111-111111111111" }], error: null };
  // A fresh user id per test keeps the per-user rate limit from leaking between tests.
  const user = { ...USER, id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++users).padStart(12, "0")}` };
  auth.requireUser.mockResolvedValue({ supabase, user });
  auth.requireVerifiedPhone.mockResolvedValue({ supabase, user });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("while account requests are closed (before stage 3a)", () => {
  it.each([
    ["save", () => saveRequest(draft)],
    ["publish", () => publishRequest(ID)],
    ["delete", () => deleteRequest(ID)],
  ])("%s refuses without touching auth or the database", async (_name, call) => {
    flags.open = false;
    expect(await call()).toEqual({ ok: false, reason: expect.stringMatching(/opens soon/) });
    expect(auth.requireUser).not.toHaveBeenCalled();
    expect(auth.requireVerifiedPhone).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("saveRequest", () => {
  it("creates a draft with only form fields; owner, status and dates are never sent", async () => {
    const result = await saveRequest({ ...draft, shopper_id: "someone-else", status: "open", published_at: "2026-01-01" });
    expect(result).toEqual({ ok: true, id: "11111111-1111-4111-8111-111111111111", photoLeftOnDevice: false });
    const insert = calls.find((c) => c.method === "insert")!.args[0] as Record<string, unknown>;
    for (const key of ["shopper_id", "status", "published_at", "expires_at", "id", "image_path"]) expect(insert).not.toHaveProperty(key);
    expect(auth.requireVerifiedPhone).toHaveBeenCalledWith("/request/new");
  });

  it("needs a verified phone, checked on the server (signed-out or unverified buyers are redirected)", async () => {
    auth.requireVerifiedPhone.mockRejectedValue(new Error("REDIRECT /verify-phone?next=%2Frequest%2Fnew"));
    await expect(saveRequest(draft)).rejects.toThrow(/REDIRECT \/verify-phone/);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("refuses invalid input before checking auth or calling the database", async () => {
    const result = await saveRequest({ ...draft, title: "ab", budget: "-1" });
    expect(result).toMatchObject({ ok: false, errors: { title: expect.any(String), budget: expect.any(String) } });
    expect(auth.requireVerifiedPhone).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("updates only the caller's own draft: scoped by id and the server's user id, never the browser's", async () => {
    await saveRequest({ ...draft, shopper_id: "someone-else" }, ID);
    const eqs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    const user = (await auth.requireVerifiedPhone.mock.results[0].value).user;
    expect(eqs).toEqual([["id", ID], ["shopper_id", user.id]]);
  });

  it("reports someone else's, published or deleted requests the same way (no rows changed)", async () => {
    reply = { data: [], error: null };
    expect(await saveRequest(draft, ID)).toEqual({ ok: false, reason: expect.stringMatching(/isn’t available/) });
  });

  it.each([null, "", "../x", 5, "3f1c2b8a"])("refuses a malformed id %j before any call", async (id) => {
    expect(await saveRequest(draft, id)).toMatchObject({ ok: false });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("maps database errors to fixed messages and logs only the code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    reply = { data: null, error: { code: "23514", message: "new row for relation \"requests\" violates check constraint secret_detail" } };
    expect(await saveRequest(draft)).toEqual({ ok: false, reason: "Some details aren’t valid. Please check them and try again." });
    reply = { data: null, error: { code: "", message: "TypeError: fetch failed" } };
    expect(await saveRequest(draft)).toEqual({ ok: false, reason: expect.stringMatching(/couldn’t save/) });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret_detail|fetch failed/);
    log.mockRestore();
  });

  it("says when a photo stayed on the device", async () => {
    expect(await saveRequest({ ...draft, source: "photo", image: "data:image/jpeg;base64,AAAA" })).toMatchObject({ ok: true, photoLeftOnDevice: true });
  });

  it("limits each buyer to 10 changes a minute", async () => {
    for (let i = 0; i < 10; i++) expect((await saveRequest(draft)).ok).toBe(true);
    expect(await saveRequest(draft)).toEqual({ ok: false, reason: expect.stringMatching(/a lot of changes/) });
  });
});

describe("publishRequest", () => {
  it("publishes through the database function with exactly that id, after a server-side phone check", async () => {
    rpc.mockResolvedValue({ data: "2026-11-28 18:30:00+00", error: null });
    expect(await publishRequest(ID)).toEqual({ ok: true, id: ID, expiresAt: "2026-11-28 18:30:00+00" });
    expect(rpc).toHaveBeenCalledWith("publish_request", { p_request_id: ID });
    expect(auth.requireVerifiedPhone).toHaveBeenCalledWith(`/requests/${ID}`);
  });

  it.each([
    ["Request not found or not allowed", "42501", /isn’t available/],
    ["Verify your phone number before publishing", "42501", /Verify your phone/],
    ["Only drafts can be published", "P0001", /already published or closed/],
    ["The needed-by date has passed; change it before publishing", "P0001", /date has passed/],
    ["Photos can't be published until image storage is set up", "P0001", /own photo/],
    ["something unexpected with internal detail", "XX000", /couldn’t publish/],
  ])("maps %j to a fixed message, never the raw text", async (message, code, expected) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code, message } });
    const result = await publishRequest(ID);
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(expected) });
    expect(JSON.stringify(result)).not.toMatch(/internal detail/);
  });

  it("refuses a malformed id before any call", async () => {
    expect(await publishRequest("not-an-id")).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(auth.requireVerifiedPhone).not.toHaveBeenCalled();
  });
});

describe("deleteRequest", () => {
  it("deletes only the caller's own row, scoped by the server's user id", async () => {
    expect(await deleteRequest(ID)).toEqual({ ok: true, id: ID });
    const user = (await auth.requireUser.mock.results[0].value).user;
    expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["id", ID], ["shopper_id", user.id]]);
  });

  it("explains when nothing was deleted (published, someone else's, or gone)", async () => {
    reply = { data: [], error: null };
    expect(await deleteRequest(ID)).toEqual({ ok: false, reason: "Only drafts can be deleted." });
  });
});
