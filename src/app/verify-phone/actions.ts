"use server";

import { redirect } from "next/navigation";
import { isPhoneVerified, requireUser } from "@/lib/auth";
import { authErrorMessage, logAuthError } from "@/lib/auth-errors";
import { maskPhone, RESEND_COOLDOWN_SECONDS, toE164 } from "@/lib/phone";
import { safeNext } from "@/lib/redirect";
import { createStatelessClient } from "@/lib/supabase/server";
import { CAPTCHA_ERROR, TURNSTILE_FIELD, verifyTurnstile } from "@/lib/turnstile";
import { field } from "@/lib/validation";

export type PhoneState = {
  step: "phone" | "code";
  maskedPhone?: string;
  /** When the last code was requested (ms), for the resend countdown. */
  sentAt?: number;
  error?: string;
  notice?: string;
  country?: string;
};

/**
 * One action for the whole flow; the clicked button's `intent` picks the step:
 * "send" (new number), "resend" (same pending number), "verify" (check code), "change" (start over).
 * `prev` comes from the browser, so it's only used for the countdown display. The pending number
 * always comes from Supabase (user.new_phone).
 */
export async function phoneAction(prev: PhoneState, formData: FormData): Promise<PhoneState> {
  const { supabase, user } = await requireUser("/verify-phone");
  const next = safeNext(formData.get("next"));
  if (isPhoneVerified(user)) redirect(next);

  const pending = user.new_phone;
  const codeStep = (extra: Partial<PhoneState>): PhoneState =>
    pending
      ? { step: "code", maskedPhone: maskPhone(pending), sentAt: prev.sentAt, ...extra }
      : { step: "phone", error: "That code has expired. Please request a new one." };

  const intent = formData.get("intent");

  if (intent === "change") return { step: "phone" };

  if (intent === "verify") {
    const token = field(formData, "code").replace(/\s/g, "");
    if (!/^\d{6}$/.test(token)) return codeStep({ error: "Enter the 6-digit code." });
    if (!pending) return codeStep({});

    // Auth finds the account by pending number, not by session, so the code can confirm someone else's account.
    // A separate client keeps the session it returns away from the login cookie until we know whose it is.
    const verifier = createStatelessClient();
    const { data, error } = await verifier.auth.verifyOtp({ phone: pending, token, type: "phone_change" });
    if (error) {
      logAuthError("phone verification", error);
      return codeStep({ error: authErrorMessage(error) });
    }
    await verifier.auth.signOut({ scope: "local" }); // the caller keeps their own session either way
    if (data.user?.id !== user.id) {
      console.error("[auth] phone verification matched a different account");
      return {
        step: "phone",
        error: "This number is waiting for verification on another Orbitly account, so it wasn't added to yours. You're still signed in. Please use a different number.",
      };
    }

    // Only call it verified once Supabase Auth itself reports the confirmed number, on this same account.
    const {
      data: { user: fresh },
    } = await supabase.auth.getUser();
    if (!fresh || fresh.id !== user.id || !isPhoneVerified(fresh)) {
      return codeStep({ error: "We couldn't confirm your number. Please try again." });
    }
    redirect(next);
  }

  if (intent !== "send" && intent !== "resend") return { step: "phone", error: "Something went wrong. Please try again." };

  const country = field(formData, "country");
  let phone: string | null;
  if (intent === "resend") {
    if (!pending) return { step: "phone", error: "Please enter your number again." };
    // Countdown convenience only (prev is browser-supplied); Supabase enforces the real limit.
    if (prev.sentAt && Date.now() - prev.sentAt < RESEND_COOLDOWN_SECONDS * 1000) {
      return codeStep({ error: "Please wait a minute before requesting another code." });
    }
    phone = pending.startsWith("+") ? pending : `+${pending}`; // Supabase stores numbers without "+"
  } else {
    phone = toE164(country, field(formData, "phone"));
    if (!phone) return { step: "phone", country, error: "Enter a valid mobile number for the selected country." };
  }

  if (!(await verifyTurnstile(formData.get(TURNSTILE_FIELD), "phone"))) {
    return intent === "resend" ? codeStep({ error: CAPTCHA_ERROR }) : { step: "phone", country, error: CAPTCHA_ERROR };
  }

  const { error } = await supabase.auth.updateUser({ phone });
  if (error) {
    logAuthError("send phone code", error);
    const message = authErrorMessage(error);
    return intent === "resend" ? codeStep({ error: message }) : { step: "phone", country, error: message };
  }

  return {
    step: "code",
    maskedPhone: maskPhone(phone),
    sentAt: Date.now(),
    notice: "If this number can receive SMS, a 6-digit code is on its way. It expires in 10 minutes.",
  };
}
