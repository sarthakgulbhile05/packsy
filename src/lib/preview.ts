// Public preview switches. Safe to import in the browser: the values are inlined at build time.

/**
 * New accounts stay closed in production builds until the database's profile and request read rules
 * are tightened (see docs/preview-launch.md). Local `next dev` keeps them open; set
 * NEXT_PUBLIC_SIGNUPS_OPEN=1 at build time to open them in a deployment.
 */
export const SIGNUPS_OPEN = process.env.NEXT_PUBLIC_SIGNUPS_OPEN === "1" || process.env.NODE_ENV !== "production";

/**
 * Saving requests to an account. Stays false until the stage 3a migration (private drafts,
 * publish_request) is applied and verified: before it, every saved request would be readable by
 * all signed-in users. Enforced in the server actions, not just the UI. Flip only in a reviewed change.
 */
export const ACCOUNT_REQUESTS_OPEN: boolean = false;

export const SIGNUPS_CLOSED = "New accounts open soon. Orbitly is in an early public preview.";

/**
 * Trips, route matching and offers between accounts. Stays false until the stage 4 migration
 * (supabase/drafts/stage4_two_way_marketplace.sql) is applied and verified, and ACCOUNT_REQUESTS_OPEN is on:
 * before it, the tables and functions these pages call don't exist. Enforced in the server actions, not just
 * the UI. Flip only in a reviewed change.
 */
export const MARKETPLACE_OPEN: boolean = false;
