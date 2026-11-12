"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireUser, requireVerifiedPhone } from "@/lib/auth";
import { fetchLinkPreview, type PreviewResult } from "@/lib/link-preview";
import { runLifecycleStep, type ActionResult } from "@/lib/marketplace-lifecycle";
import { ACCOUNT_REQUESTS_OPEN } from "@/lib/preview";
import { createLimiter } from "@/lib/rate-limit";
import type { DraftErrors } from "@/lib/request-draft";
import { draftToRow, isRequestId } from "@/lib/request-row";
import { normalizeUrl } from "@/lib/url";

// 8 previews a minute per visitor, 120 a minute and 4 at once for the whole server process.
const limit = createLimiter({ perKey: 8, global: 120, windowMs: 60_000, maxInFlight: 4 });

/** Reads a product page's public title, image and description to prefill a request. */
export async function previewLink(url: unknown): Promise<PreviewResult> {
  if (typeof url !== "string" || url.length > 2048) return { ok: false, status: "failed", reason: "Paste a product link." };
  if (!normalizeUrl(url)) return { ok: false, status: "failed", reason: "That doesn’t look like a web link. Check it, or describe the item instead." };

  // shortcut: x-forwarded-for is only trustworthy behind a proxy that overwrites it (Vercel does); self-hosting needs that proxy.
  const h = await headers();
  const visitor = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const result = await limit(visitor, () => fetchLinkPreview(url));
  if ("value" in result) return result.value;
  return {
    ok: false,
    status: "failed",
    code: "rate_limited",
    reason:
      result.limited === "rate"
        ? "You’ve checked a lot of links in a short time. Please wait a minute and try again, or describe the item instead."
        : "Link checking is busy right now. Please try again in a moment, or describe the item instead.",
  };
}

// --- Requests saved to the buyer's account. The database's row rules (stage 3a) are the boundary;
// these checks only give clear answers. Every write is scoped to the signed-in owner.

export type RequestActionResult =
  | { ok: true; id: string; expiresAt?: string; photoLeftOnDevice?: boolean }
  | { ok: false; reason: string; errors?: DraftErrors };

const CLOSED: RequestActionResult = { ok: false, reason: "Saving requests to your account opens soon. For now, requests stay on this device." };
const FAILED = "We couldn’t save that. Please try again in a moment.";
const NOT_YOURS = "That request isn’t available. It may have been published or deleted.";

// 10 changes a minute per buyer, 300 a minute and 20 at once for the server process.
const writeLimit = createLimiter({ perKey: 10, global: 300, windowMs: 60_000, maxInFlight: 20 });
const limited = (r: { limited: "rate" | "busy" }): RequestActionResult => ({
  ok: false,
  reason: r.limited === "rate" ? "That’s a lot of changes in a short time. Please wait a minute and try again." : "Orbitly is busy right now. Please try again in a moment.",
});

/** Saves a new draft, or updates the caller's own draft when `id` is given. Never publishes. */
export async function saveRequest(input: unknown, id?: unknown): Promise<RequestActionResult> {
  if (!ACCOUNT_REQUESTS_OPEN) return CLOSED;
  if (id !== undefined && !isRequestId(id)) return { ok: false, reason: NOT_YOURS };
  const mapped = draftToRow(input);
  if (!mapped.ok) return { ok: false, reason: "Please check the highlighted details.", errors: mapped.errors };
  const { supabase, user } = await requireVerifiedPhone("/request/new");

  const result = await writeLimit(user.id, async () => {
    const query = id
      ? supabase.from("requests").update(mapped.row).eq("id", id).eq("shopper_id", user.id).select("id")
      : supabase.from("requests").insert(mapped.row).select("id");
    const { data, error } = await query;
    if (error) {
      console.error("[requests] save failed", { code: error.code });
      return { ok: false, reason: error.code === "23514" ? "Some details aren’t valid. Please check them and try again." : FAILED } as const;
    }
    if (!data?.length) return { ok: false, reason: NOT_YOURS } as const;
    return { ok: true, id: data[0].id as string, photoLeftOnDevice: mapped.photoLeftOnDevice } as const;
  });
  if (!("value" in result)) return limited(result);
  if (result.value.ok) revalidatePath("/requests");
  return result.value;
}

