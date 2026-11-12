# Orbitly — Tasks

Legend: `[ ]` to do · `[x]` done

## Milestone 1 — Setup
- [x] Inspect folder and installed tools
- [x] Write PROJECT_PLAN.md, TASKS.md, README.md
- [x] Add .gitignore
- [x] Set Git name and email (repo-only for now)
- [x] `git init` and first local commit
- [ ] Log in to GitHub CLI (`gh auth login`)
- [ ] Create **private** GitHub repo and push (only after approval)
- [x] Create Next.js + TypeScript + Tailwind skeleton
- [x] Create Supabase project; put keys in `.env.local` (never committed)
- [ ] Deploy skeleton to Vercel

## Milestone 2 — Accounts
- [x] Sign up / log in / log out
- [x] Profile page
- [x] Row Level Security on `profiles`
- [ ] Let real users sign up: turn off "Confirm email" for dev, or set up custom SMTP (Supabase dashboard)

## Milestone 2b — Phone verification (dev)
- [x] `is_phone_verified()`, `requests`, `offers` with phone-verified RLS (applied to dev)
- [x] `/verify-phone` page, profile phone status, login → verify redirect, auth guards
- [x] Safe error messages, loading states, Turnstile CAPTCHA (test keys)
- [x] Automated tests: unit, server actions (mocked), local Postgres RLS
- [x] Apply `profiles` least-privilege migration to dev (applied 2026-10-27, version 20261027100743)
- [ ] Run remote end-to-end test with a Supabase test number (needs approval)
- [ ] Production: Twilio Verify, real Turnstile keys, Supabase CAPTCHA, custom SMTP, `orbitly-prod`

## Milestone 3 — Requests & trips
- [ ] Create request form
- [ ] Create trip form
- [ ] Browse requests (filter by city/date)

## Milestone 4 — Offers
- [ ] Traveller makes offer
- [ ] Shopper accepts / rejects

## Milestone 5 — Payments (test mode)
- [ ] Choose Razorpay or Stripe
- [ ] Pay on accept, release on delivery

## Milestone 6 — Delivery & reviews
- [ ] Confirm delivery
- [ ] Ratings

## Milestone 7 — Launch
- [ ] Mobile layout pass
- [ ] Terms of service & privacy policy
- [ ] Legal/customs review
