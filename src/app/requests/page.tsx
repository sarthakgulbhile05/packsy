import Link from "next/link";
import { Suspense } from "react";
import { RequestShell, StatusChip } from "@/components/request/request-shell";
import { primaryButton } from "@/components/request/ui";
import { requireUser } from "@/lib/auth";
import { ACCOUNT_REQUESTS_OPEN } from "@/lib/preview";
import { REQUEST_COLUMNS, requestStatus, type RequestRow } from "@/lib/request-row";
import { NOINDEX } from "@/lib/site";

export const metadata = { title: "My requests", robots: NOINDEX };

export default function MyRequestsPage() {
  return (
    <RequestShell>
      <h1 className="font-[family-name:var(--font-display)] text-[1.75rem] leading-tight font-semibold text-[#101C35] sm:text-3xl">My requests</h1>
      {/* Reading the login cookie happens per request, so the list streams in behind Suspense. */}
      <Suspense fallback={<p className="mt-6 text-[#5B6B86]">Loading your requests…</p>}>
        <RequestList />
      </Suspense>
    </RequestShell>
  );
}

const startLink = (
  <Link href="/#start" className={`${primaryButton} mt-6`}>
    Start a request
  </Link>
);

async function RequestList() {
  const { supabase, user } = await requireUser("/requests");
  if (!ACCOUNT_REQUESTS_OPEN) {
    return (
      <div className="mt-6 rounded-2xl bg-[#FFF4E0] p-5 text-[#7A4D00]">
        <p>
          <strong>Saving requests to your account opens soon.</strong> During the preview, requests you confirm stay on the device you made them on.
        </p>
        {startLink}
      </div>
    );
  }

  // Others' published requests are readable too, so the list filters to the owner explicitly.
  const { data, error } = await supabase
    .from("requests")
    .select(REQUEST_COLUMNS)
    .eq("shopper_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<RequestRow[]>();
  if (error) {
    console.error("[requests] list failed", { code: error.code });
    return (
      <p role="alert" className="mt-6 text-[#B42318]">
        We couldn’t load your requests. Please refresh the page to try again.
      </p>
    );
  }
  if (!data.length) {
    return (
      <div className="mt-6 rounded-2xl border border-[#E3E8F0] bg-white p-6 text-center">
        <p className="font-semibold text-[#101C35]">No requests yet</p>
        <p className="mt-1 text-[#5B6B86]">Requests you save or publish appear here.</p>
        {startLink}
      </div>
    );
  }

  return (
    <ul className="mt-6 flex flex-col gap-3">
      {data.map((row) => {
        const status = requestStatus(row);
        return (
          <li key={row.id}>
            <Link
              href={`/requests/${row.id}`}
              className="block rounded-2xl border border-[#E3E8F0] bg-white p-4 hover:border-[#B8C5D9] focus-visible:ring-4 focus-visible:ring-[#20C7B5]/30 focus-visible:outline-none"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0 font-semibold break-words text-[#101C35]">{row.title}</span>
                <StatusChip label={status.label} />
              </span>
              <span className="mt-1 block text-sm text-[#5B6B86]">
                {row.delivery_city} · {status.detail || status.label}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
