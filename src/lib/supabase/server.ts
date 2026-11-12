import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createBrowserlessClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { authCookieOptions, SESSION_ONLY_COOKIE } from "./session-cookie";

// Use in Server Components, Server Actions and Route Handlers.
// Create a new client per request — never share one between users.
// `sessionOnly` overrides the "Remember me" marker cookie (used by login itself).
export async function createClient({ sessionOnly }: { sessionOnly?: boolean } = {}) {
  const cookieStore = await cookies();
  const forgetOnClose = sessionOnly ?? cookieStore.get(SESSION_ONLY_COOKIE)?.value === "1";

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, authCookieOptions(value, options, forgetOnClose)),
            );
          } catch {
            // Server Components can't set cookies; the session-refresh proxy
            // (added with login in Milestone 2) handles that instead.
          }
        },
      },
    },
  );
}

/** No login cookie: a session this client receives stays in it, for calls that must not replace the signed-in user. */
export function createStatelessClient() {
  return createBrowserlessClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
