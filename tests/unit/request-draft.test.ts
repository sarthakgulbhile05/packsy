import { describe, expect, it } from "vitest";
import { imageFileProblem } from "@/lib/image-file";
import { compareOffers, emptyDraft, offerTotal, validateDraft, type Offer } from "@/lib/request-draft";

const TODAY = "2026-10-27";

describe("validateDraft", () => {
  const ok = { ...emptyDraft("text"), title: "Vintage coffee grinder", from: "US", to: "IN", deliverTo: "Pune" };

  it("needs only a name, a route and a city", () => {
    expect(validateDraft(ok, TODAY)).toEqual({});
    expect(Object.keys(validateDraft(emptyDraft("text"), TODAY)).sort()).toEqual(["deliverTo", "route", "title"]);
  });

  it("works in either direction, and refuses a half route, the same country twice or an unknown code", () => {
    expect(validateDraft({ ...ok, from: "IN", to: "US", deliverTo: "Seattle" }, TODAY)).toEqual({});
    expect(validateDraft({ ...ok, from: "" }, TODAY).route).toBeDefined();
    expect(validateDraft({ ...ok, from: "IN", to: "IN" }, TODAY).route).toMatch(/different/);
    expect(validateDraft({ ...ok, from: "XX" }, TODAY).route).toBeDefined();
  });

  it("checks optional fields only when they're filled in", () => {
    expect(validateDraft({ ...ok, url: "not a link" }, TODAY).url).toBeDefined();
    expect(validateDraft({ ...ok, url: "shop.example/x" }, TODAY).url).toBeUndefined();
    expect(validateDraft({ ...ok, budget: "-5" }, TODAY).budget).toBeDefined();
    expect(validateDraft({ ...ok, budget: "abc" }, TODAY).budget).toBeDefined();
    expect(validateDraft({ ...ok, budget: "24999.50" }, TODAY).budget).toBeUndefined();
    expect(validateDraft({ ...ok, neededBy: "2026-10-26" }, TODAY).neededBy).toBeDefined();
    expect(validateDraft({ ...ok, neededBy: TODAY }, TODAY).neededBy).toBeUndefined();
    expect(validateDraft({ ...ok, quantity: 11 }, TODAY).quantity).toBeDefined();
  });
});

describe("compareOffers", () => {
  // Amounts in rupees here, paise in the offer, as the pricing engine expects.
  const offer = (id: string, productPrice: number, serviceFee: number, arrival: string): Offer => ({
    id, traveller: id, productPrice: productPrice * 100, serviceFee: serviceFee * 100, currency: "INR", arrival, handoff: "Meet in Pune", conditions: "",
  });

  it("totals price, reward and Orbitly's 3% buyer fee", () => expect(offerTotal(offer("a", 18000, 1500, "2026-11-20"))).toBe(2_004_000));

  it("prices a reward under the former ₹300 floor like any other", () => expect(offerTotal(offer("a", 18000, 300, "2026-11-20"))).toBe(1_884_000));

  it("sorts by total and marks the real lowest and earliest", () => {
    const result = compareOffers([offer("a", 20000, 2000, "2026-11-20"), offer("b", 19000, 1500, "2026-12-01"), offer("c", 19400, 1088, "2026-11-10")]);
    // b and c tie on ₹21,070; c arrives first, so it sorts first. Both are "lowest total".
    expect(result.map((o) => o.id)).toEqual(["c", "b", "a"]);
    expect(result.filter((o) => o.lowestTotal).map((o) => o.id)).toEqual(["c", "b"]);
    expect(result.filter((o) => o.earliest).map((o) => o.id)).toEqual(["c"]);
  });

  it("adds no badges to a single offer and handles none", () => {
    expect(compareOffers([offer("a", 1000, 500, "2026-11-01")])[0]).toMatchObject({ lowestTotal: false, earliest: false });
    expect(compareOffers([])).toEqual([]);
  });
});

describe("imageFileProblem", () => {
  it("accepts common photo formats up to 10 MB", () => {
    expect(imageFileProblem({ type: "image/jpeg", size: 2_000_000 })).toBeNull();
    expect(imageFileProblem({ type: "image/webp", size: 10 * 1024 * 1024 })).toBeNull();
  });
  it("rejects other types, empty and oversized files", () => {
    expect(imageFileProblem({ type: "application/pdf", size: 100 })).toMatch(/JPG, PNG/);
    expect(imageFileProblem({ type: "image/heic", size: 100 })).toMatch(/JPG, PNG/);
    expect(imageFileProblem({ type: "image/png", size: 11 * 1024 * 1024 })).toMatch(/over 10 MB/);
    expect(imageFileProblem({ type: "image/png", size: 0 })).toMatch(/empty/);
  });
});
