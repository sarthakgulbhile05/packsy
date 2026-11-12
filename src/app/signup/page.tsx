import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SIGNUPS_CLOSED, SIGNUPS_OPEN } from "@/lib/preview";
import { SignupForm } from "./signup-form";
import { NOINDEX } from "@/lib/site";

export const metadata = {
  title: SIGNUPS_OPEN ? "Create account" : "Accounts open soon",
  description: "Create an Orbitly account to request products from abroad.",
  robots: NOINDEX,
};

export default function SignupPage() {
  return (
    <AuthShell
      title={SIGNUPS_OPEN ? "Create Account" : "Accounts open soon"}
      subtitle="Request things from another country, or carry them on trips you’re already taking"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-[#0F2C6B] transition-colors hover:text-[#2F7BEF]">
            Sign in
          </Link>
        </>
      }
    >
      {SIGNUPS_OPEN ? (
        <SignupForm />
      ) : (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-[#5B6B86]">
            {SIGNUPS_CLOSED} You can still try a request on the home page: it stays on your device.
          </p>
          <Link
            href="/#start"
            className="inline-flex h-[3.25rem] items-center justify-center rounded-xl bg-[#0F2C6B] px-4 text-[1.05rem] font-semibold text-white shadow-[0_10px_24px_-14px_rgba(15,44,107,0.9)] hover:bg-[#163A85] focus-visible:ring-4 focus-visible:ring-[#2F7BEF]/35 focus-visible:outline-none"
          >
            Try a request
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
