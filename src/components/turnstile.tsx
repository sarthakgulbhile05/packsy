"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { TurnstileAction } from "@/lib/turnstile";

type TurnstileApi = {
  render(
    el: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
      appearance?: "always" | "interaction-only";
    },
  ): string;
  reset(id: string): void;
  remove(id: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Cloudflare Turnstile widget. It adds a hidden "cf-turnstile-response" field to the
 * surrounding form; the server checks it. A token works once, so the widget resets
 * whenever `resetKey` changes (pass the form's result state).
 */
export function Turnstile({
  action,
  resetKey,
  theme = "auto",
  size = "normal",
  appearance = "always",
}: {
  /** Must match the server's verifyTurnstile action for this form. */
  action: TurnstileAction;
  resetKey?: unknown;
  theme?: "auto" | "light" | "dark";
  /** "flexible" fills the form's width (min 300px). */
  size?: "normal" | "flexible";
  /** "interaction-only": invisible unless Cloudflare needs the visitor to click. Still verified server-side. */
  appearance?: "always" | "interaction-only";
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ready || !siteKey || !container.current || !window.turnstile) return;
    // "flexible" needs at least 300px; very narrow phones get the compact widget instead.
    const fit = size === "flexible" && container.current.offsetWidth < 300 ? "compact" : size;
    const id = window.turnstile.render(container.current, { sitekey: siteKey, action, theme, size: fit, appearance });
    widgetId.current = id;
    return () => {
      window.turnstile?.remove(id);
      widgetId.current = null;
    };
  }, [ready, siteKey, action, theme, size, appearance]);

  useEffect(() => {
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, [resetKey]);

  // Some blocks cancel the script without an error event, so also give up after 10 s.
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setFailed(true), 10_000);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!siteKey) {
    return (
      <p role="alert" className="text-sm text-red-700">
        The security check isn&apos;t configured, so this form can&apos;t be sent.
      </p>
    );
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => setReady(true)}
        onError={() => setFailed(true)}
      />
      {/* Without the script there's no token and the server rejects the form, so say why. */}
      {failed && !ready && (
        <p role="alert" className="rounded-xl bg-red-100 p-3 text-sm text-red-900">
          The security check couldn&apos;t load. Check your connection or allow challenges.cloudflare.com in any
          content blocker, then reload the page.
        </p>
      )}
      <div ref={container} className={appearance === "always" ? "min-h-[65px]" : "empty:hidden"} />
    </>
  );
}
