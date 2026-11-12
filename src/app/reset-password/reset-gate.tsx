import { cookies } from "next/headers";
import { connection } from "next/server";
import { EXPIRED_LINK, hasFreshRecovery, isTokenHash, RECOVERY_TOKEN_COOKIE } from "@/lib/recovery";
import { createClient } from "@/lib/supabase/server";
import { ExpiredLink, ResetPasswordForm } from "./reset-password-form";

/**
 * Shows the form only if a recovery proof is present; the action checks it again at submit.
 * The token is never read into the page: only whether one is there. Nothing is spent on page load.
 */
export async function ResetFromRequest() {
  await connection(); // request time only: hasFreshRecovery reads the clock, which Next won't allow while prerendering
  if (isTokenHash((await cookies()).get(RECOVERY_TOKEN_COOKIE)?.value)) return <ResetPasswordForm />;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return hasFreshRecovery(data?.claims) ? <ResetPasswordForm /> : <ExpiredLink message={EXPIRED_LINK} />;
}
