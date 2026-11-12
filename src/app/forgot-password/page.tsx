import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";
import { NOINDEX } from "@/lib/site";

export const metadata = { title: "Reset your password", description: "Get a link to reset your Orbitly password.", robots: NOINDEX };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your account’s email and we’ll send you a link to set a new password."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-[#0F2C6B] transition-colors hover:text-[#2F7BEF]">
            Log in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
