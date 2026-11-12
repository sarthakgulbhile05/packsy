// Orbitly pricing, policy v1.3 (FD-9: 3% buyer fee; Q13a: no ₹300 minimum; Q13g: rewards are whole rupees, ₹1–₹10,00,000). The one place fee formulas live: offers, the buyer's offer list,
// the traveller's screens and the homepage examples all call this module, and the database's draft check
// and snapshot mirror it: v1.3 is supabase/drafts/stage5d_pricing_v1_3.sql on top of stage5c (neither applied), with a
// test that they agree. Dev still runs v1.1 (5%, ₹300 floor), so accept_offer is called with this version and a
// mismatch refuses acceptance.
//
// Money is integer minor units (paise for INR) throughout, so no floating-point sums. Percentages are basis
// points and round half up to the nearest minor unit. The same rules apply in both directions; nothing here
// knows which way an item travels. Nothing converts currencies: callers pass amounts already in `currency`.

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "JPY", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const PRICING_POLICY = {
  version: "1.3",
  /** 3% of the agreed product value, paid by the buyer (FD-9; replaces v1.1's 5%). */
  buyerFeeBps: 300,
  /** 10% of the agreed gross traveller reward, deducted from it. */
  travellerFeeBps: 1000,
  /** Offers store rewards in rupees, so rewards are only priced in INR. */
  rewardCurrencies: ["INR"] as readonly Currency[],
  /** Q13g: a valid reward is whole rupees from ₹1 to ₹10,00,000 (paise). A validity range: no ₹300 minimum, no minimum commission. */
  rewardRangeInr: { min: 100, max: 100_000_000 },
} as const;

/** Digits after the decimal point (ISO 4217). */
export const MINOR_DIGITS: Record<Currency, number> = { INR: 2, USD: 2, EUR: 2, GBP: 2, AED: 2, JPY: 0, SGD: 2 };

const MAX_MINOR = 1e12; // far above any order, far below where integer maths stops being exact

export const isCurrency = (c: unknown): c is Currency => CURRENCIES.includes(c as Currency);
const isAmount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= MAX_MINOR;

/** "1,234.5" style input → minor units, without floats. Null for anything that isn't a plain amount in that currency. */
export function toMinor(input: string, currency: Currency): number | null {
  const digits = MINOR_DIGITS[currency];
  const m = /^(\d{1,10})(?:\.(\d+))?$/.exec(input.trim());
  if (!m || (m[2] ?? "").length > digits) return null;
  return Number(m[1]) * 10 ** digits + Number((m[2] ?? "").padEnd(digits, "0") || 0);
}

/** Basis points of an amount, rounded half up. */
const percentOf = (amount: number, bps: number) => Math.floor((amount * bps + 5_000) / 10_000);

export const calculateBuyerPlatformFee = (productValue: number) => percentOf(productValue, PRICING_POLICY.buyerFeeBps);
export const calculateTravellerPlatformFee = (grossReward: number) => percentOf(grossReward, PRICING_POLICY.travellerFeeBps);
export const calculateNetTravellerReward = (grossReward: number) => grossReward - calculateTravellerPlatformFee(grossReward);

export type RewardCheck = { ok: true } | { ok: false; message: string };

export const REWARD_RULE = "Enter a reward in whole rupees, from ₹1 to ₹10,00,000.";

/** A reward is whole rupees from ₹1 to ₹10,00,000 (Q13g). No ₹300 minimum and no minimum commission (Q13a). */
export function validateTravellerReward(grossReward: number, currency: Currency): RewardCheck {
  if (!PRICING_POLICY.rewardCurrencies.includes(currency)) return { ok: false, message: `Traveller rewards in ${currency} aren’t supported yet. Offers are priced in rupees.` };
  const { min, max } = PRICING_POLICY.rewardRangeInr;
  if (!isAmount(grossReward) || grossReward % 100 !== 0 || grossReward < min || grossReward > max) return { ok: false, message: REWARD_RULE };
  return { ok: true };
}

export type Charges = { delivery?: number; other?: number; customsEstimate?: number | null };
export type OrderPricingInput = { currency: unknown; productValue: unknown; grossReward: unknown; charges?: Charges };
export type OrderPricing = {
  policyVersion: string;
  currency: Currency;
  productValue: number;
  grossReward: number;
  buyerFee: number;
  travellerFee: number;
  netReward: number;
  delivery: number;
  other: number;
  /** Decided by customs at arrival: an estimate when present, never a confirmed amount. */
  customsEstimate: number | null;
  /** Everything the buyer pays: product, reward, Orbitly's buyer fee and every itemised charge. */
  buyerTotal: number;
  /** Orbitly's gross platform revenue, before any costs. Not profit. */
  orbitlyRevenue: number;
};
export type PricingErrors = Partial<Record<"currency" | "productValue" | "grossReward" | "charges", string>>;

/**
 * The full price of one order, from amounts in minor units of one currency. Takes only the agreed inputs:
 * fees, net reward and totals are always computed here, never accepted from a form.
 */
export function calculateOrderPricing(input: OrderPricingInput): { ok: true; pricing: OrderPricing } | { ok: false; errors: PricingErrors } {
  const errors: PricingErrors = {};
  const { currency, productValue, grossReward } = input;
  const c = input.charges ?? {};
  const charges = [c.delivery ?? 0, c.other ?? 0, c.customsEstimate ?? 0];
  if (!isCurrency(currency)) errors.currency = "Choose a supported currency.";
  if (!isAmount(productValue) || productValue === 0) errors.productValue = "Enter the agreed product value.";
  if (!charges.every(isAmount)) errors.charges = "Each extra charge must be zero or more.";
  if (isCurrency(currency)) {
    const reward = validateTravellerReward(grossReward as number, currency);
    if (!reward.ok) errors.grossReward = reward.message;
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const p = productValue as number;
  const g = grossReward as number;
  const buyerFee = calculateBuyerPlatformFee(p);
  const travellerFee = calculateTravellerPlatformFee(g);
  const [delivery, other, customs] = charges;
  return {
    ok: true,
    pricing: {
      policyVersion: PRICING_POLICY.version,
      currency: currency as Currency,
      productValue: p,
      grossReward: g,
      buyerFee,
      travellerFee,
      netReward: g - travellerFee,
      delivery,
      other,
      customsEstimate: c.customsEstimate ?? null,
      buyerTotal: p + g + buyerFee + delivery + other + customs,
      orbitlyRevenue: buyerFee + travellerFee,
    },
  };
}

/** Minor units → "₹2,433.34". Whole amounts drop the decimals ("₹2,000"). */
export function formatMinor(amount: number, currency: Currency) {
  const digits = MINOR_DIGITS[currency];
  const value = amount / 10 ** digits;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Whole rupees (how offers store amounts) → paise. */
export const rupees = (inr: number) => inr * 100;
