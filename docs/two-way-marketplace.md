# Two-way marketplace (feature/two-way-marketplace)

**Status:** PARTIALLY COMPLETE — BLOCKERS REMAIN.
- Stage 4 is applied to **dev only** (`zzyafhtpcuuwlrqewpcn`, migration `20261105134431`). Production is untouched. See `docs/stage4-audit-and-roadmap.md` section 7.
- The marketplace stays switched off (`MARKETPLACE_OPEN=false`). Signed-in pages haven't been run end to end, because that needs two test accounts with verified phones.
- Nothing is committed, pushed or deployed.

**Branch details:**
- Base: production snapshot `c0437ba`.
- Worktree: the `Orbitly-two-way` worktree.
- The original folder (`release/public-preview`) and `release/production-snapshot` are unchanged.

## Phase 0: what existed

**Existing pieces, reused rather than duplicated:**
- **Database:** `profiles`, `requests` (drafts made public by `publish_request`), and `offers` (full cost breakdown, one-accepted and one-per-traveller indexes, lawful-carriage declaration).
- **Code:** phone-verification gate, rate limiter, SSRF-safe link extraction, design system (`components/ui`), and noindex on private pages.

**Missing pieces:**
- countries and routes;
- trips;
- matching;
- accept, decline and withdraw for offers;
- cancel and complete for requests.

**India-only copy** appeared throughout the homepage, travel page, FAQ, metadata and share image.

## Design

| Piece | Decision |
|---|---|
| Countries | ISO 3166-1 alpha-2 codes. The database accepts any `^[A-Z]{2}$`, and the picker list lives in `src/lib/countries.ts`, so adding a country needs no migration. Names come from `Intl.DisplayNames`. |
| Requests | `source_country`, `destination_country` (both or neither, never equal), and `eligibility_status` (`unknown` / `eligible` / `review_required` / `restricted` / `prohibited`). Eligibility is set only by Orbitly review and is never granted to clients. Publishing now needs a route. |
| Trips | A new `trips` table: route, departure and arrival dates (arrival at most 30 days after departure), optional `capacity_kg` and notes, `status` (active / cancelled / completed), and `verification_status` (always `unverified` until a real check exists). **Owner-only reads.** |
| Matching | **One rule, in one place:** `public.trip_matches_request(trip, request)`. Same departure → source and same destination, in the same direction. The trip arrives today or later and by the request's needed-by date. Both are live. The traveller isn't the buyer. The item isn't restricted or prohibited. It's used by the offer policy, `matching_requests(trip)` and `matching_trips(request)`, and backed by partial route indexes on both tables. |
| Privacy | Buyers never browse travellers. `matching_trips` returns only route, dates and verification status for the caller's own request: no traveller id, notes or capacity. |
| Offers | Must name the traveller's own trip, which must match the request (checked by the database). The arrival date is copied from the trip on the server. Amounts stay in whole rupees, as the table stores them. |
| Lifecycle | `accept_offer` (buyer, locks the request, closes other pending offers, request → matched), `decline_offer` (buyer), `withdraw_offer` (traveller), `cancel_request` (buyer, open or matched), `complete_request` (buyer, matched → completed). All SECURITY DEFINER with `search_path = ''`, and EXECUTE for `authenticated` only. Requests are owner-only (audit I3): travellers see open requests only through `matching_requests`, which never returns the buyer's id. |
| App | Server actions (`src/app/trips/actions.ts`, plus the buyer steps in `src/app/request/actions.ts`) are gated by `MARKETPLACE_OPEN`. Lifecycle calls go through server-only `src/lib/marketplace-lifecycle.ts`, with a fixed allowlist of function names that never come from the browser. |
| UI | Route picker with a swap button (shared by requests and trips); `/trips` (list and new trip); `/trips/[id]` (matching requests, offer form, withdraw); and on the request page: route, eligibility, matching trips, offers with accept and decline, cancel, and "I've received it". |
| Homepage | "Products travel with people." The two directions are labelled, the globe has two routes in and two out, and the copy is direction-neutral in the hero, how-it-works, FAQ (and so the FAQ structured data), trust, footer, travel page, metadata and share image. Brand, logo, sections and order are unchanged. |

## Files

**New:**
- `supabase/drafts/stage4_two_way_marketplace.sql`
- `tests/db/marketplace-stage4.test.ts`
- `tests/unit/marketplace.test.ts`
- `src/lib/countries.ts`, `src/lib/trip.ts`, `src/lib/offer.ts`, `src/lib/eligibility.ts`, `src/lib/marketplace-lifecycle.ts`
- `src/app/trips/actions.ts`, `src/app/trips/page.tsx`, `src/app/trips/[id]/page.tsx`
- `src/components/request/route-picker.tsx`
- `src/components/marketplace/{trip-form,offer-form,action-button,request-marketplace}.tsx`

