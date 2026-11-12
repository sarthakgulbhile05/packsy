import Link from "next/link";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetFromRequest } from "./reset-gate";
import { NOINDEX } from "@/lib/site";

export const metadata = { title: "Set a new password", description: "Choose a new password for your Orbitly account.", robots: NOINDEX };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a new password for your Orbitly account."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-[#0F2C6B] transition-colors hover:text-[#2F7BEF]">
            Log in
          </Link>
        </>
      }
    >
      {/* The recovery proof is read per request, so it streams in behind Suspense. */}
      <Suspense fallback={<p className="text-sm text-[#5B6B86]">Loading…</p>}>
        <ResetFromRequest />
      </Suspense>
    </AuthShell>
  );
}
