# Orbitly — Marketplace Backend Plan

Status: **proposal for review.**
- **Stage 1 (`requests_marketplace_fields`) was applied to dev only** on 2026-10-28 as version `20261028072345` (local file `supabase/migrations/20261028072345_requests_marketplace_fields.sql`). It was verified with the post-apply probe.
- **Stage 2 (`offers_cost_breakdown`) was applied to dev only** on 2026-10-28 as version `20261028105912` (local file `supabase/migrations/20261028105912_offers_cost_breakdown.sql`, byte-identical to what ran: md5 `aa17dcb1…`). The post-apply probe said `applied`; outside `offers` the protected-state snapshot was unchanged.
- Nothing else has been applied. No other policy, grant, bucket or setting has changed.
- Every other SQL block below is a draft.

Written 2026-10-28 from the local migrations plus read-only queries against the **dev** project
`orbitly` (`zzyafhtpcuuwlrqewpcn`). The production project was not inspected.

---

## 1. Current state (what is really there today)

### Database (dev), checked live

| Table | Rows | Columns | Who can do what |
|---|---|---|---|
| `profiles` | 3 | `id`, `full_name`, `created_at` | Signed-in users read all; edit own `full_name` only. Created by the `handle_new_user` trigger. |
| `requests` | **0** | `id`, `shopper_id`, `title`, `product_url` (https only), `price_inr` (required), `quantity` 1–10, `delivery_city`, `reward_inr` (required), `status` (`open/matched/completed/cancelled`), `created_at` | Signed-in users read **all** rows. Phone-verified users insert their own (6 columns granted). **No update or delete for anyone.** |
| `offers` | **0** | `id`, `request_id`, `traveller_id`, `reward_inr`, `message`, `status` (`pending/accepted/rejected/withdrawn`), `created_at`; unique (`request_id`, `traveller_id`) | Visible to the traveller and the request owner. Phone-verified users insert on someone else's `open` request. **No update or delete.** |

- **Migrations:**
  - the 5 remote migrations match the local files;
  - `create_profiles` keeps its known version mismatch (local `…070000`, remote `…073833`), which you chose to leave as is.
- **Functions:**
  - `is_phone_verified()` (security definer; reads `auth.users.phone_confirmed_at`);
  - `handle_new_user()` (trigger only);
  - `dev_discard_sms` (dev-only SMS hook).
- **Storage:** **no buckets and no storage policies.**
- **Extensions:** `pgcrypto` is installed. `pg_cron`, `pg_net` and `moddatetime` are available but **not** enabled.
- **Advisors:**
  - security: `is_phone_verified` is callable by signed-in users, which is intended (it only answers for the caller);
  - security: **leaked-password protection is off**, a dashboard setting;
  - performance: one unused index on an empty table, which can be ignored.

### App
- **No app code reads or writes `requests` or `offers`.** There are no generated database types (no `database.types.ts`).
- The request flow is a **front-end prototype**:
  - the draft lives in `sessionStorage`;
  - confirmed requests go to `localStorage` (`src/lib/request-draft.ts`);
  - "practice offers" exist only in React state, and Accept is disabled.
- **Draft fields the database can't hold yet:**
  - description, item type, attributes, condition;
  - budget amount and currency, preferred country/store, needed-by date, notes;
  - photo, preview image.
- **Offer fields the database can't hold yet:**
  - product price and currency, separate fee, arrival date, handoff method.
- Photos are resized on the device to JPEG (at most 1200 px, quality 0.82, usually 100–300 KB) and kept as data URLs.

### What this means
1. **Both marketplace tables are empty on dev**, so changing them now carries almost no data risk.
   We still write every change as additive and non-destructive, because production may differ.
2. **The current `requests` read policy (`using (true)`) is fine only while there are no drafts.**
   It must change **in the same step** that introduces a `draft` status (see §7, stage 3).
3. **The current schema has no way to edit, withdraw, accept or fulfil anything.** All of that is new work.

---

## 2. Proposed tables and fields

Guiding rule: **structured columns** for anything we filter, sort, validate or calculate with.
**JSON** only for the item-specific details (brand, size, model…), which vary by item and are only displayed.

### 2.1 `requests` (extend the existing table)

| Column | Type | Rule | Why |
|---|---|---|---|
| `id`, `shopper_id`, `created_at` | existing | unchanged | `shopper_id` defaults to `auth.uid()` and is never granted, so nobody can post as someone else |
| `title` | existing | 3–200 chars | |
| `description` | text | ≤ 2000 | |
| `product_url` | existing | ≤ 2000, `https://` only today | see decision D6 (allow `http://`?) |
| `item_kind` | text | one of `electronics, fashion, home, collectible, other`; default `other` | filterable; mirrors `ITEM_KINDS` |
| `attributes` | jsonb | must be an object, ≤ 2 KB; keys/values checked by the server action | brand / model / size / colour…: varies by item |
| `item_condition` | text | `new`, `used_good`, `any`; default `any` | not every item is new |
| `quantity` | existing | 1–10 | |
| `listed_price_amount` + `listed_price_currency` | numeric(12,2) + text | both or neither; currency from the app's list | "what the store/listing shows", optional (photos and descriptions often have none) |
| `budget_amount` + `budget_currency` | numeric(12,2) + text | both or neither | the most the buyer will pay for the item, optional |
| `origin_preference` | text | ≤ 120 | "Japan" or "any official store" |
| `delivery_city` | existing | 2–100 | Indian destination city |
| `needed_by` | date | optional | |
| `notes` | text | ≤ 1000 | |
| `preview_image_url` | text | `http(s)://`, ≤ 2000 | image URL found by the link preview (a hotlink, not stored by us; see D7) |
| `image_path` | text | ≤ 300; must sit in the owner's folder for this request (checked by policy) | key of the buyer's own photo in Storage, not the image itself |
| `status` | existing | adds `draft`, `expired` | see §4 |
| `published_at`, `expires_at` | timestamptz | required once not a draft | |
| `updated_at` | timestamptz | trigger-maintained | |
| `price_inr`, `reward_inr` | existing | **made optional, then deprecated** | old prototype fields; `reward_inr` was a buyer-set fee, which now belongs on the offer. Kept, not dropped, until you approve a cleanup (D9). |

**Trade-off on attributes:** JSON keeps the schema small and supports any item, from a phone to a vintage grinder.
The cost is that the database can't search or validate individual keys.
If we later want "filter by brand", we promote `brand` to a column. That's an easy additive change.

