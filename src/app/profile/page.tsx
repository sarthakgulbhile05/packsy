import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/nav/site-header";
import { SubmitButton } from "@/components/submit-button";
import { isPhoneVerified, requireUser } from "@/lib/auth";
import { maskPhone } from "@/lib/phone";
import { ACCOUNT_REQUESTS_OPEN } from "@/lib/preview";
import { logout } from "./actions";
import { ProfileForm } from "./profile-form";
import { NOINDEX } from "@/lib/site";

export const metadata = { title: "Your profile", robots: NOINDEX };

export default function ProfilePage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
        <h1 className="text-2xl font-bold">Your profile</h1>
        {/* Reading the login cookie happens per request, so it streams in behind Suspense. */}
        <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          <ProfileDetails />
        </Suspense>
      </main>
    </div>
  );
}

async function ProfileDetails() {
  const { supabase, user } = await requireUser("/profile");
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();

  return (
    <>
      <p className="text-sm text-gray-600 dark:text-gray-400">Logged in as {user.email}</p>

      <section aria-label="Phone" className="rounded border border-gray-300 p-3 text-sm">
        {isPhoneVerified(user) ? (
          <p>
            <span className="font-medium text-green-700 dark:text-green-400">Phone verified</span> ·{" "}
            {maskPhone(user.phone!)}
          </p>
        ) : (
          <p>
            Phone not verified.{" "}
            <Link href="/verify-phone" className="underline">
              Verify your phone
            </Link>{" "}
            to post requests and make offers.
          </p>
        )}
        <p className="mt-1 text-xs text-gray-500">Only you can see this. Other users only see whether it&apos;s verified.</p>
      </section>

      {ACCOUNT_REQUESTS_OPEN && (
        <Link href="/requests" className="text-sm font-medium underline">
          My requests
        </Link>
      )}

      <ProfileForm fullName={profile?.full_name ?? ""} />

      <form action={logout}>
        <SubmitButton variant="secondary" pendingText="Logging out…">
          Log out
        </SubmitButton>
      </form>
    </>
  );
}
