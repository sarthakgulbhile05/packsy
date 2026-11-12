// A traveller's offer on a matching request: the server-side trust boundary. The arrival date always comes
// from the traveller's own trip (read on the server), never from the form. Amounts are whole rupees, as the
// offers table stores them; the product price may be in another currency with the traveller's own rate.
// The reward (`service_fee_inr`) is the traveller's gross reward under pricing policy v1.3 (src/lib/pricing.ts): whole
// rupees from ₹1 to ₹10,00,000 (Q13g). There is no ₹300 minimum (Q13a).
import { calculateOrderPricing, REWARD_RULE, rupees, validateTravellerReward } from "./pricing";
import { CURRENCIES } from "./request-draft";

export const HANDOFF_METHODS = [
  { id: "meet_in_person", label: "Meet in person" },
  { id: "courier_in_india", label: "Courier after landing" },
  { id: "pickup_point", label: "Pickup at an agreed point" },
] as const;

export type OfferErrors = Partial<Record<"productPrice" | "rate" | "serviceFee" | "handoff" | "lawful" | "form", string>>;

export type OfferInsert = {
  request_id: string;
  trip_id: string;
  product_price_amount: number;
  product_currency: string;
  fx_rate_to_inr: number;
  product_price_fixed: boolean;
  service_fee_inr: number;
  arrival_date: string;
  handoff_method: string;
  declares_lawful_import: true;
};

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const MONEY = /^\d+(\.\d{1,2})?$/;

export function offerToRow(form: FormData, ids: { requestId: string; tripId: string; arrivalDate: string }):
  | { ok: true; row: OfferInsert }
  | { ok: false; errors: OfferErrors } {
  const e: OfferErrors = {};
  const price = str(form.get("productPrice"));
  const currency = CURRENCIES.find((c) => c === str(form.get("currency")));
  const rate = currency === "INR" ? "1" : str(form.get("rate"));
  const fee = str(form.get("serviceFee"));
  const handoff = HANDOFF_METHODS.find((h) => h.id === str(form.get("handoff")));

  if (!MONEY.test(price) || !(Number(price) > 0) || Number(price) >= 1e8) e.productPrice = "Enter the product’s price.";
  if (!currency) e.form = "Choose a currency.";
  if (!/^\d+(\.\d{1,6})?$/.test(rate) || !(Number(rate) > 0) || Number(rate) > 10000) e.rate = "Enter the exchange rate you’re assuming to rupees.";
  if (!/^\d{1,7}$/.test(fee) || !validateTravellerReward(rupees(Number(fee)), "INR").ok) e.serviceFee = REWARD_RULE;
  if (!handoff) e.handoff = "Choose how you’ll hand it over.";
  if (form.get("lawful") !== "on") e.lawful = "Confirm the item is lawful to carry and that you’ll declare it at customs.";
  if (!e.productPrice && !e.rate) {
    const inr = Math.round(Number(price) * Number(rate));
    if (inr < 1 || inr > 10_000_000) e.productPrice = "That price is outside what Orbitly can handle (up to ₹1 crore).";
  }
  if (Object.keys(e).length) return { ok: false, errors: e };

  return {
    ok: true,
    row: {
      request_id: ids.requestId,
      trip_id: ids.tripId,
      product_price_amount: Number(price),
      product_currency: currency!,
      fx_rate_to_inr: Number(rate),
      product_price_fixed: form.get("fixed") === "on",
      service_fee_inr: Number(fee),
      arrival_date: ids.arrivalDate,
      handoff_method: handoff!.id,
      declares_lawful_import: true,
    },
  };
}

/** The amounts a stored offer prices from. Rupee columns are whole rupees; the engine works in paise. */
export type PricedOffer = {
  product_price_inr: number;
  service_fee_inr: number;
  delivery_inr: number;
  other_costs_inr: number;
  customs_estimate_inr: number | null;
};

/** Prices a stored offer with the shared engine. Not ok only for a row the engine can't price (for example a zero product value). */
export function priceOffer(o: PricedOffer) {
  return calculateOrderPricing({
    currency: "INR",
    productValue: rupees(o.product_price_inr),
    grossReward: rupees(o.service_fee_inr),
    charges: {
      delivery: rupees(o.delivery_inr),
      other: rupees(o.other_costs_inr),
      customsEstimate: o.customs_estimate_inr === null ? null : rupees(o.customs_estimate_inr),
    },
  });
}
