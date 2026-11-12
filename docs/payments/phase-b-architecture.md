# Phase B: transaction database architecture

> **THIS MIGRATION HAS NOT BEEN APPLIED TO ANY REMOTE DATABASE. REAL PAYMENTS ARE DISABLED.**
> **DO NOT APPLY: P0 OPEN.** Payouts still use the net reward only. Settlement policy and founder decisions:
> `settlement-policy-review.md` (revision 16, including FD-1 to FD-9 and the Q12a, Q12b, Q13a and Q13g decisions).

| | Where |
|---|---|
| Draft | `supabase/drafts/phaseb_transactions.sql` |
| Undo (isolated test databases only) | `supabase/drafts/phaseb_transactions.recovery.sql` |
| In-memory tests | `tests/db/transactions-phaseb.test.ts` (PGlite, which the test itself proves isolated) |
| Supabase pieces the draft needs, for tests | `tests/db/phaseb-supabase-stub.sql` |
| Real-concurrency check | `tests/db/phaseb-concurrency.mjs`, run by hand on a throwaway, socket-only Postgres |
| Business rules | The Phase A lifecycle, `src/lib/payments/transaction.ts`. The database copies Phase A's rules and outcomes, and a test fails if they differ. |

Nothing in the app reads or writes these tables. `PAYMENTS_ENABLED` is still a hard-coded `false`, the payment
provider is still the disabled one, and `/tracking` is still illustrative.

## Corrective round (after the audit)

| Finding | Status | What changed |
|---|---|---|
| **P0** payout leaves out the product cost | **BLOCKED** on the open decisions in `settlement-policy-review.md` section 6 | Money flow documented with exact scenarios (`financial-flow.md`); the draft's header now says DO NOT APPLY |
| **P1-1** provider answers dropped in unexpected states | **PASS** | Phase A and the draft: an answer settles the attempt still open, by its exact key, from any state. Unexpected success → manual review; unexpected failure → stays put; both are flagged `unexpected`. A buyer cancelling no longer closes the attempt. A retry or order cancellation is refused while an attempt is open (`payment_attempt_open`). Provider facts that can't be applied go to `transaction_anomalies`. |
| **P1-2** service-role call path | **PASS (local)**, Supabase setup NOT VERIFIED | Three narrow entry points and two new roles; the service role is granted nothing |
| **P1-3** evidence from other orders | **PASS** | Evidence must be a file in this order's folder of a private bucket, uploaded by the person citing it. Storage policies limit reading to the order's own buyer and traveller. |
| **P1-4** estimates collected as fixed amounts | **BLOCKED.** D1, D5, D7, D8 and FD-1 are approved; D2's rate source and the verification of FD-2, FD-3 and FD-4 are open | Reconciliation design below; not implemented |
| **P1-5** account deletion blocked | **BLOCKED** on legal advice | Design below; not implemented |
| Provider ids namespaced; only provider events carry one | **PASS** | `<provider>:<id>`, checked by a constraint and the entry point |
| Cross-order provider id → investigation | **PASS** | Recorded as an anomaly, including under real concurrency (scenario 4b) |
| Recovery atomic, no unrelated access removed | **PASS** | One transaction, table locks, refusals; no longer touches the service role |
| Admin attributable | **PASS** | Identity from the session, multi-factor sign-in, a reason stored with the event |
| Timeouts documented | **PASS** | Entry points set `lock_timeout = 3s`; statement timeouts come from the role (NOT VERIFIED on Supabase) |
| Attempts traceable | **PASS** | Every start and answer event carries its attempt's key |

**One defect found only by real Postgres.** The commit-time check (`transactions_event_recorded`) runs at commit as
the session's role. None of the app's roles may read the events table, so on Supabase every buyer or server action
would have failed at commit. It now runs with its owner's rights. PGlite didn't show the problem.

## Entities

```
offers ──1:1── offer_pricing_snapshots (Stage 5a, immutable)
                     │ 1:1 (offer_id, FK)
                     ▼
               transactions ──1:n── transaction_events     (append-only; every attempt's key)
                     │
                     └──1:n── transaction_operations       (payment / refund / payout attempts)

transaction_anomalies     provider facts that couldn't be applied (append-only, owner-only)
private.transaction_rules the Phase A rules and outcomes
private.transaction_admins who may act as Orbitly's review team
storage bucket 'transaction-evidence'   transactions/<order id>/<file>
```

