import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SiteHeader } from "@/components/nav/site-header";
import { isPhoneVerified, requireUser } from "@/lib/auth";
import { maskPhone } from "@/lib/phone";
import { safeNext } from "@/lib/redirect";
import { VerifyPhoneForm } from "./verify-phone-form";
import { NOINDEX } from "@/lib/site";

export const metadata = { title: "Verify your phone", robots: NOINDEX };

export default function VerifyPhonePage({ searchParams }: PageProps<"/verify-phone">) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
        <h1 className="text-2xl font-bold">Verify your phone</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Orbitly needs a verified mobile number before you can post requests or make offers. We never show
          your number on your profile.
        </p>
        {/* Reading the login cookie happens per request, so it streams in behind Suspense. */}
        <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          <VerifyPhoneFromSession searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function VerifyPhoneFromSession({ searchParams }: Pick<PageProps<"/verify-phone">, "searchParams">) {
  const { next } = await searchParams;
  const returnTo = safeNext(next); // never /verify-phone itself, so this can't loop
  const { user } = await requireUser("/profile");
  if (isPhoneVerified(user)) redirect(returnTo);

  // A code already requested (e.g. page reloaded) continues at the code step.
  const initial = user.new_phone
    ? { step: "code" as const, maskedPhone: maskPhone(user.new_phone) }
    : { step: "phone" as const };
  return <VerifyPhoneForm next={returnTo} initial={initial} />;
}
