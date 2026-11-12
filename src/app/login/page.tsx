import Link from "next/link";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { safeNext } from "@/lib/redirect";
import { LoginForm } from "./login-form";
import { NOINDEX } from "@/lib/site";

export const metadata = { title: "Log in", description: "Log in to your Orbitly account.", robots: NOINDEX };

// Only these fixed messages can be shown from the URL, so a link can't put arbitrary text on the page.
const LINK_ERRORS: Record<string, string> = {
  link_other_browser:
    "This email link can’t be used here. It works only once, and only in the browser where you asked for it. Open it there, or request a new link.",
  link_invalid:
    "That email link is invalid or has expired. Try logging in. For a password reset, request a new link with “Forgot password?”; for sign-up, sign up again.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthShell
      title="Welcome Back"
      subtitle="Sign in to continue your journey"
      footer={
        <>
          Don’t have an account?{" "}
          <Link href="/signup" className="font-semibold text-[#0F2C6B] transition-colors hover:text-[#2F7BEF]">
            Sign up
          </Link>
        </>
      }
    >
      {/* Reading the URL happens per request, so it streams in behind Suspense. */}
      {/* min-height ≈ the form, so the page doesn’t jump when it streams in */}
      <Suspense fallback={<p className="min-h-[24rem] text-sm text-[#5B6B86]">Loading…</p>}>
        <LoginFormFromUrl searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

// After a password reset (fixed messages, same rule as above).
const RESET_NOTICES: Record<string, { success?: string; notice?: string }> = {
  done: { success: "Your password was updated. Log in with your new password." },
  signout_failed: {
    notice:
      "Your password was updated, but we couldn’t sign you out on your other devices. Log in with your new password; if you think someone else has access, reset it again.",
  },
};

async function LoginFormFromUrl({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next, error, reset } = await searchParams;
  return (
    <LoginForm
      next={safeNext(next)}
      linkError={typeof error === "string" ? LINK_ERRORS[error] : undefined}
      resetNotice={typeof reset === "string" ? RESET_NOTICES[reset] : undefined}
    />
  );
}
