import Link from "next/link";
import { Badge } from "@/components/ui/badge";

/** Phone status for the account menus; unverified users get a direct link to fix it. */
export function VerificationBadge({ verified, onNavigate }: { verified: boolean; onNavigate?: () => void }) {
  if (verified) return <Badge tone="success">Phone verified</Badge>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone="warning">Phone not verified</Badge>
      <Link href="/verify-phone" onClick={onNavigate} className="rounded text-sm font-semibold text-teal-ink underline underline-offset-2 focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none">
        Verify now
      </Link>
    </span>
  );
}
