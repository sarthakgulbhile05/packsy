import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Verified = Supabase Auth has a phone on the account and has confirmed it. Never from client input. */
export function isPhoneVerified(user: User): boolean {
  return Boolean(user.phone && user.phone_confirmed_at);
}

/**
 * The logged-in user, checked with Supabase Auth on every call (getUser), so a revoked
 * session or edited cookie is rejected. Server-only.
 */
export async function requireUser(returnTo = "/profile") {
  await connection(); // request time only: the Supabase client reads the clock, which Next won't allow while prerendering
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return { supabase, user };
}

/**
 * For pages and actions that need a verified phone. The database enforces the same rule
 * with RLS, so this is a convenience, not the security boundary.
 */
export async function requireVerifiedPhone(returnTo: string) {
  const ctx = await requireUser(returnTo);
  if (!isPhoneVerified(ctx.user)) redirect(`/verify-phone?next=${encodeURIComponent(returnTo)}`);
  return ctx;
}
