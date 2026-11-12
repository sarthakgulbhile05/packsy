"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { PasswordInput } from "@/components/auth/fields";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { resetPassword } from "./actions";

const linkClass = "font-semibold text-[#0F2C6B] transition-colors hover:text-[#2F7BEF]";

/** What to show when the link can't be used: why, and the one next step. */
export function ExpiredLink({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-6">
      <FormMessage error={message} />
      <Link href="/forgot-password" className={linkClass}>
        Request a new reset link
      </Link>
    </div>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPassword, {});
  const [mismatch, setMismatch] = useState("");

  if (state.expired && state.error) return <ExpiredLink message={state.error} />;

  return (
    <form
      action={action}
      // Usability only: the server checks the rules and the match again.
      onSubmit={(e) => {
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("confirm")) {
          e.preventDefault();
          setMismatch("The two passwords don’t match.");
        } else setMismatch("");
      }}
      className="flex flex-col gap-4"
    >
      <FormMessage error={mismatch || state.error} />
      <div className="flex flex-col gap-2">
        <PasswordInput
          id="new-password"
          name="password"
          label="New password"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          aria-describedby="password-rules"
        />
        <span id="password-rules" className="text-sm text-[#5B6B86]">
          At least 8 characters, with letters and numbers.
        </span>
      </div>
      <PasswordInput id="confirm-password" name="confirm" label="Confirm new password" required minLength={8} maxLength={72} autoComplete="new-password" />
      <div className="mt-2">
        <SubmitButton variant="brand" pendingText="Updating password…">
          Update password
        </SubmitButton>
      </div>
    </form>
  );
}
