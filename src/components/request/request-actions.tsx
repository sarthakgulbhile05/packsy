"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteRequest, publishRequest } from "@/app/request/actions";
import { saveDraft, type RequestDraft } from "@/lib/request-draft";
import { errorText, primaryButton, secondaryButton } from "./ui";

/** Edit, publish or delete the owner's draft. The server and database decide; these only ask. */
export function RequestActions({ draft }: { draft: RequestDraft & { id: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<{ ok: boolean; reason?: string }>, onDone: () => void) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (result.ok) onDone();
      else setError(result.reason ?? "Something went wrong. Please try again.");
    } catch {
      setError("We couldn’t reach Orbitly. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function edit() {
    if (!saveDraft(draft)) return setError("Your browser blocked opening the editor (private mode?). Allow site storage and try again.");
    router.push("/request/new");
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Delete this draft? This can’t be undone.")) run(() => deleteRequest(draft.id), () => router.push("/requests"));
          }}
          className={`${secondaryButton} h-14 text-[#B42318] sm:w-36`}
        >
          Delete
        </button>
        <button type="button" disabled={busy} onClick={edit} className={`${secondaryButton} h-14 sm:w-36`}>
          Edit
        </button>
        <button type="button" disabled={busy} aria-busy={busy} onClick={() => run(() => publishRequest(draft.id), () => router.refresh())} className={primaryButton}>
          {busy ? "Working…" : "Publish request"}
        </button>
      </div>
    </div>
  );
}
