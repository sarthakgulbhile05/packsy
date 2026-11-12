/** Set at login when "Remember me" is off: auth cookies then last only until the browser closes. */
export const SESSION_ONLY_COOKIE = "orbitly_session_only";

/**
 * Cookie options for a Supabase auth cookie. Always httpOnly (and secure in production): only the
 * server reads the session, so page scripts never see the tokens. With sessionOnly, drops maxAge/expires
 * so the browser forgets the session when it closes. Deletions (empty value or maxAge 0) keep their
 * lifetime, otherwise logging out would leave an empty cookie behind.
 */
export function authCookieOptions<T extends { maxAge?: number; expires?: Date | number | string; httpOnly?: boolean; secure?: boolean }>(
  value: string,
  options: T,
  sessionOnly: boolean,
): Omit<T, "httpOnly" | "secure"> & { httpOnly: true; secure: boolean } {
  const copy = { ...options, httpOnly: true as const, secure: process.env.NODE_ENV === "production" };
  if (!sessionOnly || !value || options.maxAge === 0) return copy;
  delete copy.maxAge;
  delete copy.expires;
  return copy;
}