## How an order changes

All changes go through the internal function `private.apply_transaction_event`. No role can call it directly. Inside
one database transaction it:

1. Locks the order row.
2. **Idempotency:** the same event id is a no-op; an event id reused for something else is refused. A provider event
   id seen on the same order and type is a no-op; seen anywhere else, it's refused (`provider_event_conflict`).
3. Checks, in Phase A's order:
   - **the event and who's sending it:** the event type exists; the role may take it; buyers and travellers must be
     this order's own; admins must be listed; provider and system carry no person id; provider events, and only
     provider events, cite a namespaced provider id;
   - **provider answers:** settle the open attempt of their kind, by its key (`operation_missing`,
     `operation_mismatch`), from any state;
   - **everything else:** the state allows the event; the version matches;
   - **payments:** no retry or cancellation while a payment attempt is open;
   - **the content:** evidence is present and belongs to this order; the amount and currency match the snapshot;
   - **the money guards:** chargeback, duplicate payout, duplicate refund, dispute outcome, payment captured; a
     resolution must name an outcome.
4. Changes the state and version.
5. Appends the event, with its attempt key.
6. Starts an attempt or settles one.

Any error undoes everything.

**Where the database is stricter than Phase A** (each still awaits your decision):
1. **`payment_not_captured`:** no refund or payout if no payment was captured. Note: there's still no way to close an
   order sent to review before payment. Adding `cancel_order` from review is a lifecycle change and needs approval.
2. **`operation_mismatch`:** an answer must name its attempt's key. Phase A has no attempt keys.
3. **Global, namespaced provider event ids.**
4. **Evidence:** order-scoped files, uploaded by the person citing them.
5. **Admins:** named, signed in with multi-factor, and giving a reason.

## Execution paths and roles (P1-2)

| Entry point | Called by | Role it gives the event | Checks |
|---|---|---|---|
| `private.record_provider_event(order, type, '<provider>:<id>', attempt key, amount, currency, provider ref)` | `orbitly_webhook` only | `provider` (fixed) | Namespaced id; then everything above. A fact that can't be applied is **kept in `transaction_anomalies`** and the call returns `{anomaly: code}`, so nothing is lost. Lock timeouts still fail, so they can be retried. |
| `private.record_system_event(order, type, event id, version)` | `orbitly_system` only | `system` (fixed) | No identity can be supplied |
| `private.open_transaction(offer)` | `orbitly_system` only | n/a | Accepted offer, snapshot, supported route; idempotent |
| `public.transaction_admin_act(order, type, event id, version, reason, resolution)` | `authenticated` | `admin`, as `auth.uid()` | Listed in `transaction_admins`; `auth.jwt()->>'aal' = 'aal2'` (multi-factor); reason of 10–500 characters, stored with the event; version required |
| `public.transaction_act(order, type, event id, version, evidence, note)` | `authenticated` | `buyer` or `traveller`, from `auth.uid()` | Must be a party, otherwise "not found"; version required |
| `private.apply_transaction_event(…)` | nobody (internal) | whatever the entry point gives | Everything |
| Trigger functions | nobody | n/a | `transactions_event_recorded` runs with its owner's rights (see "One defect" above) |

**Roles:** `orbitly_webhook` and `orbitly_system` are created **without login** (`nologin`). Each has usage on the
`private` schema and execute on its own entry points, and nothing else: they can't read or write any table (tested).
The **service role is granted nothing.**

**How the server would connect (to set up later; no credentials here):**
1. A dedicated database login per role, created by hand and granted only its role (`grant orbitly_webhook to …`).
2. The password is kept only in server-side environment variables, never `NEXT_PUBLIC_`.
3. The connection is direct Postgres through the Supabase pooler. The `private` schema should **not** be exposed
   through Supabase's API (NOT VERIFIED; it's the default).
4. Admin and party actions use the normal signed-in API (`public` functions).

**If a webhook login leaks:** an attacker can submit provider facts. Each must still match an open attempt's key and
the exact snapshot amount, and anything that doesn't is recorded as an anomaly. Two mitigations:
- the webhook handler must confirm each fact with the provider, server to server, before calling the database;
- reconciliation catches forged confirmations.

Then rotate the login. The system login can only take system steps.

## Evidence isolation (P1-3)