**Trade-off on money:**
- buyers think in many currencies, so the listed price and budget keep their own currency;
- **offers are settled in INR** (below), so comparisons are always like-for-like.

### 2.2 `offers` (extend the existing table)

Superseded by the detailed Stage 2 design in §7 ("Stage 2: offers with a transparent cost breakdown").
In short:
- **Each offer has:**
  - the product's foreign price, currency and the traveller's own exchange rate;
  - whether the product price is fixed in rupees;
  - a separate fee, delivery cost and other costs (other costs need an explanation);
  - an optional customs **estimate**;
  - the arrival date, handoff method and a lawful-import declaration.
- **Two totals are generated by the database:**
  - an **agreed total** (what the traveller commits to);
  - an **estimated total** (everything, including estimates).
- `version` and `updated_at` move to stage 4, when offers become editable.

### 2.3 Audit trail: `request_events` (new, small)

| Column | Notes |
|---|---|
| `id` bigint identity, `request_id`, `offer_id` (nullable), `actor_id`, `event` text, `created_at` | Written **only** by the transition functions in §4. Readable by the request owner and the traveller named in the event. No client insert, update or delete. |

This is what we'd need to settle a dispute ("who accepted what, when").

### 2.4 Images
- **One photo per request for now** (`requests.image_path`), stored in a private Storage bucket (§6).
- A separate `request_images` table is the upgrade path if we allow several photos or need moderation status per image. It isn't needed for the MVP.

---

## 3. Relationships and constraints

```
auth.users 1─1 profiles 1─* requests 1─* offers
                      └──────────────────────* offers (as traveller)
requests 1─* request_events *─1 offers (optional)
requests.image_path → storage.objects.name in bucket request-images
```

- **Existing cascades (`on delete cascade` from profiles):** deleting an account deletes that user's requests and offers. After an accepted deal, that also deletes the other party's record (decision D10).
- **One active offer per traveller per request:** partial unique index on (`request_id`, `traveller_id`) where status is `pending` or `accepted`.
  - It replaces today's plain unique constraint, so a traveller who withdrew can offer again.
- **At most one accepted offer per request:** partial unique index on (`request_id`) where status is `accepted`.
  - This is the database-level guarantee behind §4's concurrency rule.
- **New-offer completeness:** a `not valid` check requiring `product_cost_inr`, `arrival_date` and `handoff_method`.
  - It applies to every new or edited row and leaves legacy rows untouched (there are none on dev).
- **Published requests:** `status = 'draft' or (published_at and expires_at are set)`.
- **Indexes:**
  - open requests by newest (`created_at desc where status = 'open'`);
  - `offers(request_id)`;
  - `request_events(request_id)`.

---

## 4. Lifecycle and transition rules

### Request states

| Your term | Stored `status` | Notes |
|---|---|---|
| Draft | `draft` | Visible to the owner only. Created when the buyer presses Publish (so a photo can be uploaded against it). |
| Published | `open` | Visible to signed-in users until `expires_at`. |
| Receiving offers | `open` + at least one pending offer | **Derived, not stored**, so it can never drift out of sync. |
| Offer accepted | `matched` | existing value, kept to avoid a rename |
| Fulfilled | `completed` | existing value |
| Cancelled | `cancelled` | |
| Expired | `expired` | Also treated as expired as soon as `expires_at` passes, even before a job flips the status. |

```
draft ──publish──▶ open ──accept_offer──▶ matched ──mark_fulfilled──▶ completed
  │                 │  ╲                     │
  │ delete          │   ╲ expires_at passes  │ cancel (D3: allowed? with reason)
  ▼                 ▼    ▼                   ▼
(gone)          cancelled  expired        cancelled
```

Only the database functions below change `status`. **No client is ever granted the `status` column.**

| Function (security definer, `search_path = ''`, signed-in callers only) | Who | Allowed from → to | Also does |
|---|---|---|---|
| `publish_request(id)` | owner, phone-verified | `draft → open` | sets `published_at`, `expires_at` (D4); checks any `image_path` really exists in the owner's folder |
| `cancel_request(id)` | owner | `draft/open → cancelled` (and `matched` if D3 allows) | pending offers → `closed`; logs event |
| `accept_offer(offer_id, expected_version)` | request owner | request `open` and not past `expires_at`; offer `pending` with matching `version` | offer → `accepted`, other pending offers → `closed`, request → `matched`; logs event |
| `withdraw_offer(offer_id)` | the traveller | `pending → withdrawn` (and `accepted` → `withdrawn` per D3, which reopens the request) | logs event |
| `mark_fulfilled(id)` | owner | `matched → completed` | logs event |
| `expire_requests()` | **server job only** (not granted to users) | `open` past `expires_at` → `expired` | pending offers → `closed` |

### The situations you asked about
- **Buyer edits a request:**
  - drafts can be edited freely;
  - an `open` request can be edited **only while it has no pending offers** (enforced in the update policy);
  - once offers exist, travellers priced what they saw, so the buyer cancels and reposts. This is simpler and fairer than silently invalidating offers (alternative in D2).
- **Buyer withdraws a request:** `cancel_request`. Travellers' pending offers become `closed` ("no longer available"), not "rejected".
- **Traveller changes an offer:** allowed while `pending`, by direct update of the granted cost, date and method columns. Each edit bumps `version`.
- **Traveller withdraws an offer:** `withdraw_offer`, then they may offer again later.
- **Two acceptances at the same time** (two tabs, or a traveller editing mid-accept):
  - `accept_offer` locks the request row (`select … for update`) and then the offer row, so concurrent calls run one after another;
  - the second call finds the request already `matched` and fails cleanly;
  - if the traveller edited the offer after the buyer loaded it, `version` no longer matches and acceptance fails with "this offer changed, please review it again";
  - the partial unique index is a final backstop even if the function had a bug.
- **Request expires or becomes unavailable:**
  - new offers and acceptance are refused once `expires_at` passes, checked in the policy and the function at the moment of the call;
  - a scheduled job later tidies up the stored statuses.
- **Acting on someone else's request or offer:**
  - row-level policies hide rows that aren't yours to change;
  - every function re-checks `auth.uid()` against the owner or traveller;
  - such calls fail with a generic "not found or not allowed", so they reveal nothing about other users' rows.

