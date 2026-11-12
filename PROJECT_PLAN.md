# Orbitly — Project Plan

## What Orbitly is

A marketplace that connects **shoppers in India** who want products from abroad with
**travellers flying to India** who can carry those products in their luggage.

> Assumption: this is the "peer-to-peer delivery" model. If Orbitly means something
> else (e.g. tourists buying Indian products), update this section first.

### Core flow (MVP)

1. **Shopper** posts a request: product link, price, quantity, delivery city, reward offered.
2. **Traveller** posts a trip: from-country, to-city in India, travel date.
3. Traveller browses requests matching their trip and makes an offer.
4. Shopper accepts the offer and pays; Orbitly holds the money.
5. Traveller buys the item, flies, and hands it over.
6. Shopper confirms delivery; Orbitly releases payment to the traveller.
7. Both leave a rating.

## Technology stack

| Layer | Choice | Why it suits a beginner |
|-------|--------|-------------------------|
| Language | **TypeScript** | One language for front end and back end; editor catches mistakes early. |
| Web framework | **Next.js** (App Router) | Pages and server code in one project; huge community; free hosting on Vercel. |
| Styling | **Tailwind CSS** | Style directly in markup; no separate CSS architecture to design. |
| Database | **Supabase (PostgreSQL)** | Hosted Postgres with a web dashboard; no server to run. |
| Auth | **Supabase Auth** | Email/Google login built in; Row Level Security protects each user's data. |
| File storage | **Supabase Storage** | Product photos, receipts. |
| Payments | **Razorpay** or **Stripe** (decide later) | Razorpay is India-first (UPI); Stripe is simpler for international cards. |
| Hosting | **Vercel** | Connect GitHub, every push deploys automatically. |
| Version control | **Git + GitHub** | Backup, history, and the trigger for deployments. |

Not using (on purpose, for now): a separate Express/Django back end, Docker,
microservices, a mobile app. Add them only when a real need appears.

## Data model (first draft)

- `profiles` — id, full_name, created_at (built; avatar and rating come later)
- `trips` — traveller_id, from_country, to_city, travel_date, capacity_note
- `requests` — shopper_id, product_url, title, price, quantity, delivery_city, reward, status
- `offers` — request_id, trip_id, traveller_id, reward, status
- `orders` — offer_id, amount, payment_status, delivery_status
- `reviews` — order_id, author_id, target_id, stars, comment

## Milestones

1. **Setup** — repo, docs, Next.js skeleton, Supabase project, deploy "hello world".
2. **Accounts** — sign up / log in / profile page.
3. **Requests & trips** — create, list, view.
4. **Offers** — traveller offers, shopper accepts.
5. **Payments** — hold and release funds (test mode only).
6. **Delivery & reviews** — confirm delivery, ratings.
7. **Polish & launch** — mobile layout, terms, privacy policy, real payments.

## Risks to resolve before launch

- **Customs & legal**: Indian duty-free allowance limits, prohibited items, GST.
  Needs proper legal advice — not something code can solve.
- **Trust & fraud**: ID verification, dispute handling, refund policy.
- **Payments regulation**: holding user funds (escrow) has RBI rules; use the
  payment provider's marketplace/route product instead of holding money ourselves.