- **Bucket:** `transaction-evidence`, private, created by the draft.
- **Path:** `transactions/<order id>/<file>`, letters, digits, `. _ -`, no subfolders, no `..`.
- **Upload policy:** a signed-in party uploads only into their own order's folder, as themselves (`owner_id` must be
  their id).
- **Read policy:** only the order's buyer and traveller can read.
- **No changes after upload:** there's no update or delete policy.
- **Citing evidence:** the function accepts only files that exist in that order's folder and were uploaded by the
  person citing them. Tested against: another order's file, the other party's upload, files never uploaded,
  `javascript:`, URLs, `..`, markup, subfolders, and absolute paths.
- **NOT VERIFIED:** Supabase's `storage.objects.owner_id` column and the `storage.foldername()` function. The tests use
  a stub with the same shape.

## Estimates vs actual costs (P1-4): design, not implemented

What a reconciliation step needs under the approved D1, D5, D7, D8 and FD-1, and once D2 and FD-2's verification are settled:

1. **Before purchase (FD-1):** the traveller records evidence of the actual store price (amount, currency, rate, the
   file) as an event. That's evidence, not money. The receipt is recorded after the purchase.
2. **The difference is computed against the snapshot,** never against a new price.
   - **Below the estimate:** the unused amount becomes a buyer refund line (D7).
   - **Above the estimate:** that's a **shortfall**. **No automatic charge.** The order waits for the buyer's
     explicit approval of a top-up, which is a separate payment attempt with its own key. Purchase can't proceed
     until that approval is recorded (FD-1). If the buyer declines: manual review, or a clearly disclosed cancellation
     policy once one exists. No automatic charge and no automatic traveller liability. Never a silent change.
3. **Delivery** follows the same pattern (D5, FD-4): a disclosed, consented allocation; actual evidenced expenses
   reconciled against it; any excess approved before it's incurred or charged; and no delivery amount in the reward,
   the commission base or revenue ("Delivery expenses (FD-4)" below). **Customs** follows FD-2 and FD-3: a separately identified, explicitly
   consented ceiling at acceptance; actual documented duty reconciled against it; fresh explicit approval above it; and a
   customs route for that specific journey before acceptance (`settlement-policy-review.md` section 7). None of this is
   designed in the draft yet.
4. **The settlement** (`settlement-policy-review.md` section 2; a cash reconciliation, not a complete accounting identity) is approved by an admin with a reason. Its lines must add up to exactly
   what was collected, and the payout and any refund are taken from it.

## Customs ceiling (FD-3): proposed concepts, not implemented

FD-3 is a founder-approved business-policy direction, not an implementation approval. No SQL exists for any of this,
and none should be written until the items marked *unresolved* are verified. An order would need:

| Concept | Notes |
|---|---|
| Estimated customs amount | Today `customs_estimate_minor` in the snapshot; it may be NULL, which FD-3 doesn't allow for an accepted order |
| Ceiling amount | Separately identified from the estimate. Not stored anywhere today |
| Buyer consent evidence and timestamp | An explicit consent event at acceptance |
| Collection versus authorisation mode | *Unresolved* (Q2a; provider C7) |
| Amount captured | Only if authorised (settlement register case C6) |
| Amount released or refunded | Released if authorised, refunded if collected (D7) |
| Actual duty assessment | Amount and currency |
| Evidence reference | A file in the order's evidence folder; acceptable evidence is *unresolved* (Q2h) |
| Excess requiring approval | Actual duty above the ceiling; fresh explicit approval, then a separate top-up (provider C8) |
| Manual-review state | When the buyer declines an excess; the procedure isn't written (P8) |
| Customs route feasibility | Determined before acceptance, per journey; criteria *unresolved* (Q2g) |
| Importer of record and responsible payer | *Unresolved until verified*, per direction (Q2c) |
| Direct-payment-to-authority status | Where applicable; feasibility *unresolved* (Q2d, Q2j) |

The current draft can't hold any of these. It allows one payment, one refund or one payout, at snapshot amounts (P0 and
P1-4 above).

## Delivery expenses (FD-4): proposed concepts, not implemented

FD-4 is a founder-approved commercial-policy direction, not an implementation approval. It doesn't establish legal
permissibility, provider capability, tax or accounting treatment. No SQL exists for any of this, and none should be
written until the items marked *unresolved* are verified (`settlement-policy-review.md` section 8). An order would need:

