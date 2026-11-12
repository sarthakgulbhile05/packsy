import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { OrbitlyLogo } from "@/components/brand/orbitly-logo";
import { buttonClass } from "@/components/ui/button";
import { isPhoneVerified } from "@/lib/auth";
import { ACCOUNT_REQUESTS_OPEN, MARKETPLACE_OPEN } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";
import { AccountMenu } from "./account-menu";
import { MobileMenu } from "./mobile-menu";
import { accountLinks, SIGNED_OUT_LINKS, type HeaderAccount } from "./nav-items";

/** The header on every app page: logo, then account actions that depend on who's signed in. */
export function SiteHeader({ action }: { action?: React.ReactNode }) {
  return (
    <header className="relative z-40 border-b border-line bg-white">
      {/* The logo artwork is stacked (916×776), so it sets the bar height: 70px wide ≈ 59px tall. */}
      <div className="mx-auto flex h-[4.5rem] w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <OrbitlyLogo className="w-[70px]" />
        <div className="flex items-center gap-1 sm:gap-2">
          {/* A page's own exit (e.g. Cancel in the request flow), before the account actions. */}
          {action}
          {/* The session is read per request, so only this part streams in; the rest is in the static shell. */}
          <Suspense fallback={<span aria-hidden="true" className="h-10 w-24" />}>
            <HeaderActions />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function currentAccount(): Promise<HeaderAccount | null> {
  await connection(); // request time only: the Supabase client reads the clock, which Next won't allow while prerendering
  // Outside the try: reading cookies must never be caught, so Next can defer this part to request time.
  const supabase = await createClient();
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? { email: user.email ?? "", phoneVerified: isPhoneVerified(user) } : null;
  } catch {
    return null; // Header only: if Supabase is unreachable, show the signed-out actions rather than break the page.
  }
}

async function HeaderActions() {
  const account = await currentAccount();
  const links = account ? accountLinks(ACCOUNT_REQUESTS_OPEN, MARKETPLACE_OPEN) : SIGNED_OUT_LINKS;
  const textLink = "rounded-control px-3 py-2 text-sm font-semibold text-muted hover:text-navy focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none";

  return (
    <>
      <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
        {account ? (
          <>
            {ACCOUNT_REQUESTS_OPEN && (
              <Link href="/requests" className={textLink}>
                My requests
              </Link>
            )}
            <AccountMenu account={account} links={links} />
          </>
        ) : (
          <>
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={textLink}>
                {l.label}
              </Link>
            ))}
            <Link href="/login" className={buttonClass({ variant: "ghost", size: "sm" })}>
              Log in
            </Link>
            <Link href="/signup" className={buttonClass({ size: "sm" })}>
              Sign up
            </Link>
          </>
        )}
      </nav>
      <nav aria-label="Main" className="lg:hidden">
        <MobileMenu account={account} links={links} />
      </nav>
    </>
  );
}
