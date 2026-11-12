import { isCountryCode } from "./countries";
import { calculateOrderPricing, CURRENCIES } from "./pricing";
import { normalizeUrl } from "./url";

// A buyer's request while it's being written, reviewed and (for now) saved on this device.
// PROTOTYPE: requests are not yet stored on the server or shown to travellers.

export const ITEM_KINDS = [
  { id: "electronics", label: "Electronics & phones", fields: ["brand", "model", "variant"] },
  { id: "fashion", label: "Fashion & shoes", fields: ["brand", "size", "colour"] },
  { id: "home", label: "Home & appliances", fields: ["brand", "model"] },
  { id: "collectible", label: "Collectibles & vintage", fields: ["brand"] },
  { id: "other", label: "Something else", fields: ["brand"] },
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number]["id"];

export const ATTRIBUTE_LABELS = {
  brand: "Brand or maker",
  model: "Model",
  variant: "Variant (storage, colour…)",
  size: "Size",
  colour: "Colour",
} as const;
export type AttributeKey = keyof typeof ATTRIBUTE_LABELS;

export const CONDITIONS = ["New", "Used – good condition", "Any condition"] as const;
export { CURRENCIES };

export type RequestDraft = {
  source: "link" | "photo" | "text";
  title: string;
  description: string;
  url: string;
  /** Data URL of a photo resized on this device, or a product image URL from a link preview. */
  image: string;
  kind: ItemKind;
  attributes: Partial<Record<AttributeKey, string>>;
  condition: (typeof CONDITIONS)[number];
  quantity: number;
  originPreference: string;
  budget: string;
  currency: (typeof CURRENCIES)[number];
  neededBy: string;
  /** Route as ISO country codes: where the item is bought, and where it's going. */
  from: string;
  to: string;
  deliverTo: string;
  notes: string;
  /** What the link preview really found, so the review screen never overstates it. */
  linkNote?: string;
  /** Set once the request is saved to the buyer's account (a draft they can edit). */
  id?: string;
};

export function emptyDraft(source: RequestDraft["source"]): RequestDraft {
  return {
    source,
    title: "",
    description: "",
    url: "",
    image: "",
    kind: "other",
    attributes: {},
    condition: "New",
    quantity: 1,
    originPreference: "",
    budget: "",
    currency: "INR",
    neededBy: "",
    from: "",
    to: "IN",
    deliverTo: "",
    notes: "",
  };
}

export type DraftErrors = Partial<Record<"title" | "url" | "route" | "budget" | "neededBy" | "deliverTo" | "quantity" | "form", string>>;

/** Only what a traveller truly needs is required: a name, the route, and the city it's going to. */
export function validateDraft(d: RequestDraft, today = new Date().toISOString().slice(0, 10)): DraftErrors {
  const e: DraftErrors = {};
  if (d.title.trim().length < 3) e.title = "Give the item a name (at least 3 characters).";
  else if (d.title.length > 120) e.title = "Keep the name under 120 characters.";
  if (d.url.trim() && !normalizeUrl(d.url)) e.url = "That link doesn’t look right.";
  if (d.budget.trim() && !(Number(d.budget) > 0 && Number(d.budget) < 1e9)) e.budget = "Enter a budget above zero, or leave it empty.";
  if (d.neededBy && d.neededBy < today) e.neededBy = "Choose today or a later date.";
  if (!isCountryCode(d.from) || !isCountryCode(d.to)) e.route = "Choose where the item is coming from and where it’s going.";
  else if (d.from === d.to) e.route = "Choose two different countries.";
  if (d.deliverTo.trim().length < 2) e.deliverTo = "Tell travellers which city it’s going to.";
  if (!Number.isInteger(d.quantity) || d.quantity < 1 || d.quantity > 10) e.quantity = "Choose a quantity from 1 to 10.";
  return e;
}

export type Offer = {
  id: string;
  traveller: string;
  /** Minor units (paise for INR), like everything the pricing engine handles. */
  productPrice: number;
  /** The traveller's gross reward, in minor units. */
  serviceFee: number;
  currency: (typeof CURRENCIES)[number];
  arrival: string;
  handoff: string;
  conditions: string;
};

export const offerPricing = (o: Pick<Offer, "productPrice" | "serviceFee" | "currency">) =>
  calculateOrderPricing({ currency: o.currency, productValue: o.productPrice, grossReward: o.serviceFee });
/** What the buyer pays in total, from the pricing engine. Offers it can't price sort last. */
export const offerTotal = (o: Pick<Offer, "productPrice" | "serviceFee" | "currency">) => {
  const r = offerPricing(o);
  return r.ok ? r.pricing.buyerTotal : Infinity;
};

/** Cheapest total first; ties broken by earliest arrival. Badges are computed, never assigned. */
export function compareOffers(offers: Offer[]) {
  const sorted = [...offers].sort((a, b) => offerTotal(a) - offerTotal(b) || a.arrival.localeCompare(b.arrival));
  const lowest = sorted.length ? offerTotal(sorted[0]) : null;
  const earliest = offers.reduce<string | null>((min, o) => (min === null || o.arrival < min ? o.arrival : min), null);
  return sorted.map((o) => ({
    ...o,
    total: offerTotal(o),
    pricing: offerPricing(o),
    lowestTotal: offers.length > 1 && offerTotal(o) === lowest,
    earliest: offers.length > 1 && o.arrival === earliest,
  }));
}

// --- On-device storage (prototype). Every access is guarded: storage can be unavailable. ---
const DRAFT_KEY = "orbitly.requestDraft";
const SAVED_KEY = "orbitly.savedRequests";

export function saveDraft(d: RequestDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(): RequestDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? { ...emptyDraft("text"), ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {}
}

export function saveRequestOnDevice(d: RequestDraft) {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    list.unshift({ ...d, savedAt: new Date().toISOString() });
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 20)));
    sessionStorage.removeItem(DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
}

export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}
