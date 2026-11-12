import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RequestMarketplace } from "@/components/marketplace/request-marketplace";
import { RequestActions } from "@/components/request/request-actions";
import { RequestShell, StatusChip } from "@/components/request/request-shell";
import { Summary } from "@/components/request/review-flow";
import { requireUser } from "@/lib/auth";
import { ACCOUNT_REQUESTS_OPEN, MARKETPLACE_OPEN } from "@/lib/preview";
import { isRequestId, REQUEST_COLUMNS, requestStatus, rowToDraft, type RequestRow } from "@/lib/request-row";
import { NOINDEX } from "@/lib/site";

export const metadata = { title: "Request details", robots: NOINDEX };

export default function RequestPage({ params }: PageProps<"/requests/[id]">) {
  return (
    <RequestShell>
      <Suspense fallback={<p className="text-[#5B6B86]">Loading your request…</p>}>
        <RequestDetail params={params} />
      </Suspense>
    </RequestShell>
  );
}

async function RequestDetail({ params }: Pick<PageProps<"/requests/[id]">, "params">) {
  const { id } = await params;
  if (!isRequestId(id)) notFound();
  const { supabase, user } = await requireUser(`/requests/${id}`);
  if (!ACCOUNT_REQUESTS_OPEN) notFound();

  // Owner filter as well as the database rules: this page manages your own request only.
  const { data, error } = await supabase
    .from("requests")
    .select(REQUEST_COLUMNS)
    .eq("id", id)
    .eq("shopper_id", user.id)
    .returns<RequestRow[]>()
    .maybeSingle();
  if (error) {
    console.error("[requests] read failed", { code: error.code });
    return (
      <p role="alert" className="text-[#B42318]">
        We couldn’t load this request. Please refresh the page to try again.
      </p>
    );
  }
  if (!data) notFound();

  const status = requestStatus(data);
  const draft = { ...rowToDraft(data), id: data.id };
  return (
    <>
      <Link href="/requests" className="text-sm font-semibold text-[#0F7A6E] underline">
        ← My requests
      </Link>
      <div className="mt-3 mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl leading-tight font-semibold text-[#101C35]">Your request</h1>
          <p className="mt-1 text-[#5B6B86]">{status.detail}</p>
        </div>
        <StatusChip label={status.label} />
      </div>
      <Summary draft={draft} />
      {data.status === "draft" && <RequestActions draft={draft} />}
      {MARKETPLACE_OPEN && data.status !== "draft" && <RequestMarketplace request={data} supabase={supabase} />}
    </>
  );
}
