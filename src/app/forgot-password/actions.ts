"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { logAuthError } from "@/lib/auth-errors";
import { createLimiter } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";
import { CAPTCHA_ERROR, TURNSTILE_FIELD, verifyTurnstile } from "@/lib/turnstile";
import { field, isEmail } from "@/lib/validation";

export type ForgotState = { error?: string; notice?: string; email?: string };

// The same reply whatever happens after the checks below: unknown email, known email, Supabase's own
// per-account limits, or an address the email service refuses. Anything else would reveal who has an account.
const SENT =
  "If an Orbitly account uses this email, we’ve sent it a link to reset your password. The link works once and expires soon. Check your spam folder too.";
const TOO_MANY = "Too many reset requests. Please wait a few minutes and try again.";

// Extra layer only: Turnstile (above) and Supabase's server-side email limits are the real protections,
// because this one lives in one server process's memory.
const perVisitor = createLimiter({ perKey: 5, global: 60, windowMs: 15 * 60_000, maxInFlight: 10 });
const perEmail = createLimiter({ perKey: 3, global: 1_000, windowMs: 15 * 60_000, maxInFlight: 10 });

export async function requestPasswordReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = field(formData, "email").toLowerCase();
  if (!isEmail(email)) return { error: "Enter a valid email address.", email };
  if (!(await verifyTurnstile(formData.get(TURNSTILE_FIELD), "password_reset"))) return { error: CAPTCHA_ERROR, email };

  // Only ever links back to this site's own /auth/confirm; nothing from the form or URL is used.
  const site = siteUrl();
  if (!site) {
    console.error("[auth] SITE_URL is missing or invalid; refusing to send reset links");
    return { error: "Password reset is temporarily unavailable. Please try again later.", email };
  }

  // shortcut: x-forwarded-for is only trustworthy behind a proxy that overwrites it (Vercel does); self-hosting needs that proxy.
  const h = await headers();
  const visitor = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const emailKey = createHash("sha256").update(email).digest("hex"); // never keep the address itself

  const result = await perVisitor(visitor, () =>
    perEmail(emailKey, async () => {
      const supabase = await createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${site}/auth/confirm` });
      if (error) logAuthError("password reset request", error); // code and status only
    }),
  );
  if ("limited" in result || "limited" in result.value) return { error: TOO_MANY, email };
  return { notice: SENT };
}
