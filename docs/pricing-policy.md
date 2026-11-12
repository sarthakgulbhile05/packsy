# Pricing policy v1.3 (FD-9 and the Q13a and Q13g decisions: founder-approved commercial direction)

**Status:** the engine and screens are built on `feature/two-way-marketplace`; nothing is committed.
- **FD-9 (2026-11-12)** replaced the 5% buyer fee with **3%**, superseding v1.1's 5% everywhere. It is commercial-policy
  approval only: no legal, tax, accounting or provider compliance is established. Effective launch date: not specified.
  Full record: `docs/payments/settlement-policy-review.md` section 15.
- **The Q13a decision (2026-11-12)** removed the minimum traveller reward: no minimum reward and no minimum
  commission. It supersedes the former ₹300 net minimum (register section 16).
- **The Q13g decision (2026-11-12):** a reward is whole rupees from **₹1** to ₹10,00,000; ₹0 is rejected (register
  section 17). v1.3 hadn't been applied or published, so it includes Q13g.
- **App:** `src/lib/pricing.ts` is v1.3 (3%, 10%, no minimum).
- **Dev database: still v1.1 (5%, ₹300 net floor).** Migration `20261110072033_stage5a_pricing_v1_1` (the same text as
  `supabase/drafts/stage5a_pricing_v1_1.sql`) is applied to dev only and is unchanged.
- **The database drafts** are `supabase/drafts/stage5c_pricing_v1_2.sql` (v1.2, kept as its record) and then
  `supabase/drafts/stage5d_pricing_v1_3.sql` (v1.3, which needs 5c first). Neither is applied anywhere or is a
  migration. Dev and production each need their own approval.
- **Mismatch safeguard:** the app calls `accept_offer` with the policy version the buyer was shown (`1.3`). Dev's v1.1
  function has no such argument, so acceptance fails with "Nothing was accepted". The drafts refuse any version but
  their own. Dev also still refuses offers under ₹334; the app then says "Nothing was sent". An offer is never accepted at a fee the buyer wasn't shown.
- The marketplace stays off (`MARKETPLACE_OPEN=false`).
- **Orbitly doesn't take payments.** These fees are what the screens show, not money anyone collects.

## The rules

| Rule | Value |
|---|---|
| Buyer platform fee | **3%** of the agreed product value (FD-9; 5% in v1.1) |
| Traveller platform fee | 10% of the agreed gross traveller reward, deducted from it. Never applied to product, customs or delivery reimbursement |
| Minimum traveller reward or commission | **No ₹300 minimum and no minimum commission** (Q13a). A valid reward is whole rupees from **₹1 to ₹10,00,000**; ₹0 is rejected (Q13g). v1.1 and v1.2 had a ₹300 net floor (₹334 gross); dev's database still enforces it. |
| Buyer total | product value + gross reward + buyer fee + delivery + other costs + customs estimate, each itemised |
| Orbitly gross revenue | buyer fee + traveller fee. This is revenue, not profit. It isn't net of provider fees, and its tax treatment is unresolved. Delivery and customs are never part of it. |

**FD-9 (2026-11-12) changes only the buyer-fee rate, 5% → 3%. Founder decisions FD-1 to FD-8
(2026-11-11, `docs/payments/settlement-policy-review.md`) change none of these formulas.** Under FD-1 the product value is an estimate unless independently verified as fixed, and a higher actual price
needs the buyer's explicit approval before purchase. Under FD-2 the customs estimate stays a separate, itemised buyer
cost. FD-3 adds a separately identified, explicitly consented customs ceiling that isn't a guarantee of the actual
duty; it's planned but not built. Under FD-4 delivery stays a separate, itemised buyer cost: reimbursed at the actual
evidenced expense within the buyer's consented allocation, with any excess approved before it's incurred or charged, never part of
the traveller reward or the 10% base, never revenue, and never presented as a guaranteed price. FD-5 allows an optional route where the buyer pays
the delivery provider directly, where verified; that amount would sit outside Orbitly's collection, revenue, reward and
commission. The engine doesn't model that route: its buyer total always includes delivery. FD-6 makes Orbitly the coordinator of
the delivery arrangement, with no fee for coordination and no delivery guarantee. FD-7 makes the buyer's delivery-allocation approval and a confirmed,
workable delivery method conditions of acceptance; `accept_offer` doesn't check them yet. FD-8 classifies feasibility and records each decision, with no fee. None of
the eight is implemented. The customs and delivery lines in the buyer total are still only the traveller's estimates.

