"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState } from "react";
import { LogoutButton } from "./logout-button";
import type { HeaderAccount, NavLink } from "./nav-items";
import { useDismiss } from "./use-dismiss";
import { VerificationBadge } from "./verification-badge";

const itemClass =
  "flex h-11 w-full items-center gap-2 rounded-control px-3 text-left text-[0.95rem] font-medium text-ink hover:bg-mist hover:text-navy focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none";

/** Desktop account dropdown (a disclosure: Tab moves through the items, Escape closes). */
export function AccountMenu({ account, links }: { account: HeaderAccount; links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useDismiss(open, close, wrapper, button);

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-full border border-line-strong bg-white pr-3 pl-1 text-sm font-semibold text-navy hover:border-navy focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none"
      >
        <Initial email={account.email} />
        Account
        <Chevron open={open} />
      </button>
      {open && (
        <div id={panelId} className="absolute top-full right-0 z-50 mt-2 w-72 rounded-card border border-line bg-white p-2 shadow-raised">
          <div className="border-b border-line px-3 pt-2 pb-3">
            <p className="truncate text-sm text-muted" title={account.email}>
              {account.email}
            </p>
            <div className="mt-2">
              <VerificationBadge verified={account.phoneVerified} onNavigate={close} />
            </div>
          </div>
          <ul className="py-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={close} className={itemClass}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-line pt-2">
            <LogoutButton className={itemClass} />
          </div>
        </div>
      )}
    </div>
  );
}

export function Initial({ email }: { email: string }) {
  return (
    <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-teal-soft text-sm font-semibold text-teal-ink uppercase">
      {email.slice(0, 1) || "·"}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`size-4 text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}
