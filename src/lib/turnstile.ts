import "server-only";
import { siteUrl } from "./redirect";

// Field name the Turnstile widget adds to the form.
export const TURNSTILE_FIELD = "cf-turnstile-response";
export const CAPTCHA_ERROR = "Please complete the security check and try again.";

/** What each form's widget declares; a token from one form can't be spent on another. */
export type TurnstileAction = "login" | "signup" | "password_reset" | "phone";

// Cloudflare's public test secrets (1x…, 2x…, 3x…). They answer with placeholder hostname and action.
const TEST_SECRET = /^[123]x0{20,}AA$/;

/**
 * Checks a Cloudflare Turnstile token on the server. Fails closed: a missing secret, missing token, network
 * error, unexpected reply, or (with real keys) a token issued on another host or for another form all count
 * as "not verified". Cloudflare itself rejects expired and reused tokens.
 */
export async function verifyTurnstile(token: FormDataEntryValue | null, action: TurnstileAction): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("[captcha] TURNSTILE_SECRET_KEY is not set");
    return false;
  }
  // Test secrets would let every request through in production.
  const testSecret = TEST_SECRET.test(secret);
  if (process.env.VERCEL_ENV === "production" && testSecret) {
    console.error("[captcha] refusing a Cloudflare test secret in production");
    return false;
  }
  if (typeof token !== "string" || !token || token.length > 2048) return false;

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null) return false;
    const reply = data as { success?: unknown; hostname?: unknown; action?: unknown };
    if (reply.success !== true) return false;
    if (testSecret) return true; // placeholder hostname and action; never reached in production (refused above)

    const site = siteUrl();
    if (!site) {
      console.error("[captcha] SITE_URL is missing or invalid; can't check where the token was issued");
      return false;
    }
    if (reply.hostname !== new URL(site).hostname || reply.action !== action) {
      console.error("[captcha] token issued for another host or form", { hostnameMatches: reply.hostname === new URL(site).hostname, actionMatches: reply.action === action });
      return false;
    }
    return true;
  } catch {
    console.error("[captcha] verification request failed");
    return false;
  }
}
