import { describe, expect, it } from "vitest";
import {
  calculateBuyerPlatformFee,
  calculateNetTravellerReward,
  calculateOrderPricing,
  calculateTravellerPlatformFee,
  formatMinor,
  PRICING_POLICY,
  REWARD_RULE,
  rupees,
  toMinor,
  validateTravellerReward,
} from "@/lib/pricing";

const inr = (s: string) => toMinor(s, "INR")!;
const price = (productValue: number, grossReward: number, charges = {}) => {
  const r = calculateOrderPricing({ currency: "INR", productValue, grossReward, charges });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.pricing;
};

describe("pricing policy v1.3 (FD-9, Q13a, Q13g)", () => {
  it("is 3% for buyers and 10% for travellers; rewards are whole rupees from ₹1 to ₹10,00,000, with no ₹300 minimum", () => {
    expect(PRICING_POLICY).toMatchObject({ version: "1.3", buyerFeeBps: 300, travellerFeeBps: 1000, rewardCurrencies: ["INR"], rewardRangeInr: { min: 100, max: 100_000_000 } });
    expect(PRICING_POLICY).not.toHaveProperty("minNetReward");
  });

  it("case 1: ₹2,000 product → ₹60 buyer fee; a ₹300 gross reward is valid and nets ₹270", () => {
    expect(calculateBuyerPlatformFee(inr("2000"))).toBe(inr("60"));
    expect(calculateNetTravellerReward(inr("300"))).toBe(inr("270"));
    expect(validateTravellerReward(inr("300"), "INR")).toEqual({ ok: true });
    expect(price(inr("2000"), inr("300"))).toMatchObject({ travellerFee: inr("30"), netReward: inr("270"), buyerTotal: inr("2360"), orbitlyRevenue: inr("90") });
  });

  it("case 1 (continued): a ₹334 reward (the former whole-rupee floor) prices like any other", () => {
    expect(price(inr("2000"), inr("334"))).toMatchObject({
      buyerFee: inr("60"),
      travellerFee: inr("33.40"),
      netReward: inr("300.60"),
      buyerTotal: inr("2394"),
      orbitlyRevenue: inr("93.40"),
    });
  });

  it("case 2 (Q13g): ₹1, ₹200, ₹333 and ₹10,00,000 pass, with 10% commission, 90% net and no minimum commission", () => {
    for (const [gross, fee, net] of [["1", "0.10", "0.90"], ["2", "0.20", "1.80"], ["200", "20", "180"], ["333", "33.30", "299.70"], ["1000000", "100000", "900000"]] as const) {
      expect(validateTravellerReward(inr(gross), "INR"), gross).toEqual({ ok: true });
      expect(calculateTravellerPlatformFee(inr(gross)), gross).toBe(inr(fee));
      expect(calculateNetTravellerReward(inr(gross)), gross).toBe(inr(net));
    }
  });

  it("case 3: commission is exactly 10% half-up and net is the rest, for every reward from ₹0 to ₹400", () => {
    const wrong: number[] = [];
    for (let g = 0; g <= inr("400"); g++) {
      const fee = calculateTravellerPlatformFee(g);
      if (fee !== Math.floor((g * 1000 + 5000) / 10000) || calculateNetTravellerReward(g) !== g - fee) wrong.push(g);
    }
    expect(wrong).toEqual([]);
  });

  it("rejects ₹0, ₹10,00,001, negative, part-rupee, non-numeric and other-currency rewards (Q13g)", () => {
    const rejected = { "₹0": 0, "₹10,00,001": inr("1000001"), "−₹1": -100, "₹0.50": 50, "₹1.50": 150, "₹333.34": inr("333.34"), "half a paisa": 100.5, NaN: Number.NaN, Infinity };
    for (const [name, bad] of Object.entries(rejected)) expect(validateTravellerReward(bad, "INR"), name).toEqual({ ok: false, message: REWARD_RULE });
    expect(calculateOrderPricing({ currency: "INR", productValue: inr("2000"), grossReward: 0 })).toEqual({ ok: false, errors: { grossReward: REWARD_RULE } });
    expect(validateTravellerReward(inr("500"), "USD")).toEqual({ ok: false, message: expect.stringMatching(/aren’t supported yet/) });
  });

  it("case 4: ₹10,000 product with a ₹2,000 reward", () => {
    expect(price(inr("10000"), inr("2000"))).toMatchObject({
      buyerFee: inr("300"),
      travellerFee: inr("200"),
      netReward: inr("1800"),
      buyerTotal: inr("12300"),
      orbitlyRevenue: inr("500"),
    });
  });

  it("case 5: ₹1,00,000 product with a ₹5,000 reward", () => {
    expect(price(inr("100000"), inr("5000"))).toMatchObject({ buyerFee: inr("3000"), travellerFee: inr("500"), netReward: inr("4500") });
  });

  it("keeps an agreed reward as agreed", () => {
    expect(price(inr("2000"), inr("1235"))).toMatchObject({ grossReward: inr("1235"), travellerFee: inr("123.50"), netReward: inr("1111.50") });
  });

  it("itemises other charges separately and adds them to the buyer total", () => {
    const p = price(inr("10000"), inr("2000"), { delivery: inr("250"), other: inr("100"), customsEstimate: inr("1500") });
    expect(p).toMatchObject({ delivery: inr("250"), other: inr("100"), customsEstimate: inr("1500"), buyerTotal: inr("14150"), orbitlyRevenue: inr("500") });
  });

  it("rounds fees half up to the paisa", () => {
    expect(calculateBuyerPlatformFee(inr("0.50"))).toBe(2); // 1.5 paise → 2
    expect(calculateBuyerPlatformFee(inr("0.49"))).toBe(1); // 1.47 paise → 1
    expect(calculateTravellerPlatformFee(inr("333.35"))).toBe(inr("33.34")); // 33.335 → 33.34
  });
});