**Changed:**
- `src/lib/preview.ts` (the `MARKETPLACE_OPEN` switch)
- `src/lib/request-draft.ts`, `src/lib/request-row.ts` (route fields)
- `src/components/request/review-flow.tsx`, `src/components/request/offers.tsx`
- `src/app/request/actions.ts`, `src/app/requests/[id]/page.tsx`
- `src/app/page.tsx`, `src/app/travel/page.tsx`, `src/app/layout.tsx`, `src/app/opengraph-image.tsx`, `src/lib/site.ts`
- `src/components/home/{hero-globe,sections,faq,trust}.tsx`
- `src/components/nav/{nav-items,site-header,site-footer}.tsx`
- `tests/unit/{request-row,request-draft,request-actions}.test.ts` (route fields in fixtures)

## Tests (run 2026-11-01 in the worktree)

**Automated checks:**
- `vitest run`: **661/661 passed**, 27 files, including 27 new database tests and 21 new unit tests.
- `tsc --noEmit`, `eslint .` and `next build`: pass. `/trips` and `/trips/[id]` build as partial prerenders.

**Database tests, run on an in-memory Postgres (not Supabase):**
- **Matching:** USA→India with USA→India matches, and India→USA with India→USA matches. The reverse direction never matches. A different departure or destination doesn't match, and neither does a trip arriving after the needed-by date. Cancelled trips, closed requests and restricted items don't match; review-required items still list. A traveller never matches their own request.
- **Discovery:** each search starts only from the caller's own trip or request, and buyers see no traveller identity.
- **Trips:** signed-out visitors are refused, and other users can't see or change my trip. Creating one needs a verified phone, a future departure, a real route and sane dates. Travellers can't verify, complete or reassign their own trip.
- **Requests:** a request needs a route to publish. Half routes, the same country twice and full country names are rejected, and buyers can't set eligibility.
- **Offers:** an offer needs the traveller's own matching trip, and one offer per traveller per request.
- **Lifecycle:**
  - only the buyer accepts, and only once; other offers close and the request becomes matched;
  - nobody but the buyer can select a request directly (I3);
  - an offer whose trip was cancelled can't be accepted;
  - only the buyer declines, and only the traveller withdraws;
  - travellers can't change offer status directly;
  - cancel and complete follow state and owner.

**Browser checks on the worktree dev server (port 3005), signed out:**
- **Homepage:** new title, heading and direction chips. Google verification, canonical, Open Graph and structured data (Organization, WebSite, WebPage, FAQPage) are intact.
- **Layout:** no page overflow at 375 and 1280 px, and no broken images.
- **Request flow:** Describe → route picker. A missing route shows an error. The swap button gives India → United States, the city label becomes "City in United States", and the review shows the route.
- **Paste link:** still works (Apple AirPods Max: title and product image).
- **Trips:** `/trips` redirects to `/login?next=%2Ftrips` and has noindex.
- **SEO files:** `robots.txt` and the sitemap are unchanged (`/` and `/travel` only).

**Not tested:**
- **Signed-in pages against dev:** the database rules are tested on dev (section 7 of the audit doc), but the pages and server actions haven't been exercised by real signed-in accounts.
- **Other widths:** 768, 1024 and 1440 px weren't screenshotted.

## Needs your approval (in order)

1. **Stage 4 on `orbitly-prod`:** applied to dev on 2026-11-05 and verified; production needs its own approval.
2. **Turn on `ACCOUNT_REQUESTS_OPEN` and `MARKETPLACE_OPEN`** locally only, once two dev test accounts with verified phones exist, and test the signed-in flows. Don't commit test-only flag changes.
3. **Photo storage:** a private Supabase Storage bucket. Photos stay on the device until then, and publishing refuses them.
4. **Notifications:** none exist. Email or SMS needs a provider (SMTP or Twilio), which means an approval and a cost.
5. **Eligibility review:** who sets `eligibility_status`, and how. There are no legal rules in code by design.
6. **Committing** this branch. Nothing is committed.

## Known limitations

- **Offer amounts are in rupees,** because the existing `offers` table stores INR. Buyers outside India see rupee totals. A multi-currency offer model is a separate schema change.
- **After a request leaves `open`,** the traveller sees only their own offer (status, fee, arrival date) on the trip page, not the request's details, because requests are owner-only. Showing them needs the stage 5 "Accepted" function.
- **No in-transit milestones** (purchased, in transit, arrived) and no disputes: the lifecycle covers open → matched → completed, or cancelled. These need new statuses, plus evidence and storage.
- **Trip verification:** none exists. Every trip shows "not verified" in plain words, and there's no badge.
- **Rate limits** are still in memory, per server instance (audit M1).
- **Expired requests and finished trips** drop out of matching by date. No background job updates their stored status yet.
