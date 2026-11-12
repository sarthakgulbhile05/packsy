"use client";

import { useActionState } from "react";
import { GoogleButton, IconInput, OrDivider, PasswordInput } from "@/components/auth/fields";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { Turnstile } from "@/components/turnstile";
import { signup } from "./actions";

export function SignupForm() {
  const [state, action] = useActionState(signup, {});

  if (state.notice) return <FormMessage notice={state.notice} />;

  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-4">
        <FormMessage error={state.error} />
        <IconInput icon="user" label="Full name" name="full_name" maxLength={100} autoComplete="name" defaultValue={state.fullName} />
        <IconInput
          icon="mail"
          label="Email address"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          defaultValue={state.email}
        />
        <div className="flex flex-col gap-2">
          <PasswordInput
            id="signup-password"
            name="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            aria-describedby="password-hint"
          />
          <span id="password-hint" className="text-sm text-[#5B6B86]">
            At least 8 characters, with letters and numbers.
          </span>
        </div>
        <Turnstile action="signup" resetKey={state} theme="light" size="flexible" appearance="interaction-only" />
        <div className="mt-2">
          <SubmitButton variant="brand" pendingText="Creating account…">
            Create account
          </SubmitButton>
        </div>
      </form>
      <OrDivider />
      <GoogleButton />
    </div>
  );
}
