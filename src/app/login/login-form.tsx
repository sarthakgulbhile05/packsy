"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Checkbox, GoogleButton, IconInput, OrDivider, PasswordInput } from "@/components/auth/fields";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { Turnstile } from "@/components/turnstile";
import { login } from "./actions";

export function LoginForm({
  next,
  linkError,
  resetNotice,
}: {
  next: string;
  linkError?: string;
  resetNotice?: { success?: string; notice?: string };
}) {
  const [state, action] = useActionState(login, { error: linkError });

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <form action={action} className="flex flex-col gap-4">
        {/* A login error replaces the post-reset message. */}
        <FormMessage error={state.error} success={state.error ? undefined : resetNotice?.success} notice={state.error ? undefined : resetNotice?.notice} />
        <input type="hidden" name="next" value={next} />
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
        <PasswordInput id="login-password" name="password" required maxLength={72} autoComplete="current-password" />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <Checkbox name="remember" label="Remember me" />
          <Link href="/forgot-password" className="rounded text-[0.95rem] font-medium text-[#1F5FD0] transition-colors hover:text-[#0F2C6B] focus-visible:ring-4 focus-visible:ring-[#2F7BEF]/35 focus-visible:outline-none">
            Forgot password?
          </Link>
        </div>
        <Turnstile action="login" resetKey={state} theme="light" size="flexible" appearance="interaction-only" />
        <div className="mt-1 sm:mt-2">
          <SubmitButton variant="brand" pendingText="Signing in…">
            Sign in
          </SubmitButton>
        </div>
      </form>
      <OrDivider />
      <GoogleButton />
    </div>
  );
}
