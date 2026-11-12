"use client";

import { useId, useState } from "react";

// Light form styling from the reference: white fields, soft grey border, navy focus.
// 16px text so phones don't zoom in on focus.
export const inputClass =
  "h-[3.25rem] w-full rounded-xl border border-[#D6DEEA] bg-white pr-4 pl-12 text-base text-[#0F1F3D] placeholder:text-[#7D8AA3] transition-[border-color,box-shadow] duration-200 hover:border-[#B8C5D9] focus-visible:border-[#0F2C6B] focus-visible:ring-4 focus-visible:ring-[#2F7BEF]/15 focus-visible:outline-none";

/** Input with a left outline icon. The label is visually hidden: the placeholder is the visible hint. */
export function IconInput({
  icon,
  label,
  ...props
}: { icon: "mail" | "user"; label: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "className">) {
  const fallbackId = useId();
  const id = props.id ?? fallbackId;
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <FieldIcon name={icon} />
      <input {...props} id={id} placeholder={props.placeholder ?? label} className={inputClass} />
    </div>
  );
}

/** Password field with a lock icon and a Show/Hide (eye) toggle. */
export function PasswordInput({
  label = "Password",
  ...props
}: { label?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className">) {
  const [visible, setVisible] = useState(false);
  const fallbackId = useId();
  const id = props.id ?? fallbackId;
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <FieldIcon name="lock" />
      <input {...props} id={id} type={visible ? "text" : "password"} placeholder={props.placeholder ?? label} className={`${inputClass} pr-12`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-controls={id}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-1.5 right-1.5 grid w-10 place-items-center rounded-lg text-[#5B6B86] transition-colors hover:bg-[#F1F4F9] hover:text-[#0F2C6B] focus-visible:ring-2 focus-visible:ring-[#2F7BEF] focus-visible:outline-none"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </div>
  );
}

/** Square checkbox, navy when ticked (native input, so keyboard and screen readers work as usual). */
export function Checkbox({ label, ...props }: { label: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className">) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-[0.95rem] text-[#33415C] select-none">
      <span className="relative grid size-5 place-items-center">
        <input
          {...props}
          type="checkbox"
          className="peer size-5 cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-[#B8C5D9] bg-white transition-colors checked:border-[#0F2C6B] checked:bg-[#0F2C6B] focus-visible:ring-4 focus-visible:ring-[#2F7BEF]/25 focus-visible:outline-none"
        />
        <svg viewBox="0 0 16 16" className="pointer-events-none absolute size-3.5 text-white opacity-0 peer-checked:opacity-100" aria-hidden="true">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {label}
    </label>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-4 px-[20%] text-sm text-[#5B6B86]" role="separator" aria-label="or">
      <span className="h-px flex-1 bg-[#E3E8F0]" />
      or
      <span className="h-px flex-1 bg-[#E3E8F0]" />
    </div>
  );
}

/** Google sign-in isn't configured yet, so the button is shown but honestly disabled. */
export function GoogleButton() {
  return (
    <button
      type="button"
      disabled
      aria-describedby="google-soon"
      className="flex h-[3.25rem] w-full cursor-not-allowed items-center justify-center gap-3 rounded-xl border border-[#D6DEEA] bg-white text-[0.98rem] font-semibold text-[#1B2B4B]"
    >
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3Z" />
        <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
      </svg>
      Continue with Google
      <span id="google-soon" className="rounded-full bg-[#F1F4F9] px-2 py-0.5 text-[0.7rem] font-medium text-[#5B6B86]">
        Coming soon
      </span>
    </button>
  );
}

function FieldIcon({ name }: { name: "mail" | "lock" | "user" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-[#5B6B86]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "mail" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="m3.5 6.5 8.5 6 8.5-6" />
        </>
      )}
      {name === "lock" && (
        <>
          <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
          <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        </>
      )}
      {name === "user" && (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20.5c1-3.8 4-5.5 7.5-5.5s6.5 1.7 7.5 5.5" />
        </>
      )}
    </svg>
  );
}
