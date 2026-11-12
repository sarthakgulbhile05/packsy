"use client";

import { useActionState, useEffect, useState } from "react";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { Turnstile } from "@/components/turnstile";
import { PHONE_COUNTRIES, RESEND_COOLDOWN_SECONDS } from "@/lib/phone";
import { phoneAction, type PhoneState } from "./actions";

const input = "rounded border border-gray-300 p-2";

export function VerifyPhoneForm({ next, initial }: { next: string; initial: PhoneState }) {
  const [state, action] = useActionState(phoneAction, initial);
  const secondsLeft = useCountdown(state.sentAt);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage error={state.error} notice={state.notice} />
      <input type="hidden" name="next" value={next} />

      {state.step === "phone" ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Country
            <select name="country" defaultValue={state.country ?? "IN"} className={input}>
              {PHONE_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} (+{c.dial})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Mobile number
            <input
              name="phone"
              type="tel"
              required
              maxLength={30}
              autoComplete="tel-national"
              inputMode="tel"
              placeholder="98765 43210"
              className={input}
            />
          </label>
          <Turnstile action="phone" resetKey={state} />
          <SubmitButton name="intent" value="send" pendingText="Sending code…">
            Send code
          </SubmitButton>
        </>
      ) : (
        <>
          <p className="text-sm">
            Enter the code sent to <strong>{state.maskedPhone}</strong>.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            6-digit code
            <input
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              className={`${input} tracking-widest`}
            />
          </label>
          <SubmitButton name="intent" value="verify" pendingText="Checking…">
            Verify
          </SubmitButton>
          <Turnstile action="phone" resetKey={state} />
          <SubmitButton
            name="intent"
            value="resend"
            variant="secondary"
            pendingText="Please wait…"
            disabled={secondsLeft > 0}
            formNoValidate
          >
            {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
          </SubmitButton>
          <button type="submit" name="intent" value="change" formNoValidate className="text-sm underline">
            Use a different number
          </button>
        </>
      )}
    </form>
  );
}

/** Seconds until another code may be requested, ticking down once per second. */
function useCountdown(sentAt: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sentAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sentAt]);
  if (!sentAt) return 0;
  return Math.max(0, Math.ceil((sentAt + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000));
}
