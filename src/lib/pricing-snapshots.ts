import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Currency, OrderPricing } from "./pricing";

// The price both sides agreed, as accept_offer froze it (supabase/drafts/stage5a_pricing_v1_1.sql). Accepted
// offers show this, never a fresh calculation, so a later change to the fee rules can't change what was agreed.

const COLUMNS =
  "offer_id, policy_version, currency, product_value_minor, gross_reward_minor, buyer_fee_minor, traveller_fee_minor, net_reward_minor, delivery_minor, other_costs_minor, customs_estimate_minor, buyer_total_minor, orbitly_revenue_minor";

export type PricingSnapshotRow = {
  offer_id: string;
  policy_version: string;
  currency: string;
  product_value_minor: number | string;
  gross_reward_minor: number | string;
  buyer_fee_minor: number | string;
  traveller_fee_minor: number | string;
  net_reward_minor: number | string;
  delivery_minor: number | string;
  other_costs_minor: number | string;
  customs_estimate_minor: number | string | null;
  buyer_total_minor: number | string;
  orbitly_revenue_minor: number | string;
};

/** A stored snapshot as the pricing engine's shape (bigint columns may arrive as strings). */
export function snapshotToPricing(s: PricingSnapshotRow): OrderPricing {
  return {
    policyVersion: s.policy_version,
    currency: s.currency as Currency,
    productValue: Number(s.product_value_minor),
    grossReward: Number(s.gross_reward_minor),
    buyerFee: Number(s.buyer_fee_minor),
    travellerFee: Number(s.traveller_fee_minor),
    netReward: Number(s.net_reward_minor),
    delivery: Number(s.delivery_minor),
    other: Number(s.other_costs_minor),
    customsEstimate: s.customs_estimate_minor === null ? null : Number(s.customs_estimate_minor),
    buyerTotal: Number(s.buyer_total_minor),
    orbitlyRevenue: Number(s.orbitly_revenue_minor),
  };
}

/**
 * Agreed prices for these offers, by offer id. RLS limits rows to the buyer and the traveller. Empty, and
 * logged, while the snapshot table doesn't exist yet (the draft migration isn't applied).
 */
export async function readPricingSnapshots(supabase: Awaited<ReturnType<typeof createClient>>, offerIds: string[]) {
  const locked = new Map<string, OrderPricing>();
  if (!offerIds.length) return locked;
  const { data, error } = await supabase.from("offer_pricing_snapshots").select(COLUMNS).in("offer_id", offerIds).returns<PricingSnapshotRow[]>();
  if (error) console.error("[pricing] agreed prices unavailable", { code: error.code });
  for (const row of data ?? []) locked.set(row.offer_id, snapshotToPricing(row));
  return locked;
}