| Concept | Notes |
|---|---|
| Estimated delivery expense | Today `delivery_minor` in the snapshot (whole rupees in the offer). Not a guaranteed price |
| Delivery allocation disclosed to the buyer | Not stored separately today. Whether it may differ from the estimate is *unresolved* (Q9j) |
| Buyer consent evidence and timestamp | An explicit consent event at acceptance. Consent alone doesn't make the allocation collectible |
| Collection versus authorisation mode | *Unresolved* (provider C7; Q9b). An authorisation can't be assumed to last indefinitely (provider H2) |
| Itemised delivery line | Kept apart from product, reward, fees and customs (provider C9) |
| Actual expense lines | One per expense (transport, courier, packaging, handling, final delivery): amount, currency, who paid |
| Evidence reference | A file in the order's evidence folder. What is sufficient is *unresolved* (Q9d); evidence isn't entitlement |
| Amount captured, released or refunded | Released if authorised, refunded if collected, only through an approved mechanism (provider C7, R1, R5) |
| Excess requiring approval | An approval event recorded **before** the expense is incurred or charged, then a separate top-up (provider C8, C10) |
| Declined excess and manual-review state | The procedure isn't written (Q9h) |
| Direct payment to a delivery provider | FD-5 Route B: an order memo, never Orbitly cash and never a payment, refund or payout operation (below) |
| Unresolved traveller outlay | An expense above the buyer's consent. Entitlement *unresolved* (Q9i) |
| Settlement rule | Delivery lines never enter the reward, the commission base or revenue |

The current draft can't hold any of these either.

## Direct delivery-provider payment (FD-5): proposed concepts, not implemented

FD-5 is a founder-approved commercial-policy direction for an **optional** route (Route B) where the buyer pays the
delivery provider directly. It doesn't establish that any provider, jurisdiction or payment method supports it. No SQL
exists for this, and no order may be shown as eligible until it's verified (`settlement-policy-review.md` section 9).

**Design rule:** a Route B payment never creates a `transactions` amount, a `transaction_operations` payment, refund or
payout, a settlement line or revenue. It is recorded, at most, as an order memo kept apart from Orbitly's financial
records.

| Concept | Notes |
|---|---|
| Route eligibility | *Unverified* until legal and operational verification and the provider's support are on file (Q10a–Q10c). Never presumed |
| Route selected | The buyer's agreement to the direct arrangement and the named provider, after disclosure that payment goes to the provider |
| Provider and recipient identity | How it's verified is *unresolved* (Q10b) |
| Disclosed delivery estimate | Itemised, not guaranteed (FD-4) |
| Buyer payment reported | The buyer's statement; never treated as provider confirmation |
| Payment evidence reference | Optional; sufficiency, format and retention *unresolved* (Q10d, Q10j) |
| Provider confirmation | Separate from the buyer's report and evidence |
| Delivery booked / completed | Separate statuses; payment evidence never sets either |
| Evidence unavailable or disputed | Manual review; the procedure is *unresolved* (Q10e, Q10i) |
| Memo amount | Visibility only, labelled outside Orbitly's ledger; any reporting or tax consequence *unresolved* (Q10j) |
| Unavailable route | Marked unavailable or unverified. No automatic switch to an Orbitly collection route; any alternative is separately disclosed and approved (Q10l) |

## Delivery coordination (FD-6): proposed concepts, not implemented

FD-6 is a founder-approved commercial-policy direction: the buyer specifies the address and preferred method, the
traveller confirms practicality, and Orbitly coordinates and records status. It isn't a delivery guarantee, and it
doesn't confirm any operational capability (`settlement-policy-review.md` section 10). No SQL exists for this.

**Design rule:** no delivery status, booking or evidence record creates an amount, a payment operation, a settlement
line, revenue or a liability. Orbitly has no courier integration, live tracking, automatic booking, proof-of-delivery
API, insurance or return management; `/tracking` is illustrative.

| Concept | Notes |
|---|---|
| Delivery address and preferred method | From the buyer. Today requests hold only `delivery_city`, and the traveller picks `handoff_method` in the offer; changing that needs its own approval |
| Traveller feasibility | One of FD-8's classifications (Feasible, Uncertain, Not feasible, Manual review, No lawful and practical route), with a reason; the traveller isn't required to propose an alternative |
| Disclosed method and estimate, buyer approval | Before any booking (FD-4, FD-6 item 7) |
| Payment route | Route A (FD-4) or verified Route B (FD-5); never switched automatically |
| Booking | Only after approvals and feasibility; who books is *unresolved* (Q11a) |
| Status updates | Illustrative names only (booked, picked up, in transit, delivered, failed, returned, refused); records only, never implying success or creating an amount |
| Evidence references | Handover and delivery evidence; sufficiency and retention *unresolved* (Q11k, Q11l) |
| Exception and manual-review state | No lawful, practical method, refusal, failure, loss or damage; procedures *unresolved* (Q11c–Q11i, Q11o) |

