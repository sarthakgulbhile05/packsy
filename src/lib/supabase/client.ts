import { createBrowserClient } from "@supabase/ssr";

// Use in Client Components ("use client"). Unused today, and it can't see the session: auth cookies are
// httpOnly (see session-cookie.ts). Keep auth on the server, or revisit that before using this.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
