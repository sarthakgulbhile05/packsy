"use server";

import { isAuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { authErrorMessage, logAuthError } from "@/lib/auth-errors";
import { SIGNUPS_CLOSED, SIGNUPS_OPEN } from "@/lib/preview";
import { siteUrl } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";
import { CAPTCHA_ERROR, TURNSTILE_FIELD, verifyTurnstile } from "@/lib/turnstile";
import { field, isEmail, passwordProblem } from "@/lib/validation";

export type SignupState = { error?: string; notice?: string; email?: string; fullName?: string };

// Same reply whether or not the email is already registered, so sign-up can't be used to find accounts.
const CHECK_EMAIL =
  "Check your email for a confirmation link. After confirming, log in to verify your phone number.";

export async function signup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const fullName = field(formData, "full_name");
  const email = field(formData, "email");
  const password = formData.get("password");
  const keep = { email, fullName };

  // The page hides the form while sign-ups are closed; this stops direct calls to the action too.
  if (!SIGNUPS_OPEN) return { ...keep, error: SIGNUPS_CLOSED };
  if (fullName.length > 100) return { ...keep, error: "Use a name of at most 100 characters." };
  if (!isEmail(email)) return { ...keep, error: "Enter a valid email address." };
  const problem = passwordProblem(password);
  if (problem) return { ...keep, error: problem };
  if (!(await verifyTurnstile(formData.get(TURNSTILE_FIELD), "signup"))) return { ...keep, error: CAPTCHA_ERROR };

  const site = siteUrl();
  if (!site) {
    console.error("[auth] SITE_URL is missing or invalid; refusing to build confirmation links");
    return { ...keep, error: "Sign-up is temporarily unavailable. Please try again later." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: password as string,
    options: { data: { full_name: fullName }, emailRedirectTo: `${site}/auth/confirm` },
  });
  if (error) {
    if (isAuthError(error) && (error.code === "user_already_exists" || error.code === "email_exists")) {
      return { notice: CHECK_EMAIL };
    }
    logAuthError("signup", error);
    return { ...keep, error: authErrorMessage(error) };
  }

  // With email confirmation on (required), there's no session until the link is clicked.
  if (data.session) redirect("/verify-phone");
  return { notice: CHECK_EMAIL };
}