## Acceptance gate (FD-7): proposed concepts, not implemented

FD-7 is a founder-approved commercial-policy direction: an order can't become accepted without the buyer's delivery
city, preferred method and delivery-allocation approval and the traveller's confirmation of a workable method;
uncertain feasibility keeps it pending (`settlement-policy-review.md` section 11). No SQL exists for this.

**Today:** `accept_offer` (Stage 5a draft) checks only that the trip is active, the offer is `pending`, the offer
matches the trip, and the reward meets the minimum. It checks no product-price approval, customs route, ceiling
consent, delivery allocation or delivery feasibility. The offer statuses `pending` and `accepted` are not FD-7's
conceptual states; how FD-7 maps onto offer and request statuses needs its own design and approval. No new status names
are proposed here.

| Concept | Notes |
|---|---|
| Delivery city and preferred method | From the buyer; today only `delivery_city` exists, and the traveller picks `handoff_method` |
| Traveller feasibility classification | Before acceptance, under FD-8 (below); evidence content set by the Q12b decision (register 14.2); legal evidence and validity *unresolved* (Q11s, Q11t) |
| Delivery estimate disclosed and allocation approved | A buyer consent event, separate from the customs ceiling consent |
| Gate record | One entry per gate (FD-1, FD-2 and FD-3, FD-4, FD-5 where chosen, FD-6, FD-7); acceptance only when all are satisfied |
| Uncertain feasibility | The order stays unaccepted (conceptually pending); how long is *unresolved* (Q11w). Traveller silence also keeps it pending, never a rejection (FD-8) |
| No workable method | Acceptance refused; what happens next is *unresolved* (Q11o) |
| Acceptance | Books nothing, collects nothing beyond approved amounts, and recognises no revenue by itself |

## Feasibility classification and audit (FD-8): proposed concepts, not implemented

FD-8 is a founder-approved commercial-policy direction. It sets policy and future architecture requirements, not
permission to change any database or application (`settlement-policy-review.md` section 12). No SQL exists for this,
and the five classifications aren't status names.

| Concept | Notes |
|---|---|
| Classification | Feasible, Uncertain, Not feasible, Manual review, or No lawful and practical route. Conceptual labels only |
| Non-response | The order stays pending; silence isn't a classification. Never an automatic rejection, cancellation, traveller liability or buyer charge; no timeout is set (Q11w) |
| Audit record | Decision-maker (identity or role), classification, reason, evidence reference, timestamp, outstanding requirements |
| Reassessment | A new record referring to the earlier one, which stays visible; after acceptance the consequences are *unresolved* (Q11u) |
| Authority | The traveller confirms Feasible or Not feasible for the proposed method. An authorised Orbitly operations reviewer resolves operational ambiguity; legal questions go to qualified counsel (Q12a decision). Appointment, access control and which counsel are *unresolved* (Q12h, Q12d) |
| Evidence | Information relied on, never automatic proof of legal feasibility. A Feasible assessment identifies method, location, practical ability, limitations and supporting information (Q12b decision); the Uncertain/Manual review boundary is *unresolved* (Q12k) |
| Money | A classification creates no amount, operation, settlement line, revenue or liability |

## Manual review and legal escalation (Q12a decision): proposed concepts, not implemented

The founder's Q12a decision is a commercial and operational direction (`settlement-policy-review.md` section 13). No
SQL exists for it, no reviewer is appointed and no counsel is engaged. The Phase B `transaction_admins` (named admins
who sign in with multi-factor authentication for payment events) are **not** established as the feasibility reviewer;
the appointment and access-control model is *unresolved* (Q12h).

