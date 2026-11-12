# Orbitly — Buyer Request Flow: Implementation Plan

> **Status (2026-10-29): plan approved. Stage 3a SQL is drafted locally — `draft / not applied`** (§3a below).
> Nothing else is implemented, and nothing is applied anywhere. Every database step needs your
> explicit approval, dev first. Builds on `docs/marketplace-backend-plan.md` (stages 1–2 are live on dev).

Goal: the existing composer (link / photo / describe) → review → **Publish** saves a real request in Supabase.
The signed-in buyer can then see their own requests. The UI, branding and steps stay as they are; only the
confirm step, its copy and one new "My requests" page change.

---

## 1. What is true today (inspected 2026-10-29)

**Live dev database (read-only check):**
- `requests`: 0 rows. Storage: 0 buckets, 0 storage policies. 3 profiles.
- Read policy: **"Requests are visible to logged-in users" — `using (true)`**: every signed-in user can read **every** request, of any status.
- Insert policy: phone-verified, `shopper_id = auth.uid()`.
- Insert grants: only `title, product_url, price_inr, quantity, delivery_city, reward_inr`. The stage 1 columns (description, budget, image…) are **not** writable by users yet.
- The default status is still `open`. No update or delete policy exists.

**Consequence:** if the form were connected now, every saved request would be public to all signed-in users at once.
A private draft is impossible. Most of what the form collects couldn't be saved either.
**So the flow needs a database migration first (stage 3a below).** No UI change alone can make drafts private.

**App:**
- The composer and review flow keep the draft in `sessionStorage`. "Confirm" saves it to `localStorage` ("Saved on this device").
- Photos are resized on the device to a JPEG data URL (≤ 1200 px). Link previews come from `previewLink`, which is rate-limited and SSRF-hardened.
- Auth helpers already exist: `requireUser` and `requireVerifiedPhone` (`src/lib/auth.ts`); per-request server and browser Supabase clients (publishable key only); Turnstile.
- The service-role key is not used anywhere in `src/`, and this plan keeps it that way.

