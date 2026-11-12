# Currency display (Stage 7)

**The rule:** local currency for understanding, original currency for transparency, and the pricing engine for financial truth. A display conversion never changes, replaces or feeds a real amount.

## The currency model as it exists

| Concept | Where it lives today | Currency |
|---|---|---|
| Original currency | Request budget: `requests.budget_amount` + `budget_currency`. Offer product price: `offers.product_price_amount` + `product_currency`. | Any of INR, USD, EUR, GBP, AED, JPY, SGD |
| Transaction currency | Offer reward, delivery, other costs and customs (`*_inr`); the product's rupee value at the traveller's own rate (`product_price_inr`). The pricing engine (`src/lib/pricing.ts`) and accepted-price snapshots work in paise. | **INR only** |
| Traveller reward currency | `offers.service_fee_inr` | **INR only** |
| Settlement currency | None. Orbitly takes no payments and makes no payouts. | — |
| Display currency (new) | A per-device preference in the buyer's browser | Any of the seven, where a reference rate exists |

Nothing in the first four rows changed. There are no database or engine changes, and no stored amount is reinterpreted.

## How display works

- **`src/lib/currency.ts`** (pure): `formatCurrency` (`Intl.NumberFormat`, digits per currency), `convert` (through the rate table's base), and `autoCurrency` (browser locale region to currency).
- **`src/lib/exchange-rates.ts`** (server-only): fetches from Frankfurter, at `https://api.frankfurter.dev/v1/latest?base=EUR`.
  - **Source:** a free, keyless service that republishes the **European Central Bank's daily reference rates**. No credentials.
  - **Validation:** each field is checked. A malformed reply, a bad or future date, or a missing INR rate means no rate is shown.
  - **Caching:**
    - an in-memory copy per server instance, refreshed after 6 hours;
    - after a failed fetch, the last good copy is served, marked stale, for up to 7 days;
    - a rate dated more than 4 days ago is labelled "older rate". The browser re-checks this when it loads the rates (`fetchRates`), so a cached copy can't pass as current after its date has aged;
    - fetches time out after 5 seconds.
- **`GET /api/rates`:** per-request (`connection()`), public and read-only. CDN cache: `s-maxage=3600, stale-while-revalidate=86400`. Returns 503 with `no-store` when no rate is available.
- **`src/lib/display-currency.ts`** (client):
  - **Preference:** `localStorage["orbitly.displayCurrency"]`, falling back to memory for the tab if storage is blocked.
  - **Automatic choice:** from `navigator.languages` regions; it's computed, never saved, so it can't overwrite a manual choice. "Automatic" removes the saved choice. With no usable region, it falls back to INR.
  - **Rates:** fetched once per page load, however many amounts are shown.
- **`src/components/currency/currency.tsx`:**
  - `ApproxAmount` adds "Approx. …" under an amount the page already shows in its original currency. It renders nothing when the currency is the same, while rates load, or with no trustworthy rate.
  - `RateNote` reads "Indicative conversion only, not a payment amount", plus the rate date, source and provider. It's hidden when nothing is converted.
  - `CurrencySelect` is the manual override, with an "Automatic (XXX)" option.

## Where it appears

| Place | What's shown |
|---|---|
| Homepage marketplace (both directions) | The traveller reward and buyer saving on each card, the total in the journey dialog, and the example offer's total. The selector and note sit next to the direction filter. |
| Request summary (review and saved request) | The budget, Into India or Out of India. |
| Buyer quote (live offers and practice offers) | "Approx." under the **engine's own total**, converted from that one amount; no fee is recalculated in another currency. The selector and note sit at the head of each offers list. |
| Footer | A global selector |

**Deliberately not converted:** the traveller's reward, fee and net amount. Rewards are rupees, and a converted payout could look like a promise of a payout in another currency.

## Limits

- **AED:** the ECB doesn't publish dirham rates, so AED shows "(original only)" and no conversion.
- **No currency-specific fallback:** if the provider is down with no cached copy, every amount shows in its original currency only.
- **Reference rates, not consumer rates:** they don't include bank or card margins. "Approx." means exactly that.
- **Server memory:** the cache is per server instance, which is fine for read-only display data.

To turn conversions off, remove the `ApproxAmount`, `RateNote` and `CurrencySelect` usages. No data depends on them.