### Where each guarantee lives
| Needs | How |
|---|---|
| Transactions and row locks | `accept_offer`, `cancel_request`, `withdraw_offer` (accepted case), `expire_requests` |
| Constraints | status values, money ranges, generated total, the two partial unique indexes, published-dates check |
| Server-side authorization | every function checks the caller; every policy uses `(select auth.uid())`; **the service-role key is never used for user actions**. It is used only by the expiry and cleanup jobs, which run on the server. |

---

## 5. Security and access matrix

"Buyer" and "traveller" are the same kind of account. The role depends on which side of a row you're on.
Phone verification (`is_phone_verified()`) is required to **create** anything, as it is today.

| Table / action | Anonymous | Signed-in (any) | Request owner | Traveller with an offer | Server jobs (service role) |
|---|---|---|---|---|---|
| **requests** read | ✗ (D1) | `open` and not expired | own, any status | requests they offered on, any status | all |
| requests insert | ✗ | ✗ unless phone-verified; always as `draft`, always as self | — | — | — |
| requests update (content columns only) | ✗ | ✗ | `draft`, or `open` with no pending offers | ✗ | — |
| requests delete | ✗ | ✗ | `draft` only | ✗ | cleanup of old drafts |
| requests status | ✗ | ✗ | via functions only | ✗ | `expire_requests` |
| **offers** read | ✗ | ✗ | all offers on own requests | own offers | all |
| offers insert | ✗ | phone-verified, on others' open, unexpired requests, always as self, always `pending` | ✗ on own request | — | — |
| offers update (cost, date, method, message) | ✗ | ✗ | ✗ | own, while `pending` | — |
| offers status | ✗ | ✗ | `accept_offer` | `withdraw_offer` | `expire_requests` |
| **request_events** read | ✗ | ✗ | own requests | events naming them | all |
| request_events write | ✗ | ✗ | via functions only | via functions only | — |
| **profiles** read | ✗ | all (`full_name` only) — D8 | | | |
| **Storage `request-images`** | ✗ | read photo of any request they can read (via short-lived signed URL) | upload/delete in `{own id}/{own request id}/` while `draft`/`open` | read | orphan cleanup |

### Specific protections
- **No impersonation:** owner and traveller IDs default to `auth.uid()` and are never in a column grant. Insert policies also check them.
- **Protected fields can't be changed by clients:** `status`, `shopper_id`, `traveller_id`, `version`, `total_inr`, `published_at`, `expires_at`, timestamps.
  - Column-level grants list only the editable columns.
  - The table-level `revoke all` already in place stays.
- **Policy recursion trap:** the requests read policy needs "has this user offered here?" and the offers read policy needs "does this user own the request?".
  - Two policies that query each other's tables loop forever.
  - One direction must use a small security-definer helper (`public.has_offered_on(request_id)`), which this plan includes.
- **User-submitted text:**
  - stored as plain text with length limits;
  - rendered only as React text (never `dangerouslySetInnerHTML`);
  - URLs restricted to `http(s)` and opened with `rel="noopener noreferrer nofollow ugc"`;
  - attributes are a size-capped object whose keys the server action checks against an allow-list.
- **Image metadata:**
  - the app re-encodes photos on the device, which strips EXIF data such as GPS location, but a modified client could skip that;
  - server-side re-encoding is listed as a launch item (§9).
- **Privacy in notes:** buyers may type phone numbers or addresses into free text. The UI should warn before publishing, and moderation (§9) handles abuse.

---

## 6. Image storage and upload plan

- **Bucket:** `request-images`, **private**, `file_size_limit` 2 MB, allowed types `image/jpeg`, `image/png`, `image/webp`. Storage enforces these, not just the client.
- **Path:** `{user_id}/{request_id}/{random uuid}.jpg`. The folder names carry ownership, so policies can check them without a lookup table.
- **Flow:**
  1. On Publish, the server action inserts the request as `draft`.
  2. The browser uploads the already-resized JPEG straight to Storage with the user's own session (no server proxy, no service key).
  3. The server action sets `image_path` and calls `publish_request`, which checks that the object exists.
  4. If the upload fails, the draft stays and the buyer can retry or publish without a photo. Nothing is shown to travellers until step 3 succeeds.
- **Storage policies (on `storage.objects`):**
  - insert/delete only in your own folder, for your own request, in status `draft`/`open`;
  - read when the request is readable to you;
  - no update (no overwriting in place).
- **Viewing:** short-lived signed URLs (e.g. 1 hour) created with the viewer's session, so a private image never becomes a permanent public link.
- **Abandoned uploads and deletion:**
  - a daily server job (a protected route using the service key, server-side only) removes:
    - objects whose request is gone or whose path isn't the request's current `image_path` (after 24 h);
    - drafts older than 7 days, with their images.
  - Deletion uses the **Storage API**, not SQL `delete from storage.objects`, which would leave the files behind.
- **Cost:** about 150–300 KB per photo, so roughly 3,000–6,000 photos per GB. Supabase Free includes 1 GB of storage.

---

## 7. Migration sequence (each one shown to you and approved separately; dev first)

Each stage leaves the app working, because the app doesn't use these tables yet.

| # | Migration | Changes | New client abilities? |
|---|---|---|---|
| 1 ✅ dev | `requests_marketplace_fields` | add request columns, make `price_inr`/`reward_inr` optional, extend status values, `updated_at` trigger, index | **None** (no new grants or policies) |
| 2 ✅ dev (`20261028105912`) | `offers_cost_breakdown` | offer cost columns, rename `reward_inr → service_fee_inr`, two generated totals, `closed` status, one-accepted-offer index, tighter insert rule, insert grants for the new columns | **Yes, narrowly**: travellers can fill in the breakdown when they make an offer. Details below. |
| 3a 📝 draft / not applied | `requests_drafts_and_publish` | buyer side of stage 3: default `draft`, private drafts, owner edit/delete of drafts, `publish_request()`, form-field grants | **Yes**: see `docs/buyer-request-flow-plan.md` §3a |
| 3 (rest) | `marketplace_policies` | default status `draft`; backfill `published_at`/`expires_at` on any legacy non-draft rows (created_at and +30 days), then add the published-dates check; new read/insert/update/delete policies, column grants, `has_offered_on` helper | **Yes**: the security step, reviewed most carefully |
| 4 | `marketplace_transitions` | `request_events` table + the six functions in §4 | **Yes** |
| 5 | `request_images_storage` | private bucket + storage policies | **Yes** |
| 6 | (app) | generate types, server actions, replace device-only saving | — |
| 7 | `request_expiry_job` | scheduled expiry + orphan cleanup (needs `pg_cron` or a Vercel cron, D11) | server only |

