import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions, SESSION_ONLY_COOKIE } from "@/lib/supabase/session-cookie";

// Runs before every page request and refreshes the user's login cookie,
// so Server Components always see a valid session.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          // Keep "Remember me = off" sessions as browser-session cookies when refreshing.
          const sessionOnly = request.cookies.get(SESSION_ONLY_COOKIE)?.value === "1";
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, authCookieOptions(value, options, sessionOnly)),
          );
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Keep this call directly after createServerClient — it does the refresh.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