The same rules apply in both directions. Direction isn't an input to the engine.

## Where it lives

**`src/lib/pricing.ts`** is the only place fee formulas exist. It provides:
- `calculateBuyerPlatformFee`
- `calculateTravellerPlatformFee`
- `calculateNetTravellerReward`
- `validateTravellerReward`
- `calculateOrderPricing`
- `toMinor` and `formatMinor`

**What uses it:**

| Where | What it does with the engine |
|---|---|
| `src/lib/offer.ts` | The server-side offer check (`offerToRow`), and `priceOffer`, which prices a stored offer |
| Offer form (`components/marketplace/offer-form.tsx`) | Shows a live gross, fee and net preview for the traveller |
| Buyer offer list (`components/marketplace/request-marketplace.tsx`) | Shows the full quote |
| Trip page (`app/trips/[id]/page.tsx`) | Shows the traveller's net reward |
| Practice offers (`components/request/offers.tsx`, `lib/request-draft.ts`) | Prices the on-device practice offers |
| Homepage examples (`lib/journey.ts`) | Prices the illustrative examples |
| `components/marketplace/price-breakdown.tsx` | Holds the two shared displays: `TravellerPayout` and `BuyerQuote` |

The database repeats the arithmetic once, in `accept_offer`. The v1.3 drafts' agreement with the app is checked by
`tests/db/pricing-stage5d.test.ts` (v1.2 alone: `tests/db/pricing-stage5c.test.ts`). `tests/db/pricing-stage5a.test.ts` now pins that dev's v1.1 records 5%, a mismatch
the app refuses to accept under.

## Precision and rounding

- **Integer minor units throughout,** in paise for INR. The digits per currency follow ISO 4217 (`MINOR_DIGITS`; JPY has none).
- **Input is parsed from strings** with `toMinor`, never through floats. More decimals than the currency has are rejected.
- **Percentages round half up** to the paisa: `(amount × bps + 5000) ÷ 10000`, with integer division. The same formula is `public.pricing_percent` in SQL.
- **No minimum reward.** The commission is 10% of the gross reward, half up, and the traveller receives the rest: a ₹200
  reward nets ₹180 and ₹1 nets ₹0.90. The 10% arithmetic is tested for every amount from ₹0.00 to ₹400.00 in paise.
  - *Historical (v1.1–v1.2):* the smallest gross reward netting ₹300.00 was ₹333.33; whole rupees made it ₹334.
- **v1.1's worked example, re-priced** (₹2,000 product, ₹333.34 reward): buyer fee ₹60, traveller fee ₹33.33, net ₹300.01, buyer total ₹2,393.34, Orbitly ₹93.33. This is tested.
- **FD-9's worked example** (₹50,000 product, ₹3,000 reward): buyer fee ₹1,500, commission ₹300, net ₹2,700, Orbitly revenue ₹1,800 before costs, taxes, provider fees and refunds. This is tested.

## Currency

- **Rewards and all offer costs are INR today,** because `offers` stores them in whole rupees.
- **The product can be in another currency,** converted at the traveller's own stated rate (`fx_rate_to_inr`). The quote shows that rate next to the product value. The buyer fee is 3% of that rupee value.
- **Nothing converts silently.** The engine only prices amounts already in one currency.
- **Rewards are priced in INR only** (`rewardCurrencies`). Asking the engine to price a reward in any other currency returns a clear "not supported yet" error, not a guessed conversion.
- **What multi-currency needs:** the multi-currency offer columns in `docs/stage5-proposals.md` §A.