### Draft SQL for stage 1 (for review only, not applied)

```sql
-- M1: richer buyer requests. Schema only: no new grants or policies, so clients can't write the new
-- columns. They are readable by signed-in users (existing table-wide SELECT) but stay empty until stage 3.
alter table public.requests
  add column description text check (char_length(description) <= 2000),
  add column item_kind text not null default 'other'
    check (item_kind in ('electronics', 'fashion', 'home', 'collectible', 'other')),
  add column attributes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(attributes) = 'object' and pg_column_size(attributes) <= 2048),
  add column item_condition text not null default 'any'
    check (item_condition in ('new', 'used_good', 'any')),
  add column listed_price_amount numeric(12, 2) check (listed_price_amount > 0 and listed_price_amount < 100000000),
  add column listed_price_currency text check (listed_price_currency in ('INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY', 'SGD')),
  add column budget_amount numeric(12, 2) check (budget_amount > 0 and budget_amount < 100000000),
  add column budget_currency text check (budget_currency in ('INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY', 'SGD')),
  add column origin_preference text check (char_length(origin_preference) <= 120),
  add column needed_by date,
  add column notes text check (char_length(notes) <= 1000),
  add column preview_image_url text
    check (preview_image_url is null or (char_length(preview_image_url) <= 2000 and preview_image_url ~* '^https?://')),
  add column image_path text check (char_length(image_path) <= 300),
  add column published_at timestamptz,
  add column expires_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add constraint requests_listed_price_pair check ((listed_price_amount is null) = (listed_price_currency is null)),
  add constraint requests_budget_pair check ((budget_amount is null) = (budget_currency is null));

-- Old prototype fields become optional. Kept (not dropped) until a separate cleanup is approved.
alter table public.requests alter column price_inr drop not null, alter column reward_inr drop not null;
comment on column public.requests.price_inr is 'Deprecated: replaced by budget_amount/budget_currency.';
comment on column public.requests.reward_inr is 'Deprecated: travellers set their fee on each offer.';

-- Add 'draft' and 'expired'. The default stays 'open' until stage 3 changes the read policy,
-- so a draft can never be visible to other users under today's "everyone can read" policy.
-- One statement, so there is never a moment without a status check.
alter table public.requests
  drop constraint requests_status_check,
  add constraint requests_status_check
    check (status in ('draft', 'open', 'matched', 'completed', 'cancelled', 'expired'));

-- Note: the "published rows must have dates" rule is NOT added here. While the default is still
-- 'open', it would reject every insert the current policy allows (caught in a local dry run).
-- It moves to stage 3, together with the 'draft' default and publish_request().

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger requests_set_updated_at
  before update on public.requests
  for each row execute function public.set_updated_at();

create index requests_open_created_idx on public.requests (created_at desc) where status = 'open';
```

**Local dry run (2026-10-28, in-memory Postgres, not Supabase):**
- this SQL applies cleanly on top of the five existing migrations, including with a legacy row present;
- insert, update and delete rights for `anon`/`authenticated` are unchanged;
- a phone-verified user can still insert through today's policy, now without `price_inr`/`reward_inr`;
- writing a new column is refused with "permission denied".

**One visible effect:** `authenticated` already holds table-wide SELECT on `requests`, so the new columns are
**readable** by signed-in users under today's "read all" policy. They're empty until stage 3 changes
that policy, so nothing is exposed.

### Stage 1: how it gets applied, and recovery if it fails

