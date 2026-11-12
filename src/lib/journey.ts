import type { StaticImageData } from "next/image";
import { calculateOrderPricing, rupees, type OrderPricing } from "./pricing";

/** One side of a delivery. No names or photos: we only show what a real profile would let us show. */
export type JourneyParty = { city: string; country: string; phoneVerified: boolean };

/**
 * A completed (or in-progress) delivery, as the homepage shows it. Example and live journeys share this
 * shape, so real completed deliveries from Supabase can replace the examples without touching the UI.
 */
export type Journey = {
  id: string;
  status: "delivered" | "in_transit";
  product: { name: string; detail: string; image: { src: StaticImageData | string; alt: string } };
  buyer: JourneyParty;
  traveller: JourneyParty;
  /** All amounts in whole rupees. The traveller fee is the gross reward, before Orbitly's 10%. */
  productPriceInr: number;
  travellerFeeInr: number;
  /** What the buyer would have paid for the same item where they live, in rupees. */
  localPriceInr: number;
  steps: { label: string; when: string }[];
};

/** Priced by the shared engine (amounts in paise). Null for a journey the engine can't price. */
export function journeyPricing(j: Journey): OrderPricing | null {
  const r = calculateOrderPricing({ currency: "INR", productValue: rupees(j.productPriceInr), grossReward: rupees(j.travellerFeeInr) });
  return r.ok ? r.pricing : null;
}
/** Paise. Never negative: a journey that cost more than buying locally shows no saving rather than a minus. */
export const journeySaving = (p: OrderPricing, j: Journey) => Math.max(0, rupees(j.localPriceInr) - p.buyerTotal);
/** Which way the item travels relative to India. Derived from the two countries, so it can't disagree with them. */
export type JourneyDirection = "into_india" | "out_of_india";
export const DIRECTION_LABEL: Record<JourneyDirection, string> = { into_india: "Into India", out_of_india: "Out of India" };
/** The same direction from country codes (requests and trips store ISO codes). */
export function routeDirection(from: string | null, to: string | null): JourneyDirection | null {
  if (!from || !to) return null;
  if (to === "IN" && from !== "IN") return "into_india";
  if (from === "IN" && to !== "IN") return "out_of_india";
  return null;
}
export function journeyDirection(j: Journey): JourneyDirection | null {
  const from = j.traveller.country === "India";
  const to = j.buyer.country === "India";
  if (to && !from) return "into_india";
  if (from && !to) return "out_of_india";
  return null;
}
export type DirectionFilter = "all" | JourneyDirection;

/**
 * The homepage preview: one feed, never padded or duplicated. Under "all" the two directions alternate (each in
 * its own order) so neither leads, then any route that doesn't touch India.
 */
export function previewJourneys(journeys: Journey[], filter: DirectionFilter, limit = 4): Journey[] {
  if (filter !== "all") return journeys.filter((j) => journeyDirection(j) === filter).slice(0, limit);
  const into = journeys.filter((j) => journeyDirection(j) === "into_india");
  const out = journeys.filter((j) => journeyDirection(j) === "out_of_india");
  const mixed: Journey[] = [];
  for (let i = 0; i < Math.max(into.length, out.length); i++) mixed.push(...[into[i], out[i]].filter(Boolean));
  return [...mixed, ...journeys.filter((j) => journeyDirection(j) === null)].slice(0, limit);
}

/** Case-insensitive match on what a card shows: product, detail, cities and countries. A blank query matches all. */
export function searchJourneys(journeys: Journey[], query: string): Journey[] {
  const q = query.trim().toLowerCase();
  if (!q) return journeys;
  return journeys.filter((j) =>
    [j.product.name, j.product.detail, j.buyer.city, j.buyer.country, j.traveller.city, j.traveller.country].some((s) => s.toLowerCase().includes(q)),
  );
}

export const formatInr = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;
