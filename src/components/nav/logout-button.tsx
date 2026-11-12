"use client";

import { useFormStatus } from "react-dom";
import { logout } from "@/app/profile/actions";
import { Spinner } from "@/components/ui/spinner";

function Submit({ className }: { className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={className}>
      {pending && <Spinner />}
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}

/** The existing logout server action, as a menu item. */
export function LogoutButton({ className }: { className: string }) {
  return (
    <form action={logout}>
      <Submit className={className} />
    </form>
  );
}