**What is known about atomicity (checked 2026-10-28):**
- The Supabase MCP tool `apply_migration` sends the whole file in **one** request to the Management API (`POST /v1/projects/{ref}/database/migrations`, body `{name, query}`). It adds no BEGIN/COMMIT of its own ([source](https://github.com/supabase-community/supabase-mcp/blob/main/packages/mcp-server-supabase/src/platform/api-platform.ts)).
- **Supabase's API reference for that endpoint says nothing about transactions, rollback on failure, or when the history row is written** ([reference](https://supabase.com/docs/reference/api/v1-apply-a-migration)).
- Plain Postgres runs a multi-statement string sent in one request as a single transaction, and the local dry run shows that. Whether Supabase's server sends it that way is **not verified**.

So we don't rely on atomicity. The procedure is safe either way:
- **Every partial state is harmless:** no stage 1 statement grants anything, so a half-applied state gives clients no new abilities;
- the status-check swap is one statement, so the status rule never disappears;
- the table is empty, so recovery can't lose data.

**Procedure (dev project `zzyafhtpcuuwlrqewpcn` only):**
1. **Pre-flight (read-only):** run the probe below. Expected: `not applied`, `rows = 0`, project ref confirmed with `list_projects`.
2. **Apply** with `apply_migration`, name `requests_marketplace_fields`, using the SQL above, unchanged.
3. **Post-check (read-only):** run the probe again.
   - `applied` → run the validation queries and both advisors, then save the local file under the recorded version.
   - `not applied` → the failure rolled back cleanly. Read the error, fix, and ask again before retrying.
   - `PARTIAL` → stop, and **ask before running recovery**, because recovery is a remote write.
4. **Recovery (only for `PARTIAL`, only after approval):**
   - run the recovery SQL below once through `execute_sql`, not as a migration, so it doesn't add a history row;
   - re-run the probe, and expect `not applied`;
   - if a history row for the failed attempt exists, removing it is a separate approval.

**Probe (read-only):**
```sql
with s as (
  select
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'requests'
       and column_name in ('description', 'item_kind', 'attributes', 'item_condition', 'listed_price_amount',
         'listed_price_currency', 'budget_amount', 'budget_currency', 'origin_preference', 'needed_by', 'notes',
         'preview_image_url', 'image_path', 'published_at', 'expires_at', 'updated_at')) as new_columns,
    (select count(*) from pg_constraint where conrelid = 'public.requests'::regclass
       and conname in ('requests_listed_price_pair', 'requests_budget_pair')) as pair_checks,
    (select count(*) from pg_constraint where conrelid = 'public.requests'::regclass
       and conname = 'requests_status_check' and pg_get_constraintdef(oid) like '%draft%') as new_status_check,
    (select count(*) from pg_constraint where conrelid = 'public.requests'::regclass and conname = 'requests_status_check') as any_status_check,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'requests'
       and column_name in ('price_inr', 'reward_inr') and is_nullable = 'YES') as legacy_optional,
    (select count(*) from pg_proc where proname = 'set_updated_at' and pronamespace = 'public'::regnamespace) as fn,
    (select count(*) from pg_trigger where tgname = 'requests_set_updated_at') as trg,
    (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'requests_open_created_idx') as idx,
    (select count(*) from supabase_migrations.schema_migrations where name = 'requests_marketplace_fields') as history,
    (select count(*) from public.requests) as rows
)
select *, case
  when new_columns = 16 and pair_checks = 2 and new_status_check = 1 and legacy_optional = 2 and fn = 1 and trg = 1 and idx = 1 then 'applied'
  when new_columns = 0 and pair_checks = 0 and new_status_check = 0 and any_status_check = 1 and legacy_optional = 0 and fn = 0 and trg = 0 and idx = 0 then 'not applied'
  else 'PARTIAL' end as state
from s;
```

**Recovery (returns the table to exactly its current shape; refuses to run if any request rows exist):**
```sql
do $$
begin
  if exists (select 1 from public.requests) then
    raise exception 'public.requests has rows; stop and review by hand before any recovery';
  end if;
end $$;
drop index if exists public.requests_open_created_idx;
drop trigger if exists requests_set_updated_at on public.requests;
drop function if exists public.set_updated_at();
alter table public.requests
  drop constraint if exists requests_status_check,
  add constraint requests_status_check check (status in ('open', 'matched', 'completed', 'cancelled'));
comment on column public.requests.price_inr is null;
comment on column public.requests.reward_inr is null;
alter table public.requests alter column price_inr set not null, alter column reward_inr set not null;
alter table public.requests
  drop constraint if exists requests_listed_price_pair,
  drop constraint if exists requests_budget_pair,
  drop column if exists description, drop column if exists item_kind, drop column if exists attributes,
  drop column if exists item_condition, drop column if exists listed_price_amount,
  drop column if exists listed_price_currency, drop column if exists budget_amount,
  drop column if exists budget_currency, drop column if exists origin_preference, drop column if exists needed_by,
  drop column if exists notes, drop column if exists preview_image_url, drop column if exists image_path,
  drop column if exists published_at, drop column if exists expires_at, drop column if exists updated_at;
```
- **Tested locally:** for every possible stopping point in stage 1 (each statement prefix), the probe reports correctly, and recovery restores the original columns, constraints, functions, triggers and indexes exactly.
- **Not tested:** recovery has not been run on Supabase.
- This is also stage 1's rollback while the table is empty. Once real rows exist, rollback follows the general rule in "Rollback" below (revoke access, keep the columns).

### `preview_image_url`: untrusted input (rules for the frontend stage, not part of stage 1)

The value comes from a third-party page's `og:image`, which the page owner fully controls. Stage 1's database check only enforces `http(s)://` and ≤ 2000 characters. The app must do the rest.

**On write (server action, before insert or update):**
- Accept it only from Orbitly's own link-preview result. Never take an image URL typed or edited by the client.
- Re-parse it with `new URL()`:
  - **https only**; http images would be blocked or upgraded as mixed content anyway;
  - no username or password;
  - no whitespace or control characters;
  - ≤ 2000 characters;
  - default port only.
- Reject IP-literal hosts and internal names, using the same `isPrivateAddress` / internal-host rules as the link preview. Otherwise every viewer's browser could be made to request their own router or `localhost`.
  - We can't re-resolve DNS at view time, so a public name that points somewhere private stays a residual risk. The real fix is proxying (D7).
- Store it in `preview_image_url` only. **Never** in `image_path`, which only ever holds a path our own upload flow created.
- Today's draft keeps both kinds in one `image` field; the row mapper must split them: `data:` URL → upload → `image_path`; `https:` URL → `preview_image_url`.

**On render:**
- Only as `<img src>`; never in CSS `url()`, `srcset` built from strings, `dangerouslySetInnerHTML`, or as a clickable link.
- Always `referrerPolicy="no-referrer"`, so the third party doesn't learn which Orbitly page was viewed. The review screen already does this.
- Also `loading="lazy"` and `decoding="async"`; no `crossOrigin`, so no credentials are sent.
- A fixed-size box with `object-contain`, so a huge or odd image can't break the layout.
- `onError` → a neutral placeholder; never retry or fetch it another way.
- Label it "Image from {host}", using the image's own host, so it's never presented as Orbitly's photo or as proof the item exists.
- Do **not** pass it through `next/image` optimisation. That would make our server fetch arbitrary URLs, which is the SSRF problem again, and `remotePatterns` can't safely allow every host.
- Later: a Content-Security-Policy `img-src 'self' data: blob: https:` and, if D7 changes, an image proxy that re-uses the link-preview safeguards.
- **Privacy:** a third-party image reveals the viewer's IP address to that site and can work as a tracking pixel. That's acceptable for the MVP only with D7's disclosure; proxying removes it.

### Stage 2: offers with a transparent cost breakdown (✅ APPLIED TO DEV as `20261028105912`)

**Files:**
- `supabase/migrations/20261028105912_offers_cost_breakdown.sql`: the applied migration (its header comment predates the apply; the file is kept byte-identical to the recorded SQL);
- `supabase/drafts/stage2_offers_cost_breakdown.probe.sql`: the read-only state probe;
- `supabase/drafts/stage2_offers_cost_breakdown.recovery.sql`: recovery, used only for `PARTIAL` and only with approval;
- `tests/db/offers-stage2.test.ts`: 65 local tests;
- `supabase/drafts/stage2_rls_test_update.patch`: the update to `tests/db/rls.test.ts`, now applied.

**Apply procedure (done 2026-10-28):**
- apply to dev with `apply_migration` (name `offers_cost_breakdown`), using the same probe → apply → probe procedure as stage 1;
- then move the draft into `supabase/migrations/` under the recorded version;
- and apply `supabase/drafts/stage2_rls_test_update.patch` (`patch -p1`), adding the recorded version to the migration-list test.

#### What was inspected first (live dev, read-only, 2026-10-28)
- `offers` matches the migration exactly: 0 rows, 7 columns, unique (`request_id`, `traveller_id`).
- Grants: signed-in users may read, and may insert only `request_id`, `reward_inr` and `message`.
- **Read rule:** an offer is visible to its traveller and to the request owner. This is correct and stays unchanged.
- **Insert rule:** you must be the traveller yourself, phone-verified, offering on someone else's `open` request.
  - **Gap 1:** it ignores `requests.expires_at`, the column stage 1 added.
  - **Gap 2:** nothing checks the arrival date.

#### Schema
| Column | Type | Rule | Estimate or confirmed? |
|---|---|---|---|
| `service_fee_inr` | integer (renamed from `reward_inr`) | 0 – ₹10 lakh | **Confirmed**: the traveller's own fee |
| `product_price_amount` + `product_currency` | numeric(12,2) + text | > 0, < 10 crore; currency from the app's list | What the traveller expects to pay at the store |
| `fx_rate_to_inr` | numeric(12,6) | > 0, ≤ 10,000; **must be 1 for INR** | The traveller's own assumed rate. Orbitly supplies no rate (D5). |
| `product_price_inr` | bigint, **generated** | `round(amount × rate)`, whole rupees, half away from zero; ₹1 – ₹1 crore | — |
| `product_price_fixed` | boolean, default false | — | true = traveller **commits** to that rupee price; false = **estimate** (store price or rate may change) |
| `customs_estimate_inr` | integer, nullable | 0 – ₹1 crore | **Always an estimate**: customs decides at arrival. NULL = "not estimated", included in **no** total. |
| `customs_note` | text | ≤ 300 | e.g. "should be within duty-free allowance" |
| `delivery_inr` | integer, default 0 | 0 – ₹10 lakh | **Confirmed** |
| `other_costs_inr` + `other_costs_note` | integer, default 0 + text | 0 – ₹10 lakh; **a note of 3+ characters is required if not 0** | **Confirmed** |
| `arrival_date` | date | required; not before today (UTC) | Planned date (an estimate by nature) |
| `handoff_method` | text | `meet_in_person`, `courier_in_india`, `pickup_point` | — |
| `declares_lawful_import` | boolean, default false | **must be true** | The traveller's own declaration, kept as a record |
| `agreed_total_inr` | bigint, **generated** | fee + delivery + other + (product price **only if fixed**) | **Confirmed amount** |
| `estimated_total_inr` | bigint, **generated** | product price + fee + delivery + other + customs estimate (if given) | **Estimate** |
| `status` | existing | adds `closed` (request no longer available; used from stage 4) | — |

- **"New offers must be complete":** the `offers_complete` check requires price, currency, rate, arrival date, handoff method and the declaration. It's added `NOT VALID`, so it applies to every new or changed row without re-checking older rows. There are none on dev.
- **Defaults are used only where they're semantically true:**
  - no delivery or other charge unless stated;
  - not fixed unless the traveller says so;
  - customs not estimated unless given;
  - the declaration is false until ticked.
- **Money safety:**
  - all rupee amounts are whole numbers;
  - the product conversion is calculated once, by the database;
  - totals are `bigint`, so they can't overflow;
  - clients can't write any generated column (Postgres refuses);
  - negative, zero or absurd values are rejected by checks.
- **Duplicate submissions:** the existing unique (`request_id`, `traveller_id`) rejects a double-click or retry. The app shows "You've already made an offer on this request". The plan's switch to a "one active offer" index waits until withdrawal exists (stage 4).
- **Buyer quantity:** the product price is for the **full requested quantity**. The UI must say so.

#### Permission changes, each with its reason
| Change | Why it's needed |
|---|---|
| `reward_inr` renamed to `service_fee_inr` (its existing insert grant moves with it) | Same meaning, clearer name. No data or permission change. |
| **New insert grants** for the 12 breakdown columns | Without them a traveller can't submit a breakdown at all. Still **not** granted: `id`, `traveller_id`, `status`, `created_at`, the 3 generated amounts. |
| **Insert rule tightened** (same policy, `ALTER POLICY`): adds `arrival_date >= current_date` and "request not past `expires_at`" | Closes the two gaps found above. This only ever **narrows** who can insert. |
| Read rule, request policies, profile policies, table-level grants | **Unchanged.** A test compares every grant and policy before and after. |
| No update or delete grant | Offers stay **unchangeable by users** in stage 2. Nobody can edit, withdraw or alter another traveller's offer, and accepted terms can't drift. |

Phone verification stays enforced by the database through `is_phone_verified()`, which reads Supabase Auth's own `phone_confirmed_at`. The browser can't fake it.

#### Functions and triggers
**None are needed.** The maths is in generated columns, and the rules are in checks and the policy. The one new index, `offers_one_accepted_per_request` (unique on `request_id` where `status = 'accepted'`), is a backstop for stage 4. Nothing in stage 2 can set `accepted`.

#### What stage 2 enables / does not enable
- **Enables:**
  - phone-verified travellers can submit a complete, priced offer on someone else's open, unexpired request;
  - buyers can read every offer on their own requests, with both totals.
- **Does not enable:**
  - editing, withdrawing, accepting, rejecting or closing offers;
  - any status change;
  - publishing or drafting requests (stage 3);
  - photos (stage 5);
  - payments of any kind;
  - notifications.
- **Nothing in the app uses it yet;** the practice-offer UI stays as is until the frontend stage.

#### How buyers will compare offers, and how conflicting acceptance is prevented (stage 4, not built now)
- **Comparison:**
  - sort by `estimated_total_inr`, and always show `agreed_total_inr` next to it;
  - show the parts that are estimates (product price if not fixed, customs estimate, or "customs not estimated"), the traveller's exchange rate, and the arrival date against the buyer's needed-by date.
  - The "Lowest total" badge uses the estimated total and says so.
- **Acceptance:** stage 4's `accept_offer(offer_id, expected_version)` will:
  - lock the request row;
  - check that the request is open and unexpired, the caller owns it, and the offer is still pending at the version shown;
  - then accept it and close the others in one transaction.
- **Backstops:** the one-accepted-offer index (added now) guarantees a second acceptance can never succeed. Stage 4 also adds `version` and `updated_at`, and a trigger that freezes the cost columns once an offer is no longer `pending`.

#### Considerations kept explicit (not solved by stage 2)
- **Customs:**
  - estimates only; the UI must say "customs decides at arrival";
  - the declaration records that the traveller says the item is legal to bring in. It is **not** a compliance check;
  - prohibited-items list and legal review remain launch blockers (§9).
- **Disputes and refunds:** no money moves through Orbitly, so there's nothing to refund. The stored breakdown, declaration and (stage 4) event log are the record for disputes.
- **Privacy:** offers stay private between traveller and request owner. Free-text `message`, `customs_note` and `other_costs_note` must carry the same "no contact details" warning as request notes.
- **Payments:** none. An offer is not a payment commitment, and the UI must not present it as one (D14).

#### Rollback and recovery (does not assume Supabase rolls back a failed migration)
- **The draft is 11 statements, ordered so a partial apply is never less safe than today:**
  - the fee rename comes first;
  - every new column and check is added in **one** statement;
  - the insert rule is tightened next;
  - the new grants come **last**;
  - every prefix is fail-closed: until the grants exist, the completeness check stops anyone inserting an offer.
- **Procedure:** the same as stage 1:
  1. run the probe; it must say `not applied`, with 0 rows;
  2. apply;
  3. run the probe again: `applied` → validate; `not applied` → report the error and stop; `PARTIAL` → stop, and run **recovery only with your approval**, through `execute_sql`, not as a migration.
- **Recovery:**
  - refuses to run if any offer rows exist;
  - restores the exact original columns, constraints, index, insert rule, grants and comments.
- **Tested locally:** all 12 stopping points (0–11 statements) report correctly through the probe, recover to the exact original, then re-apply cleanly. A failure at the end of the file also leaves `not applied`.
- **Not tested:** recovery on Supabase itself.
- **After real offers exist:** rollback means revoking the new insert grants (instant), not dropping columns.

#### Final pre-apply review (2026-10-28, read-only)

**`reward_inr` references:**
- **Live dev:**
  - only `offers.reward_inr` itself and its own check constraint depend on it;
  - no function, policy, view, trigger, index or publication refers to it;
  - `requests.reward_inr` is a separate, deprecated column that stage 2 doesn't touch.
- **Repository:**
  - **no app code** (`src/`) refers to it;
  - the applied migrations refer to it historically and stay unchanged.
- **What breaks after the rename:**
  - 3 statements in `tests/db/rls.test.ts`, which break all 6 offer tests there;
  - the minimal offer they insert would also be refused by stage 2's completeness rule.
- **The fix is prepared**, not yet applied, as `supabase/drafts/stage2_rls_test_update.patch`.
  - In a temporary simulation of the post-stage-2 repository (draft placed in `migrations/` plus the patch), the whole suite passed (255/255), and both files were then restored byte-for-byte.
  - Without the patch, exactly those 6 tests and the migration-list test fail.
  - At apply time, add the recorded version to the migration-list test.

**Formulas:**
- **Tested against an independent exact-decimal calculation (BigInt):**
  - all 7 currencies × 7 amounts;
  - fixed and unfixed prices;
  - customs missing, 0 and given.
- **Rounding, half away from zero:**
  - ₹100.50 → ₹101 and ₹100.49 → ₹100;
  - ¥1 at 0.5 → ₹1 and ¥3 at 0.5 → ₹2;
  - €2 at 1.25 → ₹3.
- **Limits:** the ₹1 crore ceiling is accepted, ₹1 crore + 1 is rejected, and the largest possible offer (₹2.3 crore estimated) doesn't overflow.
- **Quantity:** totals don't change with the request's quantity, so the price covers the whole quantity.

**Buyer-facing wording** (rules for the frontend stage; every case can be told apart from stored fields):

| Stored | Item price line | Summary lines |
|---|---|---|
| `product_price_fixed = true` | "Item: ₹20,863 (fixed by the traveller)" | "Agreed total: ₹{agreed}" |
| `product_price_fixed = false` | "Item: about ₹20,863 (estimate: US$249.99 at the traveller's rate of ₹83.46, may change)" | "Traveller's agreed charges: ₹{agreed}", **never** "agreed total", because the item isn't included |
| `customs_estimate_inr` set (incl. 0) | "Customs: about ₹1,500 (estimate: customs decides at arrival)" | "Estimated total: ₹{estimated}" |
| `customs_estimate_inr` NULL | "Customs: not estimated (you may owe duty at arrival)" | "Estimated total (excluding customs): ₹{estimated}" |

- **Labels on every line:** "Fee", "Delivery" and "Other costs: {note}" are always shown as **agreed**.
- **Badges:** "Lowest total" compares estimated totals and says "estimated".

**Statement order:** the permissions available after each statement were tested in the local database:

| After statements | What users can do | Compared with today |
|---|---|---|
| 0 (today) | phone-verified traveller inserts a minimal offer | — |
| 1 (rename) | the same, with the new column name | same |
| 2–5 (columns and checks, constraint rename, index, tighter insert rule) | **no offer inserts at all** (completeness check exists, new columns not yet granted) | stricter |
| 6 (grants) | full, complete offers only | the intended stage 2 ability |
| 7–11 (comments) | same as 6 | — |

In every state:
- **Never possible:** offering unverified, offering on your own request, setting a status, editing or deleting offers, reading offers as a logged-out visitor, or reading other travellers' offers.
- **Always working:** owners and travellers still read their own offers.

#### Open decisions for stage 2
| # | Decision | Draft choice |
|---|---|---|
| S2-1 | Rename `reward_inr` to `service_fee_inr` now (0 rows) or keep the old name | Rename now |
| S2-2 | Is the product price per item or for the full quantity? | Full quantity |
| S2-3 | Keep the lawful-import declaration as a required database field | Yes |
| S2-4 | "Arrival not before today" uses the UTC date; Indian users near midnight may see one day's difference | Accept for MVP |
| S2-5 | Should arrival after the buyer's needed-by date be blocked, or only warned? | Warn in the UI, don't block |
| S2-6 | Currencies limited to the 7 in the app | Yes; add more by changing the check |

Stages 3–5 will be drafted in the same style once stage 2 is approved.

### Validation queries (read-only, run before and after each stage)
```sql
-- before: is there legacy data the migration must respect? (run on dev AND production)
select status, count(*) from public.requests group by 1;
select status, count(*) from public.offers group by 1;
-- after stage 1: columns, constraints and grants are as expected; no new grants appeared
select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'requests';
select grantee, privilege_type, column_name from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'requests' and grantee in ('anon', 'authenticated');
-- after stage 3: policies match §5, then run the Supabase security advisor
select policyname, cmd, roles, qual, with_check from pg_policies where tablename in ('requests', 'offers');
```

### Testing each stage
- Extend the in-memory Postgres tests (`tests/db/rls.test.ts`, PGlite) with every row of the access matrix:
  - each allowed action succeeds;
  - each forbidden one fails;
  - protected columns can't be written.
- Function tests:
  - accept twice;
  - accept a stale `version`;
  - accept after expiry;
  - act on someone else's row.
- PGlite has one connection, so **true concurrency** is tested only with an opt-in remote test on dev (`RUN_REMOTE_TESTS=1`), with your approval, as before.

### Rollback
- **Stages 1–2 add columns and loosen constraints.** Before real data exists, rollback is "drop the added columns, restore the old checks".
  - Once real data exists, dropping columns destroys it.
  - The safe rollback then is to **revoke the stage 3–5 grants and policies** (which instantly removes client access) and leave the columns in place.
- **Stages 3–5 are reversible without data loss:** drop the new policies and functions, restore the previous policy and grants. The exact SQL goes with each migration.
- **Never applied straight to production:** each stage goes to dev, is verified with the queries above and the advisors, and only then goes to production with your approval.

### After stage 5
`npx supabase gen types typescript --project-id zzyafhtpcuuwlrqewpcn > src/lib/database.types.ts`, with your approval, since it reads the project.

---

## 8. Frontend integration sequence

1. **Types:** generated `database.types.ts`; map `RequestDraft` ↔ table row in one tested function, including condition labels ↔ codes.
2. **Publish:**
   - Confirm becomes "Publish request" only when stages 1–5 are live on that environment;
   - not signed in → keep the draft in `localStorage` (it must survive sign-up and phone verification, which may open a new tab), then resume;
   - signed in but not phone-verified → `/verify-phone`, then resume.
3. **My requests:** list own requests with status and offer count, plus Cancel and Edit (only when allowed).
4. **Browse (traveller side):** open, unexpired requests, newest first, paginated. Photo via signed URL.
5. **Make or edit an offer:** the existing practice-offer form becomes real. The total is shown from the database's generated column, not recomputed by the client.
6. **Compare and accept:** the existing comparison UI with real offers. Accept calls `accept_offer` with the `version` that was on screen.
7. **Remove prototype wording:** drop "Saved on this device" and "Practice offer" once the real path is verified.
   - Until then they stay, and **the app never says a request is visible to travellers unless it was actually published**.
8. **Copy honesty:** the homepage says "Verified travellers". Today that means *phone-verified* only. Either say that, or add traveller verification first (§9).

All writes go through server actions that use the **signed-in user's** Supabase session, so the database policies apply. The service key stays server-only, for jobs.

---

## 9. Security risks and launch blockers

### Must have before real users (MVP)
| Item | Why | Plan |
|---|---|---|
| Stages 1–5 applied and tested | the marketplace doesn't exist without them | §7 |
| **Shared rate limiting** for link previews and publish/offer actions | the in-memory limiter doesn't hold across server instances | D12: a small Postgres table + function (no new service) or Upstash Redis (new service) |
| **Bot protection on publish and offer** | stops scripted spam | Turnstile is already in the app for auth. Reuse it on publish/offer (no new service). |
| Restricted and prohibited items | customs and legal exposure (e.g. drones, satellite phones, e-cigarettes, medicines, gold above limits, commercial quantities) | a clear "can't be carried" list, a checkbox on publish and offer, and a report button. **Needs legal review of India's baggage and customs rules. I can't give legal advice.** |
| Report + takedown | the minimum moderation for text and photos | report button → admin removes (server-side, logged) |
| Contact after acceptance | without it, buyer and traveller can't arrange the handoff | D13: reveal each other's verified phone to the matched pair only, via a security-definer function |
| Privacy basics (India's DPDP Act 2023) | consent, purpose, deletion | privacy notice; account deletion; retention rule for completed deals (D10). Legal review recommended. |
| Leaked-password protection | flagged by the advisor | dashboard setting (your action; may need a paid plan) |
| Expiry | stale requests mislead travellers | enforced by `expires_at` at once; the tidy-up job can come a little later |
| Audit log | disputes | `request_events` (stage 4) |
| Monitoring | know when things fail | Supabase logs + Vercel logs. Alert on function errors. |

### Can wait (post-MVP)
- In-app payments, escrow, refunds and disputes. These need a regulated payment provider, KYC and terms; a separate project.
  - **MVP stance: Orbitly introduces; buyer and traveller settle directly.** The app must say this plainly.
- Stronger traveller verification (ID, trip or ticket proof); see `AUTH_SECURITY_PLAN.md` §6.
- Email and push notifications (needs a transactional email provider); until then, in-app status only.
- Several photos per request; automated image moderation; server-side image re-encoding.
- Ratings and reviews; messaging; search and filters beyond kind and newest.
- Hosting preview images ourselves instead of hotlinking.

---

## 10. Open decisions (need your approval)

| # | Decision | My recommendation |
|---|---|---|
| D1 | Can logged-out visitors browse published requests? | **No** for MVP (signed-in only, as today). Revisit with a limited public view. |
| D2 | Editing a request that already has offers | **Not allowed**: cancel and repost. (Alternative: allow edits and mark pending offers "needs re-confirmation".) |
| D3 | Cancelling after an offer is accepted (either side) | Allowed, with a required reason, logged; a traveller withdrawing reopens the request |
| D4 | How long a request stays open | `least(needed_by, published + 30 days)` |
| D5 | Exchange rates | Traveller commits to an INR price; Orbitly shows no live rate |
| D6 | Allow `http://` product links (the database allows only `https://` today) | Allow both; the UI already accepts both, and the link preview handles both safely |
| D7 | Keep hotlinked preview images from other sites | Yes for MVP; marked as "image from {site}" |
| D8 | What other users see of a person | First name + "phone verified" badge only, instead of today's full name |
| D9 | When to drop the deprecated `price_inr` / `reward_inr` | A separate cleanup migration after stages 1–6 are live and both columns are confirmed empty everywhere |
| D10 | Account deletion when the user has an accepted or completed deal | Anonymise the profile, keep the deal record for N months (legal input on N) instead of cascading the delete |
| D11 | Scheduled jobs | Vercel Cron calling a protected server route (no new database extension) |
| D12 | Shared rate limiter | Postgres table + security-definer function (no new service), with Upstash as the later upgrade |
| D13 | How matched users contact each other | Reveal verified phone numbers to the matched pair only |
| D14 | Payments | None in the MVP; Orbitly introduces only, stated clearly in terms and UI |

---

**Next step:** review **stage 1 (`requests_marketplace_fields`)** in §7. It changes the schema only and grants
clients no new abilities. Nothing will be applied until you explicitly approve it, and then only to dev.