| Concept | Notes |
|---|---|
| Manual-review record | Reviewer identity or role, timestamp, classification or outcome, reasoning, evidence references, missing information, legal escalation, later reassessment. Separate from the traveller's assessment, which it never overwrites |
| Operational determination | Within approved operational authority only; never a declaration that a legally uncertain route is lawful |
| Legal escalation | The outstanding legal verification is recorded and the order stays pending; who decides to escalate is *unresolved* (Q12i) |
| Insufficient evidence | The order stays pending; no automatic rejection or cancellation |
| Outcome and acceptance | A review outcome never accepts an order by itself; every gate must still be satisfied (register 11.2) |
| Money | No review record or escalation creates an amount, operation, settlement line, revenue or liability; who bears legal-advice cost is *unresolved* (Q12j) |

## Account deletion and retention (P1-5): design, not implemented

**Today:** orders reference profiles with `on delete restrict`, so deleting an account with orders fails. That's
deliberate until this design is approved.

**Proposal:**
1. **Deletion request:**
   - mark the profile for deletion;
   - remove name, phone, email and other personal data from `profiles` and `auth.users`, through Supabase's own
     deletion flow, adapted;
   - keep the profile id as a **pseudonymous key** so financial records stay consistent.
2. **Financial records** (orders, events, operations, anomalies): kept for the legally required period. They then
   become pseudonymous: no name, contact details or address.
3. **Evidence files:** kept only while needed (open disputes, chargeback windows, legal holds). After that they're
   deleted from the bucket. The event keeps the path, which no longer resolves.
4. **Legal hold:** a per-order flag that stops evidence deletion and anonymisation while a dispute, chargeback or
   inquiry is open.
5. **Access after deletion:** only finance and review roles, never the other party.

**Retention periods that need qualified Indian legal advice (none set here):**
- tax and GST records;
- payment-provider and RBI record-keeping;
- consumer-dispute limitation periods;
- the erasure exemptions under the Digital Personal Data Protection Act;
- anti-money-laundering rules, if they apply;
- chargeback windows (provider terms).

## Financial invariants

| Invariant | Enforced by |
|---|---|
| No duplicate or simultaneous refund-and-payout | Partial unique indexes, tested with direct inserts and two real connections |
| No second charge while an attempt is open | `transaction_operations_one_live_payment` plus the `payment_attempt_open` guard (real-Postgres scenario 10) |
| No payout during a dispute or after a chargeback | Rules and function |
| No state change without its event | Commit-time check |
| Snapshot immutable | Stage 5a trigger |
| Provider events applied once, to one order | Unique keys; conflicts recorded as anomalies |
| Late answers can't settle the wrong attempt | Key match |
| Amount and currency must match | Function |
| No direct writes by any app role | Grants |
| **Payout amount correct** | **NOT ENFORCED: P0** |

## Concurrency

The real-Postgres script (PostgreSQL 17.11, socket only, verified isolated before loading) runs **19 scenarios** with
independent connections. It passed **19/19 in three consecutive runs**, after the commit-time-check fix. Across
those runs: 16 races with two distinct backends, and 13 where the loser was observed waiting on the row lock.

**The scenarios:**
- the 17 from before;
- **9:** a capture racing the buyer's cancellation: always recorded, one successful payment;
- **10:** a retry racing a late capture: the retry is always refused, so the buyer is never charged twice.

Every run's global checks: no duplicate successes, no refund beside a payout, no state change without its event.

**NOT VERIFIED:** Supabase's pooler, Supabase's Postgres version, sustained load.

## Supabase assumptions to verify before any migration

- **Roles and ownership:**
  - `postgres` owns the tables and functions and can create roles (`create role … nologin`);
  - no table forces row security.
- **Auth:**
  - `auth.uid()`;
  - `auth.jwt()` with an `aal` claim (multi-factor enabled for admins).
- **Storage:** `storage.buckets` and `storage.objects` (with `owner_id`), `storage.foldername()`, and policies on
  `storage.objects` allowed in migrations.
- **API exposure:** `private` isn't exposed.
- **Server behaviour:**
  - the migration runs in one transaction;
  - the Postgres version;
  - role statement timeouts;
  - pooler behaviour with `set_config(…, true)` and deferred triggers;
  - production has migrations 10–12, which it currently lacks.

## Before applying this anywhere

1. **P0 resolved:** the open decisions in `settlement-policy-review.md` section 6, then the settlement
   implementation, then a re-test.
2. **Decisions on:** the five stricter rules, the P1-4 design and the P1-5 design.
3. **Backups and approval:** a full dev backup, including `private` and `storage`, and separate written approval to
   apply to dev. Production also needs migrations 10–12 first.
4. **Real money stays off until:** the provider contract, the compliance checklist, and a reviewed adapter.
