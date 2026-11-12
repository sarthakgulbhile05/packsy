"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import type { ActionResult } from "@/lib/marketplace-lifecycle";

/** One lifecycle step (accept, decline, withdraw, cancel, complete). The server and database decide. */
export function ActionButton({
  action,
  children,
  busyText,
  confirm,
  variant = "secondary",
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  busyText: string;
  confirm?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.reason);
    } catch {
      setError("We couldn’t reach Orbitly. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={run} disabled={busy} aria-busy={busy} className={buttonClass({ variant, size: "sm" })}>
        {busy ? busyText : children}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
