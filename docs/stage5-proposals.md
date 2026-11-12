# Stage 5 proposals (design only, 2026-11-02)

**Status: PROPOSAL — NOT IMPLEMENTED.**
- No migration, table or function from this document exists anywhere.
- Each section needs your approval before any SQL is written.
- Stage 5 starts only after stage 4 is applied to dev and validated with two real accounts.

**Shared rules for every section:**
- All state changes go through SECURITY DEFINER functions with `search_path=''`. Each one locks the request row first, re-checks who is calling and the current state, and appends to `marketplace_events`.
- Clients are never granted status columns.
- Nothing here involves payments, escrow, paid services or real messages.

## A. Multi-currency offers

**Today's problem:**
- Offers store `service_fee_inr`, `delivery_inr`, `other_costs_inr` and `customs_estimate_inr`, plus rupee totals that rely on a traveller-entered `fx_rate_to_inr`.
- So a buyer in India → USA sees rupee amounts.

**Proposed offer columns:**

| Column | Meaning |
|---|---|
| `product_price_amount`, `product_currency` | Already exist: the item's price in the shop's currency. Unchanged. |
| `currency` | ISO 4217. The currency of everything the traveller charges. Checked as `^[A-Z]{3}$` against an allowlist kept in code (like `COUNTRY_CODES`). |
| `fee_amount`, `delivery_amount`, `other_amount`, `customs_estimate_amount` | `numeric(14,2)` ≥ 0, in `currency`. |
| `fees_total` | Generated: the sum of the four, in `currency`. |
| `agreed_total` | Generated **only when `product_currency = currency`**: product × quantity + fees. Otherwise null. |
| `fx_rate`, `fx_rate_at` (optional) | The traveller's own conversion from `product_currency` to `currency`, with the time they entered it. Shown as "≈ … at the traveller's rate of …, entered on …". **Never used to compute a stored total.** |

**Rules:**
- No silent conversion.
- When the currencies differ, the offer shows two separate figures: the product in its own currency, and the fees in the offer's currency.
- The form defaults `currency` to the request's `budget_currency`, otherwise the destination country's main currency.
- Orbitly supplies no exchange rates. A live rates API needs a separate approval of the provider, cost, terms and key handling.

**Migration:** dev and prod have 0 offers, so the `*_inr` columns can be replaced outright. Any stage 4 test offers would be deleted, which needs your approval, or migrated as `currency = 'INR'`.

**Accepted offers are frozen:** accept stores a copy of the amounts (`accepted_terms jsonb`), so later edits can't change what was agreed. Offers aren't editable today either.

## B. Delivery stages after acceptance

`accepted → purchased → in_transit → arrived → delivered (buyer confirms) → completed`, with a `disputed` side state.

| Step | Who | Evidence (stage 5a, without storage: text only) | Reversible? |
|---|---|---|---|
| purchased | Traveller | Optional note (order or receipt reference). A receipt photo comes later with the private storage bucket. | Not by the traveller. Support can reopen it. |
| in_transit | Traveller | Optional note. | No |
| arrived | Traveller | City or handoff note. | No |
| delivered | **Buyer only** ("I've received it") | None. The buyer's confirmation is the evidence. | **Irreversible.** Completes the request. |
| disputed | Either party, from purchased onward, until 14 days after delivered | Reason and text (see C). | Only support resolves it. |
| cancelled after acceptance | Buyer before purchased; either party with a reason after it | Reason | Irreversible. After purchased it becomes a report automatically. |

**Storage and rules:**
- Stored as `fulfilment_status` plus a timestamp per step on the accepted offer. Each step is one function, e.g. `mark_purchased(offer)`, allowed only from the previous step.
- The traveller can't skip steps or mark delivered.
- Steps can't be undone by users; only a support function can correct them, and that is logged.
- The traveller's trip page gains an "Accepted" section that lists their accepted offers through a definer function with named columns. This replaces the removed accepted-traveller read: no buyer id, and the city only (no address) until a contact design exists.

## C. Reports and disputes

**Table `reports`:**
- Columns: id, reporter (default `auth.uid()`), `request_id` or `offer_id`, `reason`, details (≤2000 characters), `status` (open / reviewing / resolved / dismissed), `created_at`.
- Reasons: `wrong_item`, `trip_cancelled`, `not_delivered`, `misleading_info`, `disagreement`, `prohibited_item`, `other`.

**Who can do what:**
- **Create:** only a party to the request or offer (the buyer, or an offering traveller), once per reason per offer.
- **Read:** the reporter only. The other party sees only that a dispute is open, never the text, until a support process exists.
- **No update or delete by users.**
- **Effect:** an open report on an accepted offer sets `disputed` and freezes further steps.

**Needs your decision:** who reviews reports. There is no admin role today. Options:
- **Recommended:** a `support` role whose functions are callable only by a fixed staff user list in a private table.
- Or the Supabase dashboard (SQL), as a manual process at the start.

No escrow, refunds or payment holds; those need a separate payments design.

## D. Notifications

**Source:** `marketplace_events` is already the single, append-only record of what happened.

**Stage 5a (no provider, no cost):**
- In-app notices. A definer function `my_notifications(since)` maps events to the right person:
  - offer submitted → buyer;
  - accepted, declined or closed → traveller;
  - withdrawn → buyer;
  - delivery steps → the other party.
- A small `notification_reads(user, last_seen_event_id)` table drives an unread count in the header.
- No ids of other people are returned.

**Later, each needing approval:**
- **Email:** custom SMTP. For example, Resend's free tier is about 3,000 a month; its terms and domain DNS need review.
- **SMS:** Twilio or MSG91. Paid, per message, and needs Indian DLT registration for India.
- **Delivery mechanism:** a Supabase database webhook or cron on new events → an Edge Function → provider, with an outbox table so each event is sent once and retries are visible.

**User control:** per-channel opt-in on the profile, with email off by default until the provider is approved.

## E. Trust and verification roadmap

| Signal | Today | Shown as | Next |
|---|---|---|---|
| Email confirmed | Supabase Auth confirms email at sign-up | "Email confirmed": **never** "verified" or "identity" | — |
| Phone verified | Exists (SMS OTP); required to publish, add trips and offer | "Phone verified" | Real SMS provider for prod (P4) |
| Identity review | **None** | "Not available yet" (no badge) | A provider (e.g. Persona, Onfido, DigiLocker for India): cost, data handling and consent need approval. Store only the outcome and date, never documents, in our database. |
| Trip review | **None.** Every trip is `unverified` | "Trip details aren't verified by Orbitly" (already in the UI) | Manual review of a booking reference, needing a private bucket and a support role. Sets `verification_status` through a support function only. |
| Transaction history | Not shown | — | A count of completed deliveries and disputes per person, computed from `marketplace_events`, shown only to the other party in an active offer. No public profiles. |

**Rule:** a label appears only when the check it names actually happened. The tests assert that clients can't set `verification_status` or `eligibility_status`.

## Order proposed

1. Multi-currency (A), with B's accepted-offer freeze.
2. Delivery stages (B) and the traveller's "Accepted" view.
3. In-app notifications (D, stage 5a).
4. Reports (C), after the reviewer decision.
5. Trust items (E), each with its own approval.
