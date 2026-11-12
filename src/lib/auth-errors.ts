import { isAuthError } from "@supabase/supabase-js";

const RATE_LIMITED = "Too many attempts. Please wait a few minutes and try again.";
const CANT_SEND = "We couldn't send a code right now. Please try again later.";
const CHECK_DETAILS = "Please check the details you entered and try again.";
const SESSION_ENDED = "Your session has ended. Please log in again.";

// Friendly, fixed messages keyed by Supabase Auth error code. Raw Supabase text is never shown.
const MESSAGES: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  email_not_confirmed: "Please confirm your email first, using the link we sent you.",
  weak_password: "Choose a stronger password: at least 8 characters, with letters and numbers.",
  same_password: "Your new password must be different from your current one.",
  over_request_rate_limit: RATE_LIMITED,
  over_email_send_rate_limit: RATE_LIMITED,
  over_sms_send_rate_limit: "Please wait a minute before requesting another code.",
  otp_expired: "That code is incorrect or has expired. Check it, or request a new code.",
  phone_exists:
    "This number can't be used for your account. If it belongs to another Orbitly account, log in to that account instead.",
  sms_send_failed: CANT_SEND,
  hook_timeout: CANT_SEND,
  hook_timeout_after_retry: CANT_SEND,
  phone_provider_disabled: CANT_SEND,
  captcha_failed: "The security check failed. Please try again.",
  email_address_invalid: CHECK_DETAILS,
  email_address_not_authorized: "We couldn't send email to this address. Please try a different one.",
  validation_failed: CHECK_DETAILS,
  signup_disabled: "Sign-ups are currently closed.",
  user_banned: "This account can't be used. Contact support if you think this is a mistake.",
  session_not_found: SESSION_ENDED,
  session_expired: SESSION_ENDED,
  refresh_token_not_found: SESSION_ENDED,
};

export function authErrorMessage(error: unknown): string {
  if (isAuthError(error)) {
    if (error.code && MESSAGES[error.code]) return MESSAGES[error.code];
    if (error.status === 429) return RATE_LIMITED;
  }
  return "Something went wrong. Please try again.";
}

/** Logs only the error code and status — never the message, which can contain emails or numbers. */
export function logAuthError(context: string, error: unknown) {
  const code = isAuthError(error) ? error.code : undefined;
  const status = isAuthError(error) ? error.status : undefined;
  console.error(`[auth] ${context} failed`, { code: code ?? "unknown", status });
}
