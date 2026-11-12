"use client";

import Link from "next/link";
import { useActionState } from "react";
import { IconInput } from "@/components/auth/fields";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { Turnstile } from "@/components/turnstile";
import { requestPasswordReset } from "./actions";

const backLink = "font-semibold text-[#0F2C6B] transition-colors hover:text-[#2F7BEF]";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, {});

  // Sent: the form goes away, so it can't be resubmitted by accident.
  if (state.notice) {
    return (
      <div className="flex flex-col gap-6">
        <FormMessage notice={state.notice} />
        <Link href="/login" className={backLink}>
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage error={state.error} />
      <IconInput icon="mail" label="Email address" name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={state.email} />
      <Turnstile action="password_reset" resetKey={state} theme="light" size="flexible" appearance="interaction-only" />
      <div className="mt-2">
        <SubmitButton variant="brand" pendingText="Sending link…">
          Send reset link
        </SubmitButton>
      </div>
    </form>
  );
}
