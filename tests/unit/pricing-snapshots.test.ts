import { describe, expect, it, vi } from "vitest";
import { readPricingSnapshots, snapshotToPricing, type PricingSnapshotRow } from "@/lib/pricing-snapshots";

const ROW: PricingSnapshotRow = {
  offer_id: "o1",
  policy_version: "1.1",
  currency: "INR",
  product_value_minor: "200000", // bigint columns can arrive as strings
  gross_reward_minor: 33_334,
  buyer_fee_minor: 10_000,
  traveller_fee_minor: 3_333,
  net_reward_minor: 30_001,
  delivery_minor: 0,
  other_costs_minor: 0,
  customs_estimate_minor: null,
  buyer_total_minor: 243_334,
  orbitly_revenue_minor: 13_333,
};

function client(result: { data: unknown; error: unknown }) {
  const query = { select: vi.fn(() => query), in: vi.fn(() => query), returns: vi.fn(async () => result) };
  return { from: vi.fn(() => query), query } as unknown as Parameters<typeof readPricingSnapshots>[0] & { query: typeof query };
}

describe("agreed price snapshots (F-04)", () => {
  it("are shown exactly as stored, never recalculated", () => {
    expect(snapshotToPricing({ ...ROW, buyer_fee_minor: 7 })).toMatchObject({ policyVersion: "1.1", productValue: 200_000, buyerFee: 7, netReward: 30_001, customsEstimate: null });
  });

  it("are read for the given offers only", async () => {
    const c = client({ data: [ROW], error: null });
    const locked = await readPricingSnapshots(c, ["o1"]);
    expect(locked.get("o1")?.buyerTotal).toBe(243_334);
    expect(c.query.in).toHaveBeenCalledWith("offer_id", ["o1"]);
  });

  it("make no request when nothing is accepted", async () => {
    const c = client({ data: [], error: null });
    expect((await readPricingSnapshots(c, [])).size).toBe(0);
    expect(c.from).not.toHaveBeenCalled();
  });

  it("come back empty, and are logged, while the snapshot table doesn't exist yet", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const locked = await readPricingSnapshots(client({ data: null, error: { code: "PGRST205" } }), ["o1"]);
    expect(locked.size).toBe(0);
    expect(log).toHaveBeenCalledWith("[pricing] agreed prices unavailable", { code: "PGRST205" });
    log.mockRestore();
  });
});
