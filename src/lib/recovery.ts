// Password recovery: how Orbitly tells a genuine recovery apart from an ordinary signed-in session.
//
// Supabase Auth records how a session was created in the JWT's `amr` claim (Supabase "JWT Claims
// Reference": method "recovery" = account recovery). Checked in Supabase Auth's source:
//   - PKCE links (`?code=`): the session gets amr method "recovery" (ParseAuthenticationMethod("recovery")).
//   - token-hash links (`verifyOtp`): the session gets amr method "otp", the same as a phone-code check,
//     so amr can't prove a recovery on this path.
// So the two paths use different proof:
//   - token hash: the unused one-time token itself. /auth/confirm doesn't spend it; it keeps it in a
//     short-lived, httpOnly cookie for /reset-password, which verifies it and changes the password together.
//   - PKCE: a "recovery" amr entry from the last few minutes, read from verified claims.
// Being signed in is never enough on its own.

/** How long a recovery link's proof is accepted after it's opened (seconds). */
export const RECOVERY_WINDOW_SECONDS = 15 * 60;

/** httpOnly cookie holding an unused recovery token hash, scoped to /reset-password. */
export const RECOVERY_TOKEN_COOKIE = "orbitly_recovery";
export const RECOVERY_PATH = "/reset-password";

/** One message for every dead link (invalid, expired, already used, missing), so none is told apart. */
export const EXPIRED_LINK = "This reset link is invalid, has expired or was already used. Request a new one.";

/** Supabase token hashes are hex (PKCE ones are prefixed "pkce_"); anything else is refused unread. */
export function isTokenHash(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,200}$/.test(value);
}

/**
 * True if verified JWT claims show a password recovery completed in the last RECOVERY_WINDOW_SECONDS.
 * Only the detailed amr format counts (it has timestamps); bare method strings can't show freshness.
 */
export function hasFreshRecovery(claims: unknown, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const amr = (claims as { amr?: unknown } | null)?.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    return (
      method === "recovery" &&
      typeof timestamp === "number" &&
      timestamp <= nowSeconds + 60 && // small clock skew allowance, never a future recovery
      nowSeconds - timestamp <= RECOVERY_WINDOW_SECONDS
    );
  });
}
