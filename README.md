# Orbitly

A marketplace connecting shoppers in India with travellers who can bring products
from abroad.

- Plan: [PROJECT_PLAN.md](PROJECT_PLAN.md) · Tasks: [TASKS.md](TASKS.md)
- Account security design: [docs/AUTH_SECURITY_PLAN.md](docs/AUTH_SECURITY_PLAN.md)

## Status

Milestone 2b (development only): email sign-up/log-in, phone verification, profile,
and database rules that block unverified users from posting requests or offers.

## Running locally

```bash
npm install      # first time only
npm run dev      # open http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | Unit tests + local database (RLS) tests. Never touches Supabase. |
| `RUN_REMOTE_TESTS=1 npx vitest run tests/remote` | End-to-end against the **dev** project with a test number. Changes dev data — only with approval. |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | Code style / mistakes check |
| `npm run build` | Production build |

## Pages

| Page | Who | What |
|---|---|---|
| `/signup` | anyone | Create account (CAPTCHA). Email confirmation required. |
| `/login` | anyone | Log in (CAPTCHA). Unverified users continue to `/verify-phone`. |
| `/verify-phone` | logged in | Enter mobile number → 6-digit code. 60 s between codes. |
| `/profile` | logged in | Name, masked phone status, log out. |

Server-side helpers in `src/lib/auth.ts`: `requireUser()` and `requireVerifiedPhone()`.
The database enforces the same phone rule with RLS, so the helpers are for redirects only.

## Phone verification

Supported countries (mobile numbers only): India, United States, Canada, United Kingdom,
United Arab Emirates, Australia, Singapore — see `src/lib/phone.ts`.

**In development no SMS is ever sent.** The dev project's Send SMS hook
(`supabase/dev/discard_sms_hook.sql`) discards messages, so only the dashboard's
**test phone numbers** (fixed codes, kept in `.env.local` → `TEST_PHONE_OTPS_DASHBOARD`)
can be verified. Enter a test number without its country code, e.g. India + `9000000001`.

## Environment variables

Copy `.env.example` to `.env.local`. `.env.local` is ignored by Git — never commit it.

| Name | Where it's used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Dev project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | Publishable key only — never the secret key |
| `SITE_URL` | server | Base for email confirmation links (https in production) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | browser | Cloudflare test key in dev |
| `TURNSTILE_SECRET_KEY` | server only | Cloudflare test key in dev; real one never leaves the server |

## Database

Schema changes live in `supabase/migrations/`; every table has Row Level Security.
`tests/db` runs all migrations in an in-memory Postgres (PGlite) and checks the rules.
`supabase/dev/` holds development-only SQL that must never run on production.

## Sign-up emails

Supabase's built-in mailer only delivers to a few addresses, so real sign-ups can't
finish until custom SMTP is set up (or "Confirm email" is turned off in **dev only**).
A confirmed test account is stored in `.env.local` (`TEST_USER_EMAIL` / `TEST_USER_PASSWORD`).

## Before production (not done yet)

- Twilio Verify (paid) instead of the dev SMS hook; remove the hook and test numbers.
- Real Turnstile keys, and Supabase's own CAPTCHA setting so direct API calls are protected too.
  (The app refuses Cloudflare's test secrets when `VERCEL_ENV=production`.)
- Custom SMTP, a separate `orbitly-prod` Supabase project, `SITE_URL` with https.
