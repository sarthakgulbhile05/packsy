"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { updateProfile } from "./actions";

export function ProfileForm({ fullName }: { fullName: string }) {
  const [state, action] = useActionState(updateProfile, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      {/* The only notice this action returns is "Saved.", so it's shown as a success. */}
      <FormMessage error={state.error} success={state.notice} />
      <label className="flex flex-col gap-1 text-sm">
        Full name
        <input
          name="full_name"
          maxLength={100}
          defaultValue={fullName}
          autoComplete="name"
          className="rounded border border-gray-300 p-2"
        />
      </label>
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
