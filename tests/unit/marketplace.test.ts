// Two-way marketplace: countries, trip and offer validation, and the trip/offer/lifecycle server actions with
// Supabase and auth mocked. These check our logic (the switch, never trusting the browser, honest errors);
// the database rules themselves are tested in tests/db/marketplace-stage4.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTRY_OPTIONS, countryName, isCountryCode, routeLabel } from "@/lib/countries";
import { offerToRow } from "@/lib/offer";
import { tripStatus, tripToRow, validateTrip, type TripInput } from "@/lib/trip";

const flags = vi.hoisted(() => ({ open: true }));
vi.mock("@/lib/preview", () => ({
  get MARKETPLACE_OPEN() {
    return flags.open;
  },
  ACCOUNT_REQUESTS_OPEN: true,
  SIGNUPS_OPEN: true,
  SIGNUPS_CLOSED: "",
}));

const calls: { method: string; args: unknown[] }[] = [];
let reply: { data: unknown; error: unknown } = { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null };
const chain: Record<string, unknown> = {};
for (const method of ["insert", "update", "eq", "select", "single", "maybeSingle"]) {
  chain[method] = (...args: unknown[]) => {
    calls.push({ method, args });
    return chain;
  };
}
chain.then = (resolve: (v: unknown) => void) => resolve(reply);
const rpc = vi.fn();
const supabase = { from: vi.fn(() => chain), rpc };
const auth = vi.hoisted(() => ({ requireUser: vi.fn(), requireVerifiedPhone: vi.fn() }));
vi.mock("@/lib/auth", () => auth);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const nav = vi.hoisted(() => ({ redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }) }));
vi.mock("next/navigation", () => nav);

const { createTrip, sendOffer, withdrawOffer, cancelTrip } = await import("@/app/trips/actions");
const { acceptOffer, cancelRequest, declineOffer } = await import("@/app/request/actions");

const TODAY = "2026-11-01";
const trip: TripInput = { from: "US", to: "IN", departureDate: "2026-11-10", arrivalDate: "2026-11-11", capacityKg: "", notes: "" };
const ID = "3f1c2b8a-1d2e-4f5a-9b6c-7d8e9f0a1b2c";
const TRIP_ID = "22222222-2222-4222-8222-222222222222";
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const OFFER = { productPrice: "999", currency: "USD", rate: "83.5", serviceFee: "1500", handoff: "meet_in_person", lawful: "on" };
let users = 0;

