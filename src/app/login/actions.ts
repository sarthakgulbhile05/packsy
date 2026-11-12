"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isPhoneVerified } from "@/lib/auth";
import { authErrorMessage, logAuthError } from "@/lib/auth-errors";
import { safeNext } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";
import { SESSION_ONLY_COOKIE } from "@/lib/supabase/session-cookie";
import { CAPTCHA_ERROR, TURNSTILE_FIELD, verifyTurnstile } from "@/lib/turnstile";
import { field, isEmail } from "@/lib/validation";

export type LoginState = { error?: string; email?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = field(formData, "email");
  const password = formData.get("password");
  const next = safeNext(formData.get("next"));

  if (!isEmail(email) || typeof password !== "string" || !password || password.length > 72) {
    return { error: "Enter your email address and password.", email };
  }
  if (!(await verifyTurnstile(formData.get(TURNSTILE_FIELD), "login"))) {
    return { error: CAPTCHA_ERROR, email };
  }

  // "Remember me" off: the session cookies expire when the browser closes.
  const remember = formData.get("remember") === "on";
  const supabase = await createClient({ sessionOnly: !remember });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    logAuthError("login", error);
    return { error: authErrorMessage(error), email };
  }

  const cookieStore = await cookies();
  if (remember) cookieStore.delete(SESSION_ONLY_COOKIE);
  else {
    cookieStore.set(SESSION_ONLY_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  redirect(isPhoneVerified(data.user) ? next : `/verify-phone?next=${encodeURIComponent(next)}`);
}