// publish_request's own messages are fixed strings in our SQL; map them, never echo raw errors.
const PUBLISH_ERRORS: [RegExp, string][] = [
  [/Verify your phone/, "Verify your phone number before publishing."],
  [/Only drafts/, "This request is already published or closed."],
  [/needed-by date has passed/, "The “needed by” date has passed. Edit the request and choose a new date."],
  [/image storage/, "Requests with your own photo can’t be published yet. Remove the photo or describe the item."],
];

/** Publishes the caller's own draft through the database function, which re-checks everything. */
export async function publishRequest(id: unknown): Promise<RequestActionResult> {
  if (!ACCOUNT_REQUESTS_OPEN) return CLOSED;
  if (!isRequestId(id)) return { ok: false, reason: NOT_YOURS };
  const { supabase, user } = await requireVerifiedPhone(`/requests/${id}`);

  const result = await writeLimit(user.id, async () => {
    const { data, error } = await supabase.rpc("publish_request", { p_request_id: id });
    if (error) {
      console.error("[requests] publish failed", { code: error.code });
      const known = PUBLISH_ERRORS.find(([pattern]) => pattern.test(error.message ?? ""));
      return { ok: false, reason: known?.[1] ?? (error.code === "42501" ? NOT_YOURS : "We couldn’t publish that. Please try again in a moment.") } as const;
    }
    return { ok: true, id, expiresAt: String(data) } as const;
  });
  if (!("value" in result)) return limited(result);
  if (result.value.ok) revalidatePath("/requests");
  return result.value;
}

/** Deletes the caller's own draft. Published requests can't be deleted (the database refuses). */
export async function deleteRequest(id: unknown): Promise<RequestActionResult> {
  if (!ACCOUNT_REQUESTS_OPEN) return CLOSED;
  if (!isRequestId(id)) return { ok: false, reason: NOT_YOURS };
  const { supabase, user } = await requireUser(`/requests/${id}`);

  const result = await writeLimit(user.id, async () => {
    const { data, error } = await supabase.from("requests").delete().eq("id", id).eq("shopper_id", user.id).select("id");
    if (error) {
      console.error("[requests] delete failed", { code: error.code });
      return { ok: false, reason: "We couldn’t delete that. Please try again in a moment." } as const;
    }
    if (!data?.length) return { ok: false, reason: "Only drafts can be deleted." } as const;
    return { ok: true, id } as const;
  });
  if (!("value" in result)) return limited(result);
  if (result.value.ok) revalidatePath("/requests");
  return result.value;
}

// --- Marketplace steps for the buyer (stage 4). Each is one database function that re-checks the owner.

/** Accepts one pending offer on the caller's open request; other pending offers close. */
export async function acceptOffer(offerId: unknown, requestId: unknown): Promise<ActionResult> {
  return runLifecycleStep("accept_offer", offerId, isRequestId(requestId) ? `/requests/${requestId}` : "/requests");
}

export async function declineOffer(offerId: unknown, requestId: unknown): Promise<ActionResult> {
  return runLifecycleStep("decline_offer", offerId, isRequestId(requestId) ? `/requests/${requestId}` : "/requests");
}

/** Cancels the caller's own open or matched request. */
export async function cancelRequest(id: unknown): Promise<ActionResult> {
  return runLifecycleStep("cancel_request", id, isRequestId(id) ? `/requests/${id}` : "/requests");
}

/** The buyer confirms they received the item. */
export async function completeRequest(id: unknown): Promise<ActionResult> {
  return runLifecycleStep("complete_request", id, isRequestId(id) ? `/requests/${id}` : "/requests");
}
