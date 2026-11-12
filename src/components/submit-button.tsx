"use client";

import { useFormStatus } from "react-dom";

/** Disabled while its form is submitting, so a double click can't send twice. */
export function SubmitButton({
  children,
  pendingText,
  name,
  value,
  variant = "primary",
  disabled = false,
  formNoValidate,
}: {
  children: React.ReactNode;
  pendingText: string;
  name?: string;
  value?: string;
  variant?: "primary" | "secondary" | "brand";
  disabled?: boolean;
  /** Skip the browser's required-field check (e.g. "Resend code" with the code box empty). */
  formNoValidate?: boolean;
}) {
  const { pending, data } = useFormStatus();
  // In forms with several buttons, only the one that was clicked says what's happening.
  const clicked = pending && (!name || data?.get(name) === value);
  const style = {
    primary: "rounded p-2 bg-black text-white dark:bg-white dark:text-black",
    secondary: "rounded p-2 border border-gray-400",
    brand:
      "inline-flex h-[3.25rem] items-center justify-center gap-2 rounded-xl px-4 text-[1.05rem] font-semibold text-white bg-[#0F2C6B] shadow-[0_10px_24px_-14px_rgba(15,44,107,0.9)] transition-[background-color,transform] duration-200 hover:bg-[#163A85] active:translate-y-px active:bg-[#0C2558] focus-visible:ring-4 focus-visible:ring-[#2F7BEF]/35 focus-visible:outline-none",
  }[variant];

  return (
    <button
      type="submit"
      name={name}
      value={value}
      formNoValidate={formNoValidate}
      disabled={pending || disabled}
      aria-busy={clicked}
      className={`w-full disabled:cursor-not-allowed disabled:opacity-60 ${style}`}
    >
      {clicked && variant === "brand" && (
        <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" />
      )}
      {clicked ? pendingText : children}
    </button>
  );
}