**Mismatches between the form and the database** (the server must enforce the database's limits):
| Field | Form today | Database |
|---|---|---|
| budget | `< 1e9`, any decimals | `numeric(12,2)`, `< 1e8` |
| deliverTo | min 2 | 2–100 |
| description | no limit (link-preview or typed text) | ≤ 2000 |
| product link | `http` or `https` | **`https` only** (decision B5) |
| condition | labels ("Used – good condition") | codes `new / used_good / any` |
| image | one field: data URL **or** a link-preview `https` URL | `image_path` (our Storage) **or** `preview_image_url` (third-party) |

---

## 2. Visibility rule (explicit)

| Status | Who can read it | How it gets there |
|---|---|---|
| `draft` | **owner only** | every insert by a user (status is never granted) |
| `open`, before `expires_at` | owner + any signed-in user (travellers) | only `publish_request(id)`: owner, phone-verified, from `draft` |
| `open` past `expires_at` | owner only | time passes; no job needed for hiding |
| `matched / completed / cancelled / expired` | owner (travellers with an offer: stage 4) | stage 4 functions |
| any | **never** anonymous visitors (D1) | — |

A request is visible to travellers **exactly when `publish_request` succeeds**, and not a moment earlier.
The UI says "Published" only after that call returns success.

---

## 3. Database work (migrations — each shown to you, approved, applied to dev with the stage 1/2 probe procedure)

### Stage 3a `requests_drafts_and_publish` (required for this flow) — 📝 DRAFT / NOT APPLIED

The draft is in `supabase/drafts/` (see **§3a. Stage 3a draft** below for the final SQL and how it differs from this outline).

This is the buyer-side subset of the planned stage 3. The traveller-side pieces (`has_offered_on`, editing open
requests) wait for stage 4, where matching exists. Planned order, so permissions never widen before the rules exist:

1. `alter column status set default 'draft'`.
2. Published-dates check: `status = 'draft' or (published_at is not null and expires_at is not null)`. The table has 0 rows, so nothing needs backfilling. A guard aborts if any rows appear.
3. **Replace the read policy** (`alter policy`, so there is never a moment without one), as one rule:
   `shopper_id = auth.uid() or (status = 'open' and expires_at > now())`.
4. **Tighten the insert policy:** also `status = 'draft' and published_at is null and expires_at is null`, plus `image_path is null`, which is only set later by update. Optional daily cap (decision B3).
5. **Update policy (new):** owner only, `using` and `with check` both `status = 'draft'`, and `image_path` null or inside `{auth.uid()}/{id}/`.
6. **Delete policy (new):** owner only, `status = 'draft'`.
7. **`publish_request(p_id uuid)`**:
   - security definer, `search_path = ''`, execute revoked from public and anon, granted to authenticated;
   - locks the row; checks owner + `is_phone_verified()` + `status = 'draft'`;
   - if `image_path` is set, checks the object exists in `storage.objects` for that bucket and path;
   - sets `status = 'open'`, `published_at = now()`, `expires_at = least(needed_by end-of-day IST, now() + 30 days)` (D4);
   - returns the row's id and dates. Fails with one generic "not found or not allowed" for any other caller.
8. **Grants, last:**
   - `insert` and `update` on the content columns only: `title, description, product_url, item_kind, attributes, item_condition, quantity, budget_amount, budget_currency, origin_preference, delivery_city, needed_by, notes, preview_image_url` (+ `update (image_path)`);
   - `delete` on the table;
   - **revoke** `insert (price_inr, reward_inr)` (deprecated; D9);
   - never granted: `id, shopper_id, status, published_at, expires_at, created_at, updated_at`.
9. Comments.

Also, as in stage 2: a read-only probe, a recovery script, and local tests that apply the migration statement by statement.
They prove every intermediate state is no less restrictive than today and that each state is reported as applied, not applied or PARTIAL.

**Effect on offers (stage 2):** none to its rules. The offer insert rule already requires `status = 'open'` and not expired.
Drafts are therefore un-offerable, and now also invisible.

### §3a. Stage 3a draft (2026-10-29) — `draft / not applied`

**Files (outside `supabase/migrations/`, so nothing can push them by accident):**
- `supabase/drafts/stage3a_requests_drafts_and_publish.sql`: the migration, 14 statements;
- `supabase/drafts/stage3a_requests_drafts_and_publish.probe.sql`: read-only state probe (`applied` / `not applied` / `PARTIAL`);
- `supabase/drafts/stage3a_requests_drafts_and_publish.recovery.sql`: recovery, used only for `PARTIAL`, only with approval. It refuses to run if any request rows exist: restoring the old "everyone can read" rule would expose drafts;
- `tests/db/requests-stage3a.test.ts`: 86 local tests.

**The 14 statements, in order** (no intermediate state allows more than today, tested):
| # | Statement | Effect |
|---|---|---|
| 1 | default `draft` + `requests_published_dates` check (one statement) | new rows are drafts; non-drafts must have `published_at` and a later `expires_at`. Fails, changing nothing, if legacy dateless open rows exist (dev has 0 rows). |
| 2 | revoke insert on `price_inr`, `reward_inr` | deprecated fields closed |
| 3 | `alter policy` read rule | own rows any status; others only `open` and `expires_at > now()` |
| 4 | `alter policy` insert rule | + `status = 'draft'`, no dates, no `image_path` |
| 5 | new update policy | owner, draft only, and still an undated draft without photo afterwards |
| 6 | new delete policy | owner, draft only |
| 7–9 | `publish_request(uuid)` + revoke from public/anon + grant to authenticated | the only draft → open path |
| 10–12 | insert grants (10 form columns), update grants (14 form columns), delete grant | the new abilities, last |
| 13–14 | comments | — |

**`publish_request(p_request_id)`** — `security definer`, `search_path = ''`, not executable by `anon`/`public`:
1. locks the caller's own row (`for update`); anyone else's request, an unknown id or no session → the same `42501 Request not found or not allowed`;
2. caller's phone must still be verified (`is_phone_verified()`), else `42501`;
3. must be `draft` (so publishing twice, or a cancelled/expired request, is refused);
4. `needed_by`, if set, must be today or later **in India (IST)**;
5. `image_path` must be empty (photos are refused until stage 5 adds the storage check);
6. sets `status = 'open'`, `published_at = now()`, `expires_at = least(now() + 30 days, end of needed_by in IST)`; returns `expires_at`.

**Differences from the outline above (deliberate, smaller):**
- `image_path` is **not granted at all** in 3a (the outline granted `update (image_path)`). It arrives with stage 5, together with the storage-object check in `publish_request`. Until then the database refuses photos rather than trusting an unchecked path.
- `listed_price_amount/currency` are not granted: the form has no such field.
- The update policy doesn't re-check phone verification: only verified users can create drafts, and publishing re-checks it.
- No per-user daily cap (B3 is unresolved, below).

**Column access after 3a (authenticated users):**
- insert: `title, description, product_url, item_kind, attributes, item_condition, quantity, budget_amount, budget_currency, origin_preference, delivery_city, needed_by, notes, preview_image_url`;
- update: the same 14;
- delete: whole row, policy-limited to own drafts;
- never: `id, shopper_id, status, published_at, expires_at, created_at, updated_at, image_path, listed_price_*, price_inr, reward_inr`.
- `anon`: still nothing on `requests`.

**Status of B1–B10 in this draft** (a protection is "in 3a" only if the database enforces it and a test proves it):
| # | Decision | Status in 3a | Impact while unresolved |
|---|---|---|---|
| B1 | Server-side drafts | **In 3a** (default `draft`, owner-only) | — |
| B2 | Expiry: 30 days or end of needed-by (IST) | **In 3a** (`publish_request`) | — |
| B3 | Durable per-user cap on new requests | **Unresolved — not in 3a** | A phone-verified user can insert unlimited drafts through the API. Drafts are private and unpublished, so the harm is storage and spam-to-self; publishing is one call per draft, so mass publishing is also unlimited. The app-level limiter (step 3) doesn't stop direct API calls. Needs your decision: add an insert-policy cap (e.g. 20 per 24 h) to 3a, or a later stage. |
| B4 | Turnstile on publish | **Unresolved — app step 3**, not enforceable in the database | Direct API calls (with a valid session) bypass any app-only captcha. |
| B5 | `https`-only product links | **Enforced** by the existing stage-0 check (unchanged); the app must upgrade `http` → `https` | — |
| B6 | Photo requests before storage | **Enforced** (no `image_path` grant; publish refuses one) | Photo-only requests can't publish until stage 5. |
| B7 | Upload byte checking | **Not applicable to 3a** (stage 5) | — |
| B8 | `preview_image_url` provenance | **Unresolved — app step 3.** The database only checks `http(s)://` and ≤ 2000 chars. | Through the API, a buyer can store any http(s) URL (including an IP address or `http`), which every viewer's browser will request. The render rules (no-referrer, `<img>` only) limit it to a tracking/IP-leak risk. The app-side checks don't stop direct API writes; a stricter database check (https only, no IP literal) is possible if you want it in 3a. |
| B9 | Personal data in free text | **Unresolved — app (warning) and launch blocker (moderation)** | Notes and descriptions are visible to all signed-in users once published. |
| B10 | Login `next=` redirect | **App step 4**, reuses existing safe redirect helper | — |

Other risks kept explicit:
- **Expiry is enforced by reading time**, not by a job: expired rows keep `status = 'open'` until stage 7. Everything that matters (read policy, offer insert policy) already compares `expires_at > now()`.
- **`publish_request` exists for 2 statements before its anon revoke** (Supabase grants new functions to `anon` by default). It's harmless — with no session it fails its first check — and tested.
- **Atomicity of `apply_migration` is still unverified**; the probe/recovery procedure covers a partial apply, as for stages 1 and 2.
- **Offers stage 2 interplay:** offers already require an `open`, unexpired request; drafts are now also invisible, so they can't be offered on (tested).
- **Stage 4 note:** `requests_published_dates` means a draft can't be moved to `cancelled` without dates; stage 4 should delete drafts instead of cancelling them.

### Stage 5 `request_images_storage` (required for the photo path)
- Private bucket `request-images`: 2 MB limit, `image/jpeg, image/png, image/webp`. These limits are enforced by Storage itself.
- Policies on `storage.objects` for that bucket only:
  - **insert:** path is `{auth.uid()}/{request id}/{name}.jpg`, the request is the caller's and still `draft`, and fewer than 3 objects are already in that folder;
  - **select:** the caller can read the request (same rule as §2);
  - **delete:** owner, while `draft`;
  - **no update.**
- Creating the bucket and its policies is a storage change, so it gets its own approval. It is **not** part of 3a.

---

## 4. Server-side work (Next.js server actions; user's own session, never the service key)

New `src/app/request/publish-actions.ts` (or added to `actions.ts`):

1. **`createRequestDraft(input: unknown)`**
   - `requireVerifiedPhone("/request/new")`. RLS enforces this too; the redirect is for UX.
   - Per-user limiter, using the existing `createLimiter` keyed by user id, e.g. 5 per minute and 20 per hour (B3).
   - Turnstile token check (B4).
   - `draftToRow(input)` (below) → `insert … select id`, using the user's session client.
   - Returns `{ id }` or field errors. Database errors are mapped to friendly text, with no raw messages.
2. **`publishRequest(id, imagePath?)`**
   - requires a user; checks `id` is a UUID;
   - if `imagePath` is given: it must match `^{user.id}/{id}/[0-9a-f-]{36}\.jpg$`; then `update image_path` (RLS: own draft only);
   - `rpc("publish_request", { p_id: id })`;
   - returns the dates, or "couldn't publish, your draft is saved".
3. **`deleteDraft(id)`**: owner's draft only, by RLS. It also removes the photo through the Storage API with the user's session.

New pure module **`src/lib/request-row.ts`**: `draftToRow(input, today)`. It is the single trust boundary for form data.
- Treats input as `unknown`; rebuilds the row from known keys only (it never spreads client objects).
- Reuses `validateDraft`, then adds the database limits from §1: title ≤ 120, description ≤ 2000, notes ≤ 1000, origin ≤ 120, city 2–100.
- `needed_by` must be today to one year ahead. Budget must be `> 0`, `< 1e8`, with ≤ 2 decimals, and a currency from `CURRENCIES`.
- `item_kind` comes from `ITEM_KINDS`. `attributes` keep only the keys allowed for that kind, each trimmed to ≤ 80 characters.
- Condition labels map to codes.
- `product_url` → `normalizeUrl`, then the https rule (B5).
- **image:**
  - a `data:` URL is never sent to the server; the browser uploads it (§5);
  - an `https:` URL → `preview_image_url`, only if `source === "link"` and it passes the preview-image rules already written in the backend plan: https only, no credentials, default port, no IP literal or internal host (reusing the `link-preview` checks), ≤ 2000 characters;
  - anything else is dropped.
- `linkNote` and `source` are not stored.

**My requests:** new server component `src/app/requests/page.tsx`.
- `requireUser("/requests")`, then `select … where shopper_id = user.id order by created_at desc limit 50`. The explicit filter is needed because other users' open requests are also readable.
- Photos are shown through `createSignedUrls(paths, 3600)` with the user's session.

**Rate limiting, honestly:**
- The in-memory limiter works per server instance only, so it is a speed bump.
- The durable caps are the database ones: the optional daily insert cap (B3) and 3 objects per request folder.
- A shared limiter (D12) is still a launch blocker.

---

## 5. Frontend work (same screens, same styling)

- **Review step:**
  - "Confirm request" becomes **"Publish request"**;
  - the amber note changes to say what happens: "Travellers signed in to Orbitly will see this until {date}";
  - a short privacy hint: "Don't include phone numbers or addresses".
- **Publish click**, by user state:
  - **not signed in:** copy the draft to `localStorage` (it must survive sign-up and the email link, which opens a new tab), then go to `/login?next=/request/new`;
  - **signed in, phone not verified:** go to `/verify-phone?next=/request/new`;
  - **verified:** `createRequestDraft` → if the image is a data URL, the browser uploads the JPEG blob to `request-images/{uid}/{id}/{uuid}.jpg` with its own session (`src/lib/supabase/client.ts`) → `publishRequest(id, path)`.
  - If the upload fails, the buyer is offered "Publish without photo" or "Try again". The draft stays private meanwhile.
- **Saved step:**
  - becomes "Published" with the expiry date, and links to My requests;
  - `saveRequestOnDevice` is no longer used for published requests; the session draft is cleared only after success;
  - the practice-offer panel stays and stays labelled "practice" (real offers come in later stages).
- **My requests (`/requests`):** reuses the existing `Summary` card. Each card has a status chip: Draft — only you can see this; Published until …; Expired. A draft has Publish and Delete buttons.
- **Images:**
  - own photos use signed URLs;
  - preview images follow the existing render rules: `<img>` only, `referrerPolicy="no-referrer"`, lazy, `onError` → placeholder, labelled "Image from {host}", never through `next/image`.
- **Unchanged:** the homepage, the composer, the edit step, the auth pages and the link-preview path.

---

## 6. Tests

**Database (PGlite, `tests/db/requests-stage3a.test.ts`):**
- **Ownership:**
  - the owner reads their own draft;
  - another verified user, an unverified user and anon can't read it;
  - after publish, other signed-in users can read it and anon still can't;
  - after `expires_at`, only the owner can.
- **Unauthorized writes:**
  - insert while unverified;
  - insert as someone else (`shopper_id`);
  - setting `status`, `published_at`, `expires_at`, `price_inr` or `reward_inr`;
  - `image_path` on insert, or outside your own folder;
  - updating or deleting someone else's draft, or your own published request;
  - publishing someone else's request, or publishing twice;
  - offering on a draft.
- **Invalid data:** every check constraint (lengths, budget pair, currency, kind, condition, quantity, https link).
- **Persistence:** a full insert → update image → publish; the dates are set; it is listed for the owner.
- **Migration safety:**
  - the exact grant and policy diff;
  - probe and recovery at every statement prefix;
  - no intermediate state wider than today;
  - stage 2 offers tests still pass.

**Storage policies (local stub):** add a minimal `storage.objects` and `storage.foldername()` to `tests/db/local-supabase.ts`. Then test own-folder-only, draft-only, the 3-object cap and no update.
Storage's size and MIME limits can't be tested locally. They need one dev check with your test account, only with your approval.

**Unit (`tests/unit/request-row.test.ts`, `tests/unit/publish-actions.test.ts`):**
- `draftToRow`:
  - accepts the three entry paths;
  - rejects bad and oversized input of each kind;
  - strips unknown keys and attribute keys;
  - splits the image correctly;
  - rejects private-IP or credentialed preview-image URLs.
- Actions, with a fake Supabase client:
  - redirect when signed out or unverified;
  - rate-limit message;
  - no raw database error text leaks;
  - `imagePath` outside the user's folder is refused before any call.

**Existing tests that change:**
- `tests/db/rls.test.ts`: request inserts use `price_inr` and `reward_inr`, and some expect `open`.
- `tests/db/offers-stage2.test.ts`: it creates open requests by user insert, so it will need publish.
- `tests/remote/phone-flow.test.ts`: it expects status `open`, and it is opt-in only.

---

## 7. Implementation sequence (each step separately reviewable)

1. **Local only:** stage 3a SQL draft + probe + recovery + DB tests; existing tests updated.
2. **Approval** → apply 3a to dev (probe → apply → probe → snapshot diff), as for stage 2.
3. **Local:** `draftToRow` + server actions + unit tests (no UI change yet).
4. **Local:** review-step and Saved-step changes + My requests page. The **link and describe paths work end to end** at this point (no photo storage needed).
5. **Local only:** stage 5 storage SQL draft + tests (stubbed).
6. **Approval** → create the bucket and policies on dev.
7. **Local:** photo upload in the publish click; signed URLs on My requests.
8. **Verification on dev**, with your approval and your existing test account only, no new accounts: publish one request per path, check another account can't see a draft, then clean up.

Until step 6, a photo request can still publish: the photo is either left out with a clear message, or the button
waits for storage (B6).

---

## 8. Unresolved security decisions (need your call)

| # | Decision | My recommendation |
|---|---|---|
| B1 | Should drafts exist on the server at all, or be created and published in one step? | Server drafts: the photo upload needs a request id first, and a failed upload must not lose the request. They are private and deletable, with a 7-day cleanup later (stage 7). |
| B2 | Expiry for requests without `needed_by` | 30 days (D4); with `needed_by`: the end of that day, IST |
| B3 | Durable per-user cap | Insert policy: ≤ 20 requests created per 24 h per user, plus the in-memory limiter. Cheap, cross-instance, no new service. |
| B4 | Turnstile on publish | Yes. The widget and server check already exist, so it's reuse, not new code paths. |
| B5 | `http://` product links | Store only `https`. Upgrade `http` links to `https` when normalising, and tell the buyer if that changes the link. No change to the database check. |
| B6 | Photo requests before storage is live | Disable "Publish" for photo-only requests with "Photo upload is coming soon; add a link or description", rather than silently dropping the photo |
| B7 | Upload integrity: Storage checks the declared type, not the real bytes; a modified client could upload a non-image | Accept for MVP. Private bucket, signed URLs, shown only via `<img>` (no script execution), 2 MB cap. Server-side re-encoding stays a launch item. |
| B8 | Preview images come from the client, so "only from our link preview" can't be proven without signing | Accept with the static URL checks + render rules. Upgrade: HMAC-sign the preview result (needs a new server secret, which you would set). |
| B9 | Phone numbers or addresses typed into notes become visible to travellers | A warning before publishing (UI). Moderation and reporting are launch blockers. |
| B10 | Login redirect targets | Reuse the existing `next=` handling (`src/lib/redirect.ts`, already restricted to same-site paths) |

---

## 9. Files that would change

**Database (local, then applied only with approval):**
- `supabase/drafts/stage3a_requests_drafts_and_publish.sql`, `.probe.sql`, `.recovery.sql` (new)
- `supabase/drafts/stage5_request_images_storage.sql`, `.probe.sql`, `.recovery.sql` (new)

**Server:**
- `src/lib/request-row.ts` (new): validation and mapping
- `src/app/request/actions.ts` or `src/app/request/publish-actions.ts` (new actions)
- `src/lib/link-preview.ts`: export the existing host and IP checks for preview-image validation (no behaviour change)
- `src/lib/database.types.ts` (new, generated, read-only)

**Frontend:**
- `src/components/request/review-flow.tsx`: confirm → publish; Saved step copy
- `src/lib/request-draft.ts`: a `localStorage` hand-off for the sign-in round trip; prototype comments updated
- `src/app/requests/page.tsx` (new): My requests
- `src/components/request/ui.ts`: maybe a status chip style

**Tests:**
- new: `tests/db/requests-stage3a.test.ts`, `tests/db/storage-stage5.test.ts`, `tests/unit/request-row.test.ts`, `tests/unit/publish-actions.test.ts`
- changed: `tests/db/local-supabase.ts` (storage stub), `tests/db/rls.test.ts`, `tests/db/offers-stage2.test.ts`, `tests/remote/phone-flow.test.ts`

**Docs:** `docs/marketplace-backend-plan.md` (stage table: 3a/5 status).

**Not touched:** authentication settings, Supabase project settings, environment secrets, the homepage, composer, auth pages, offers schema.
