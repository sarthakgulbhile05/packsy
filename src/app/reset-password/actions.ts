"use server";

import { isAuthError, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authErrorMessage, logAuthError } from "@/lib/auth-errors";
import { EXPIRED_LINK, hasFreshRecovery, isTokenHash, RECOVERY_PATH, RECOVERY_TOKEN_COOKIE } from "@/lib/recovery";
import { createClient } from "@/lib/supabase/server";
import { passwordProblem } from "@/lib/validation";

export type ResetState = { error?: string; expired?: boolean };

/** Same attributes as /auth/confirm sets, so the browser really drops it. */
async function clearRecoveryToken() {
  (await cookies()).set(RECOVERY_TOKEN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: RECOVERY_PATH,
    maxAge: 0,
  });
}

/**
 * Sets a new password, but only with proof of a genuine recovery (see src/lib/recovery.ts):
 * the unused token from the email (verified here, at submit), or a fresh PKCE "recovery" session.
 * Being signed in, or having just verified a phone code, is never enough.
 */
export async function resetPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const password = formData.get("password");
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  if (password !== formData.get("confirm")) return { error: "The two passwords don’t match." };

  const tokenHash = (await cookies()).get(RECOVERY_TOKEN_COOKIE)?.value;
  const supabase = await createClient();

  if (tokenHash !== undefined) {
    // Token-hash link: the token is the proof. Spend it now, together with the password change.
    if (!isTokenHash(tokenHash)) {
      await clearRecoveryToken();
      return { error: EXPIRED_LINK, expired: true };
    }
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (error) {
      logAuthError("password reset link", error); // code and status only
      if (isAuthError(error) && error.status === 429) return { error: authErrorMessage(error) }; // not spent; try later
      await clearRecoveryToken();
      return { error: EXPIRED_LINK, expired: true };
    }
    await clearRecoveryToken(); // used from here on, whatever happens next

    const { error: updateError } = await supabase.auth.updateUser({ password: password as string });
    if (updateError) {
      logAuthError("password update", updateError);
      // The link is spent, so this browser shouldn't keep the session it created. Retrying needs a new link.
      await supabase.auth.signOut({ scope: "local" });
      return { error: `${authErrorMessage(updateError)} Request a new reset link to try again.`, expired: true };
    }
    return signOutEverywhere(supabase);
  }

  // PKCE link: /auth/confirm already exchanged the code; the session itself must say "recovery", recently.
  const { data } = await supabase.auth.getClaims();
  if (!hasFreshRecovery(data?.claims)) return { error: EXPIRED_LINK, expired: true };

  const { error: updateError } = await supabase.auth.updateUser({ password: password as string });
  if (updateError) {
    logAuthError("password update", updateError);
    return { error: authErrorMessage(updateError) }; // the recovery session is still fresh, so they can retry
  }
  return signOutEverywhere(supabase);
}

/** Ends every session for the account (including any an attacker had), then sends the user to log in. */
async function signOutEverywhere(supabase: SupabaseClient): Promise<never> {
  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) {
    logAuthError("sign out after password reset", error);
    await supabase.auth.signOut({ scope: "local" }); // at least this browser
    redirect("/login?reset=signout_failed"); // the password did change; the message says other devices may not be signed out
  }
  redirect("/login?reset=done");
}
