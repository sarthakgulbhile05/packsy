import "server-only";

/**
 * Real money (collecting payments, holding funds through a provider, refunds, payouts) is OFF. A constant, not an
 * environment variable, so no deployment setting or browser can switch it on: turning it on is a reviewed code change,
 * made only once a payment provider agreement and legal sign-off exist (docs/payments/).
 * Server-only: a client component that imports this fails the build.
 */
export const PAYMENTS_ENABLED: boolean = false;

export const PAYMENTS_UNAVAILABLE = "Payments through Orbitly aren’t available yet. No money can be paid, held, refunded or paid out.";
