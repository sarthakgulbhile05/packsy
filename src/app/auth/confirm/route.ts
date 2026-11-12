import { type EmailOtpType, isAuthError } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { logAuthError } from "@/lib/auth-errors";
import { hasFreshRecovery, isTokenHash, RECOVERY_PATH, RECOVERY_TOKEN_COOKIE, RECOVERY_WINDOW_SECONDS } from "@/lib/recovery";
import { siteUrl } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";

// Supabase's own link error codes, safe to log. Anything else (and the error_description, the URL and
// every other parameter) is never logged: the URL can carry one-time codes.
const LINK_ERROR_CODES = new Set(["otp_expired", "otp_disabled", "flow_state_expired", "flow_state_not_found", "bad_code_verifier", "validation_failed", "unexpected_failure"]);
const linkErrorCode = (value: string | null) => (value === null ? "missing" : LINK_ERROR_CODES.has(value) ? value : "other");

// Landing page for links in Supabase emails: sign-up confirmation and password reset.
// Destinations are fixed paths on this site; nothing in the link chooses where the user goes.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Redirect on the configured site address rather than whatever Host header the request carried.
  const base = siteUrl() ?? request.nextUrl.origin;
  const to = (path: string) => NextResponse.redirect(new URL(path, base));

  // Password reset by token hash (works on any device). The token is not spent here: link scanners that
  // open emails can't use it up, and /reset-password verifies it together with the new password.
  if (type === "recovery" && tokenHash !== null) {
    if (!isTokenHash(tokenHash)) return to("/login?error=link_invalid");
    const response = to(RECOVERY_PATH);
    response.cookies.set(RECOVERY_TOKEN_COOKIE, tokenHash, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: RECOVERY_PATH,
      maxAge: RECOVERY_WINDOW_SECONDS,
    });
    return response;
  }

  // No code or token: usually Supabase sending the user back with ?error_code= (e.g. an already-used link).
  if (!code && !(tokenHash && type)) {
    console.error("[auth] email link failed", { code: linkErrorCode(searchParams.get("error_code")) });
    return to("/login?error=link_invalid");
  }

  const supabase = await createClient();
  // Default email templates send ?code= (PKCE: only works in the browser that asked); custom ones
  // send ?token_hash=&type=.
  const { data, error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ type: type!, token_hash: tokenHash! });

  if (error) {
    logAuthError("email link", error);
    // No PKCE verifier in this browser: the link was opened in a different browser or device from the one
    // that asked for it (the code isn't spent: it still works there until it expires), or it was already used here.
    if (isAuthError(error) && error.code === "pkce_code_verifier_not_found") return to("/login?error=link_other_browser");
    return to("/login?error=link_invalid");
  }

  // A PKCE password reset: Supabase marks the new session's amr as "recovery".
  const accessToken = data?.session?.access_token;
  if (code && accessToken) {
    const { data: verified } = await supabase.auth.getClaims(accessToken);
    if (hasFreshRecovery(verified?.claims)) return to(RECOVERY_PATH);
  }
  // Next step after email confirmation: phone verification (it forwards verified users to their profile).
  return to("/verify-phone");
}
