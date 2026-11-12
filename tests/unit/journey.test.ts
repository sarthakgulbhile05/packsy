import { describe, expect, it } from "vitest";
import { EXAMPLE_JOURNEYS } from "@/components/home/journey-examples";
import { formatInr, journeyDirection, journeyPricing, journeySaving, previewJourneys, routeDirection, searchJourneys, type Journey } from "@/lib/journey";

const base = EXAMPLE_JOURNEYS[0];

describe("journey figures", () => {
  it("total is product, reward and Orbitly's 3% buyer fee; saving is what's left against the local price (paise)", () => {
    const j: Journey = { ...base, productPriceInr: 10_000, travellerFeeInr: 1_500, localPriceInr: 14_000 };
    const p = journeyPricing(j)!;
    expect(p.buyerTotal).toBe(1_180_000);
    expect(p.netReward).toBe(135_000);
    expect(journeySaving(p, j)).toBe(220_000);
  });

  it("never shows a negative saving", () => {
    const j: Journey = { ...base, productPriceInr: 10_000, travellerFeeInr: 1_500, localPriceInr: 9_000 };
    expect(journeySaving(journeyPricing(j)!, j)).toBe(0);
  });

  it("prices a journey whose reward nets under the former ₹300 floor (no minimum since Q13a)", () => {
    expect(journeyPricing({ ...base, travellerFeeInr: 300 })).toMatchObject({ travellerFee: 3_000, netReward: 27_000 });
  });

  it("formats rupees with Indian digit grouping", () => {
    expect(formatInr(124_900)).toBe("₹1,24,900");
  });
});

describe("journey direction", () => {
  const route = (from: string, to: string): Journey => ({ ...base, traveller: { ...base.traveller, country: from }, buyer: { ...base.buyer, country: to } });

  it("follows the item: bought abroad for India is into India, bought in India for abroad is out of it", () => {
    expect(journeyDirection(route("UK", "India"))).toBe("into_india");
    expect(journeyDirection(route("India", "UAE"))).toBe("out_of_india");
  });

  it("has no direction for routes that don't cross India's border", () => {
    expect(journeyDirection(route("UK", "UAE"))).toBeNull();
    expect(journeyDirection(route("India", "India"))).toBeNull();
  });
});

describe("route direction from country codes", () => {
  it("labels requests and trips the same way as the examples", () => {
    expect(routeDirection("US", "IN")).toBe("into_india");
    expect(routeDirection("IN", "AE")).toBe("out_of_india");
    expect(routeDirection("GB", "AE")).toBeNull();
    expect(routeDirection(null, "IN")).toBeNull();
  });
});

describe("homepage marketplace preview", () => {
  const dirs = (list: Journey[]) => list.map((j) => journeyDirection(j));

  it("shows both directions together under All, alternating, at most four, no duplicates", () => {
    const all = previewJourneys(EXAMPLE_JOURNEYS, "all");
    expect(all).toHaveLength(4);
    expect(dirs(all)).toEqual(["into_india", "out_of_india", "into_india", "out_of_india"]);
    expect(new Set(all.map((j) => j.id)).size).toBe(all.length);
  });

  it("shows only one direction when filtered, and never pads with copies", () => {
    expect(dirs(previewJourneys(EXAMPLE_JOURNEYS, "into_india"))).toEqual(["into_india", "into_india", "into_india"]);
    expect(dirs(previewJourneys(EXAMPLE_JOURNEYS, "out_of_india"))).toEqual(["out_of_india", "out_of_india", "out_of_india"]);
  });

  it("shows fewer when fewer exist, and nothing for an empty direction", () => {
    const into = EXAMPLE_JOURNEYS.filter((j) => journeyDirection(j) === "into_india");
    expect(previewJourneys(into, "all").map((j) => j.id)).toEqual(into.map((j) => j.id));
    expect(previewJourneys(into, "out_of_india")).toEqual([]);
    expect(previewJourneys([], "all")).toEqual([]);
  });

  it("keeps routes outside India, after both directions, under All only", () => {
    const other: Journey = { ...base, id: "other", buyer: { ...base.buyer, country: "UAE" } };
    expect(previewJourneys([other, ...EXAMPLE_JOURNEYS.slice(0, 1)], "all").map((j) => j.id)).toEqual([base.id, "other"]);
    expect(previewJourneys([other], "into_india")).toEqual([]);
  });
});

describe("explore page search", () => {
  const ids = (list: Journey[]) => list.map((j) => j.id);

  it("matches product names and cities, ignoring case and spaces; a blank query keeps everything", () => {
    expect(ids(searchJourneys(EXAMPLE_JOURNEYS, "  SNEAK "))).toEqual(["example-sneakers"]);
    expect(ids(searchJourneys(EXAMPLE_JOURNEYS, "tokyo"))).toEqual(["example-sneakers"]);
    expect(searchJourneys(EXAMPLE_JOURNEYS, "   ")).toEqual(EXAMPLE_JOURNEYS);
  });

  it("returns nothing for no match, and combines with the direction filter", () => {
    expect(searchJourneys(EXAMPLE_JOURNEYS, "zzz")).toEqual([]);
    const london = searchJourneys(EXAMPLE_JOURNEYS, "london"); // headphones from London, cotton to London
    expect(ids(previewJourneys(london, "out_of_india", Infinity))).toEqual(["example-block-print"]);
    expect(previewJourneys(EXAMPLE_JOURNEYS, "all", Infinity)).toHaveLength(EXAMPLE_JOURNEYS.length);
  });
});

describe("example journeys", () => {
  it("show both directions equally", () => {
    const count = (d: string) => EXAMPLE_JOURNEYS.filter((j) => journeyDirection(j) === d).length;
    expect(count("into_india")).toBe(3);
    expect(count("out_of_india")).toBe(3);
  });

  it("never mark an example buyer or traveller as phone-verified", () => {
    expect(EXAMPLE_JOURNEYS.flatMap((j) => [j.buyer.phoneVerified, j.traveller.phoneVerified]).some(Boolean)).toBe(false);
  });

  it("all show a positive saving, so the figures stay self-consistent", () => {
    expect(EXAMPLE_JOURNEYS.every((j) => journeySaving(journeyPricing(j)!, j) > 0)).toBe(true);
  });
});
