import Link from "next/link";
import { SiteHeader } from "@/components/nav/site-header";
import { ReviewFlow } from "@/components/request/review-flow";
import { buttonClass } from "@/components/ui/button";
import { NOINDEX } from "@/lib/site";

export const metadata = { title: "Your request", robots: NOINDEX };

export default function NewRequestPage() {
  return (
    <div className="flex flex-1 flex-col bg-mist font-sans text-navy">
      <SiteHeader
        action={
          // Same as before the shared header: leaves for the home page; the draft stays in this tab.
          <Link href="/" className={buttonClass({ variant: "ghost", size: "sm" })}>
            Cancel
          </Link>
        }
      />
      <main className="flex-1 px-5 py-6 sm:py-10">
        <ReviewFlow />
      </main>
    </div>
  );
}