## Enforcement

- **App path:** `sendOffer` → `offerToRow` → `validateTravellerReward` accepts whole rupees from ₹1 to ₹10,00,000 and refuses anything else.
- **Direct API path:** the offers table's original check (`service_fee_inr` between 0 and 1,000,000) plus, under stage 5d,
  `offers_service_fee_inr_at_least_one` (≥ 1, `NOT VALID`). `accept_offer` refuses any older offer below ₹1.
- **Historical (v1.1, still on dev):** stage 5a added `offers_min_net_reward` (`service_fee_inr × 90 ≥ 30000`, `NOT VALID`)
  and an `accept_offer` refusal. Stage 5d drops both, and replaces the snapshot's `net_reward_minor ≥ 30000` check with `≥ 0`.
- **Fees, net amounts and totals are never accepted from clients.** No such columns exist, and the engine ignores extra fields (tested).

## Price lock and history

- **Offers can't be edited.** Clients have no update grant, so a quoted price can't drift. A different price means withdrawing the offer and sending a new one, which the buyer then sees as a new quote.
- **The draft adds `offer_pricing_snapshots`.** `accept_offer` writes it in the same transaction as the acceptance. It records:
  - the policy version and currency;
  - the product as offered and the traveller's rate;
  - the product value, gross reward, both fees and the net reward;
  - delivery, other costs and the customs estimate;
  - the buyer total and Orbitly's revenue.
- **Snapshot rules:** check constraints keep the figures consistent. A trigger refuses any update or delete, even by the database owner. Only the buyer and the traveller can read it.
- **What the screens show for an accepted offer:** the snapshot (`src/lib/pricing-snapshots.ts`), never a fresh calculation. Before the draft is applied, they show a label instead.
- **The draft also ties each offer's arrival date to its trip, and freezes trip dates while offers are live.** See `docs/security-remediation.md`.
- **Not yet built:** re-quoting an accepted order, which needs both parties to confirm a change. FD-1's pre-purchase
  price check and buyer approval are also not built. There's no flow that changes an accepted price today, so nothing can bypass the snapshot.

## Decisions needed (not guessed)

1. **Payments.** Orbitly takes no payments, so neither fee can be collected and there's no traveller payout. We need to decide who collects money, when, through which provider, and at what processing cost.
2. **Tax and legal review.** Questions for a professional:
   - GST on platform fees, and invoicing.
   - Rules for cross-border payments (FEMA/LRS).
   - Who is the importer of record, and who pays customs.
   - TDS on traveller payouts.
   - GST, TDS and TCS on delivery reimbursements, and unspent delivery allocations (settlement review Q9f).
3. **Refunds and cancellations.** None exist. We need to decide which fees are refundable in each case:
   - the buyer cancels before acceptance, or after it;
   - the traveller cancels;
   - the order is cancelled after purchase;
   - partial refunds;
   - failed payouts;
   - who absorbs payment-processing costs.

   The lifecycle today only moves an order between open, matched, completed and cancelled, with no money.
4. **Rewards in other currencies** (no minimum to set: Q13a).
5. **Applying the drafts:** stage 5a is on dev only; production needs approval. Stages 5c then 5d need approval for
   dev, then production (register Q13d). Until they are on dev, acceptance there fails safely, and offers under ₹334 are
   refused there with "Nothing was sent" (above).
6. **Showing fees publicly.** The homepage examples show the 3% and 10% fees, which FD-9 approves as a commercial
   direction. They're shown, not charged. How they must be disclosed is for counsel (register Q13e). The FAQ doesn't
   mention Orbitly's fees yet.
7. **The ₹300 minimum:** removed (Q13a decision). ₹0 rewards: rejected (Q13g decision).

## Admin and finance visibility

There's no admin role or interface (see `docs/stage5-proposals.md` §C). Once snapshots exist, gross revenue is `sum(orbitly_revenue_minor)`.

Processing costs, refunds, chargebacks and contribution margin need payment data that doesn't exist yet. No dashboard was built.