describe("case 6: both directions", () => {
  // Direction isn't an input: identical amounts must price identically, whichever way the item travels.
  it("prices Abroad → India and India → Abroad orders the same", () => {
    const intoIndia = price(rupees(24_900), rupees(1_800));
    const outOfIndia = price(rupees(24_900), rupees(1_800));
    expect(outOfIndia).toEqual(intoIndia);
    expect(intoIndia).toMatchObject({ buyerFee: rupees(747), travellerFee: rupees(180), netReward: rupees(1_620) });
  });
});

describe("case 7: invalid input", () => {
  const errors = (input: Parameters<typeof calculateOrderPricing>[0]) => {
    const r = calculateOrderPricing(input);
    return r.ok ? null : r.errors;
  };

  it("rejects zero, negative and missing product values", () => {
    expect(errors({ currency: "INR", productValue: 0, grossReward: inr("500") })).toHaveProperty("productValue");
    expect(errors({ currency: "INR", productValue: -100, grossReward: inr("500") })).toHaveProperty("productValue");
    expect(errors({ currency: "INR", productValue: undefined, grossReward: inr("500") })).toHaveProperty("productValue");
  });

  it("rejects negative, fractional-paise and missing rewards", () => {
    expect(errors({ currency: "INR", productValue: inr("2000"), grossReward: -50_000 })).toHaveProperty("grossReward");
    expect(errors({ currency: "INR", productValue: inr("2000"), grossReward: 50_000.5 })).toHaveProperty("grossReward");
    expect(errors({ currency: "INR", productValue: inr("2000"), grossReward: undefined })).toHaveProperty("grossReward");
  });

  it("rejects missing and unknown currencies, and doesn't price currencies without a minimum", () => {
    expect(errors({ currency: undefined, productValue: inr("2000"), grossReward: inr("500") })).toHaveProperty("currency");
    expect(errors({ currency: "XYZ", productValue: inr("2000"), grossReward: inr("500") })).toHaveProperty("currency");
    expect(errors({ currency: "USD", productValue: 200_00, grossReward: 50_00 })?.grossReward).toMatch(/aren’t supported yet/);
  });

  it("rejects negative charges", () => {
    expect(errors({ currency: "INR", productValue: inr("2000"), grossReward: inr("500"), charges: { delivery: -1 } })).toHaveProperty("charges");
  });

  it("parses amounts without floats and refuses excess precision", () => {
    expect(toMinor("2433.34", "INR")).toBe(243_334);
    expect(toMinor("0.1", "INR")).toBe(10);
    expect(toMinor("12.345", "INR")).toBeNull();
    expect(toMinor("12.5", "JPY")).toBeNull();
    expect(toMinor("1250", "JPY")).toBe(1250);
    expect(toMinor("-5", "INR")).toBeNull();
    expect(toMinor("1e3", "INR")).toBeNull();
  });
});

describe("case 8: computed, never supplied", () => {
  it("ignores fee, net and total values smuggled into the input", () => {
    const tampered = { currency: "INR", productValue: inr("10000"), grossReward: inr("2000"), buyerFee: 0, travellerFee: 0, netReward: inr("2000"), buyerTotal: 1 };
    const r = calculateOrderPricing(tampered);
    expect(r.ok && r.pricing).toMatchObject({ buyerFee: inr("300"), travellerFee: inr("200"), netReward: inr("1800"), buyerTotal: inr("12300") });
  });
});

describe("FD-9 worked example", () => {
  it("₹50,000 product, ₹3,000 reward: ₹1,500 buyer fee, ₹300 commission, ₹2,700 net, ₹1,800 Orbitly revenue", () => {
    const p = price(rupees(50_000), rupees(3_000), { delivery: rupees(250), customsEstimate: rupees(1_500) });
    expect(p).toMatchObject({ policyVersion: "1.3", buyerFee: rupees(1_500), travellerFee: rupees(300), netReward: rupees(2_700), orbitlyRevenue: rupees(1_800) });
    // Customs and delivery are reimbursed as itemised, with no fee on either.
    expect(p.buyerTotal).toBe(rupees(50_000 + 3_000 + 1_500 + 250 + 1_500));
  });
});

describe("formatting", () => {
  it("shows paise only when there are any", () => {
    expect(formatMinor(inr("2433.34"), "INR")).toBe("₹2,433.34");
    expect(formatMinor(inr("100000"), "INR")).toBe("₹1,00,000");
    expect(formatMinor(1250, "JPY")).toBe("JP¥1,250");
  });
});
