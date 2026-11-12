"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { LogoutButton } from "./logout-button";
import type { HeaderAccount, NavLink } from "./nav-items";
import { useDismiss } from "./use-dismiss";
import { VerificationBadge } from "./verification-badge";

const rowClass =
  "flex h-12 w-full items-center rounded-control px-3 text-left text-base font-medium text-ink hover:bg-mist hover:text-navy focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none";

/** Phone-sized menu: one button that opens a full-width panel under the header with every destination. */
export function MobileMenu({ account, links }: { account: HeaderAccount | null; links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useDismiss(open, close, wrapper, button);

  return (
    <div ref={wrapper}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-navy hover:bg-mist focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <div id={panelId} className="absolute inset-x-0 top-full z-50 border-b border-line bg-white px-5 pt-3 pb-5 shadow-raised">
          {account && (
            <div className="border-b border-line pb-3">
              <p className="truncate text-sm text-muted">{account.email}</p>
              <div className="mt-2">
                <VerificationBadge verified={account.phoneVerified} onNavigate={close} />
              </div>
            </div>
          )}
          <ul className="py-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={close} className={rowClass}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          {account ? (
            <div className="border-t border-line pt-2">
              <LogoutButton className={rowClass} />
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-3 border-t border-line pt-4">
              <Link href="/login" onClick={close} className={buttonClass({ variant: "secondary", full: true })}>
                Log in
              </Link>
              <Link href="/signup" onClick={close} className={buttonClass({ full: true })}>
                Sign up
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