beforeEach(() => {
  flags.open = true;
  calls.length = 0;
  reply = { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null };
  const user = { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++users).padStart(12, "0")}` };
  auth.requireUser.mockResolvedValue({ supabase, user });
  auth.requireVerifiedPhone.mockResolvedValue({ supabase, user });
});
afterEach(() => vi.clearAllMocks());

describe("countries", () => {
  it("stores codes, shows names, and isn't limited to India and the USA", () => {
    expect(isCountryCode("IN") && isCountryCode("US") && isCountryCode("GB") && isCountryCode("AE")).toBe(true);
    expect(isCountryCode("India")).toBe(false);
    expect(countryName("US")).toBe("United States");
    expect(routeLabel("IN", "US")).toBe("India → United States");
    expect(COUNTRY_OPTIONS[0].code).toBe("IN");
  });
});

describe("trips: validation", () => {
  it("accepts either direction", () => {
    expect(validateTrip(trip, TODAY)).toEqual({});
    expect(validateTrip({ ...trip, from: "IN", to: "US" }, TODAY)).toEqual({});
  });

  it("refuses a missing or same-country route, past or reversed dates, long trips and odd weights", () => {
    expect(validateTrip({ ...trip, to: "US" }, TODAY).route).toMatch(/different/);
    expect(validateTrip({ ...trip, from: "" }, TODAY).route).toBeDefined();
    expect(validateTrip({ ...trip, departureDate: "2026-10-01", arrivalDate: "2026-10-02" }, TODAY).departureDate).toBeDefined();
    expect(validateTrip({ ...trip, arrivalDate: "2026-11-09" }, TODAY).arrivalDate).toMatch(/before departure/);
    expect(validateTrip({ ...trip, arrivalDate: "2026-12-20" }, TODAY).arrivalDate).toMatch(/30 days/);
    expect(validateTrip({ ...trip, capacityKg: "250" }, TODAY).capacityKg).toBeDefined();
    expect(validateTrip({ ...trip, capacityKg: "7.5" }, TODAY).capacityKg).toBeUndefined();
  });

  it("builds a row from known fields only", () => {
    const r = tripToRow({ ...trip, capacityKg: "7.5", notes: "Cabin bag only" }, TODAY);
    expect(r).toEqual({ ok: true, row: { departure_country: "US", destination_country: "IN", departure_date: "2026-11-10", arrival_date: "2026-11-11", capacity_kg: 7.5, notes: "Cabin bag only" } });
  });

  it("shows a trip whose arrival has passed as finished", () => {
    expect(tripStatus({ status: "active", arrival_date: "2026-10-30" }, TODAY).label).toBe("Finished");
    expect(tripStatus({ status: "active", arrival_date: "2026-11-30" }, TODAY).live).toBe(true);
  });
});

describe("offers: validation", () => {
  const ids = { requestId: ID, tripId: TRIP_ID, arrivalDate: "2026-11-11" };

  it("builds a complete offer; the arrival date comes from the trip, not the form", () => {
    const r = offerToRow(form({ ...OFFER, arrivalDate: "2099-01-01" }), ids);
    expect(r).toEqual({ ok: true, row: expect.objectContaining({ arrival_date: "2026-11-11", trip_id: TRIP_ID, fx_rate_to_inr: 83.5, service_fee_inr: 1500, declares_lawful_import: true }) });
  });

  it("uses a rate of 1 for rupee prices, whatever the form says", () => {
    const r = offerToRow(form({ ...OFFER, currency: "INR", rate: "90" }), ids);
    expect(r.ok && r.row.fx_rate_to_inr).toBe(1);
  });

  it("needs the lawful-carriage declaration, a handoff and sensible amounts", () => {
    const missing = offerToRow(form(Object.fromEntries(Object.entries(OFFER).filter(([k]) => k !== "lawful"))), ids);
    expect(!missing.ok && missing.errors.lawful).toBeTruthy();
    const bad = offerToRow(form({ ...OFFER, handoff: "drop_at_border", serviceFee: "-1", productPrice: "0" }), ids);
    expect(!bad.ok && Object.keys(bad.errors).sort()).toEqual(["handoff", "productPrice", "serviceFee"]);
  });

  it("accepts any whole-rupee reward from ₹1 to ₹10,00,000: no ₹300 minimum (Q13a, Q13g)", () => {
    for (const fee of ["1", "200", "300", "333", "334", "1000000"]) {
      const r = offerToRow(form({ ...OFFER, serviceFee: fee }), ids);
      expect(r.ok && r.row.service_fee_inr, fee).toBe(Number(fee));
    }
  });

  it("refuses ₹0, negative, fractional, non-numeric and oversized rewards (Q13g)", () => {
    for (const fee of ["0", "00", "-1", "333.5", "1.0", "abc", "", "1000001", "99999999"]) {
      const r = offerToRow(form({ ...OFFER, serviceFee: fee }), ids);
      expect(!r.ok && r.errors.serviceFee, fee).toBe("Enter a reward in whole rupees, from ₹1 to ₹10,00,000.");
    }
  });
});

describe("while the marketplace is closed (before stage 4)", () => {
  it.each([
    ["create trip", () => createTrip({}, form({}))],
    ["send offer", () => sendOffer({}, form({}))],
  ])("%s refuses without touching auth or the database", async (_name, call) => {
    flags.open = false;
    expect(await call()).toEqual({ message: expect.stringMatching(/open soon/) });
    expect(auth.requireUser).not.toHaveBeenCalled();
    expect(auth.requireVerifiedPhone).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each([
    ["cancel trip", () => cancelTrip(ID)],
    ["withdraw", () => withdrawOffer(ID)],
    ["accept", () => acceptOffer(ID, ID)],
    ["cancel request", () => cancelRequest(ID)],
  ])("%s refuses without touching auth or the database", async (_name, call) => {
    flags.open = false;
    expect(await call()).toEqual({ ok: false, reason: expect.stringMatching(/open soon/) });
    expect(auth.requireUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("trip and offer actions", () => {
  it("creates a trip with form fields only, needs a verified phone, then opens it", async () => {
    await expect(createTrip({}, form({ ...trip, departureDate: soon(10), arrivalDate: soon(11), traveller_id: "x", status: "completed" }))).rejects.toThrow(
      "redirect:/trips/11111111-1111-4111-8111-111111111111",
    );
    expect(auth.requireVerifiedPhone).toHaveBeenCalledWith("/trips");
    const insert = calls.find((c) => c.method === "insert")!.args[0] as Record<string, unknown>;
    expect(Object.keys(insert).sort()).toEqual(["arrival_date", "capacity_kg", "departure_country", "departure_date", "destination_country", "notes"]);
  });

  it("returns field errors without touching the database", async () => {
    const state = await createTrip({}, form({ ...trip, to: "US" }));
    expect(state.errors?.route).toBeDefined();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("sends an offer using the trip's own arrival date, read from the caller's trip", async () => {
    reply = { data: { arrival_date: "2099-01-02" }, error: null };
    const state = await sendOffer({}, form({ ...OFFER, requestId: ID, tripId: TRIP_ID }));
    expect(state).toEqual({ sent: true });
    const insert = calls.find((c) => c.method === "insert")!.args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({ request_id: ID, trip_id: TRIP_ID, arrival_date: "2099-01-02" });
    expect(insert).not.toHaveProperty("traveller_id");
    expect(insert).not.toHaveProperty("status");
  });

  it("maps a refused offer to a fixed message", async () => {
    let n = 0;
    chain.then = (resolve: (v: unknown) => void) =>
      resolve(n++ === 0 ? { data: { arrival_date: "2099-01-02" }, error: null } : { data: null, error: { code: "42501", message: "new row violates row-level security policy" } });
    expect(await sendOffer({}, form({ ...OFFER, requestId: ID, tripId: TRIP_ID }))).toEqual({ message: expect.stringMatching(/no longer matches your trip/) });
    chain.then = (resolve: (v: unknown) => void) => resolve(reply);
  });

  it("explains, without saving anything, when dev's v1.1 database still refuses a reward under the old ₹300 floor", async () => {
    let n = 0;
    chain.then = (resolve: (v: unknown) => void) =>
      resolve(n++ === 0 ? { data: { arrival_date: "2099-01-02" }, error: null } : { data: null, error: { code: "23514", message: 'new row for relation "offers" violates check constraint "offers_min_net_reward"' } });
    expect(await sendOffer({}, form({ ...OFFER, serviceFee: "200", requestId: ID, tripId: TRIP_ID }))).toEqual({ message: expect.stringMatching(/pricing has been updated.*Nothing was sent/) });
    chain.then = (resolve: (v: unknown) => void) => resolve(reply);
  });

  it("rejects ids that aren't UUIDs before touching anything", async () => {
    expect(await withdrawOffer("1 or 1=1")).toEqual({ ok: false, reason: expect.any(String) });
    expect(await sendOffer({}, form({ requestId: "x", tripId: TRIP_ID }))).toEqual({ message: expect.any(String) });
    expect(auth.requireUser).not.toHaveBeenCalled();
  });
});

describe("lifecycle steps", () => {
  it("call one fixed database function with the id, as the signed-in user", async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await acceptOffer(ID, TRIP_ID)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("accept_offer", { p_offer_id: ID, p_policy_version: "1.3" });
    expect(await cancelRequest(ID)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("cancel_request", { p_request_id: ID });
  });

  it("map database refusals to fixed messages", async () => {
    rpc.mockResolvedValue({ error: { code: "P0001", message: "This traveller's trip is no longer active" } });
    expect(await acceptOffer(ID, ID)).toEqual({ ok: false, reason: "That traveller’s trip is no longer active." });
    rpc.mockResolvedValue({ error: { code: "P0001", message: "This offer's reward isn't valid" } });
    expect(await acceptOffer(ID, ID)).toEqual({ ok: false, reason: expect.stringMatching(/reward isn’t valid/) });
    rpc.mockResolvedValue({ error: { code: "42501", message: "Offer not found or not allowed" } });
    expect(await acceptOffer(ID, ID)).toEqual({ ok: false, reason: expect.stringMatching(/isn’t available/) });
  });

  // The app shows v1.3 prices (3%, no minimum); dev's database still runs v1.1 (5%, ₹300 floor) with no two-argument accept_offer.
  it("refuse acceptance when the database is on another pricing policy, and say nothing was accepted", async () => {
    const mismatch = expect.stringMatching(/pricing has been updated.*Nothing was accepted/);
    rpc.mockResolvedValue({ error: { code: "PGRST202", message: "Could not find the function public.accept_offer(p_offer_id, p_policy_version)" } });
    expect(await acceptOffer(ID, ID)).toEqual({ ok: false, reason: mismatch });
    rpc.mockResolvedValue({ error: { code: "P0001", message: "This offer was priced under a different pricing policy" } });
    expect(await acceptOffer(ID, ID)).toEqual({ ok: false, reason: mismatch });
  });

  it("leave the other steps' calls unchanged", async () => {
    rpc.mockResolvedValue({ error: null });
    await declineOffer(ID, ID);
    expect(rpc).toHaveBeenCalledWith("decline_offer", { p_offer_id: ID });
    rpc.mockResolvedValue({ error: { code: "PGRST202", message: "Could not find the function" } });
    expect(await declineOffer(ID, ID)).toEqual({ ok: false, reason: expect.not.stringMatching(/pricing/) });
  });
});
