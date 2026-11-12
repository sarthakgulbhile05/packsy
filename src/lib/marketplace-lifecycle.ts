import "server-only";
import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { MARKETPLACE_OPEN } from "./preview";
import { PRICING_POLICY } from "./pricing";
import { createLimiter } from "./rate-limit";
import { isRequestId } from "./request-row";

// Server-only (never a server action itself, so the function name can't come from a browser). Each lifecycle
// step is one database function that locks the row and checks who is asking; this only maps the answers.

export type ActionResult = { ok: true } | { ok: false; reason: string };
export type LifecycleStep = "accept_offer" | "decline_offer" | "withdraw_offer" | "cancel_request" | "complete_request";

export const PRICING_MISMATCH = "Orbitly’s pricing has been updated, and offers can’t be accepted until the update is complete. Nothing was accepted.";

export const MARKETPLACE_CLOSED = "Trips and offers open soon. Orbitly is in an early public preview.";

// 10 changes a minute per user, 300 a minute and 20 at once for the server process.
const limit = createLimiter({ perKey: 10, global: 300, windowMs: 60_000, maxInFlight: 20 });

export async function runLifecycleStep(step: LifecycleStep, id: unknown, returnTo: string): Promise<ActionResult> {
  if (!MARKETPLACE_OPEN) return { ok: false, reason: MARKETPLACE_CLOSED };
  if (!isRequestId(id)) return { ok: false, reason: "That isn’t available any more." };
  const { supabase, user } = await requireUser(returnTo);
  const result = await limit(user.id, async () => {
    // accept_offer is told which pricing the buyer saw. A database on another policy refuses, or (v1.1, which has no
    // such parameter) doesn't find the function: either way nothing is accepted at a fee the buyer didn't approve.
    const args = step === "accept_offer" ? { p_offer_id: id, p_policy_version: PRICING_POLICY.version } : step.endsWith("_offer") ? { p_offer_id: id } : { p_request_id: id };
    const { error } = await supabase.rpc(step, args);
    if (!error) return { ok: true } as const;
    console.error(`[marketplace] ${step} failed`, { code: error.code });
    if (step === "accept_offer" && (error.code === "PGRST202" || /pricing policy/.test(error.message ?? ""))) return { ok: false, reason: PRICING_MISMATCH } as const;
    if (/no longer active/.test(error.message ?? "")) return { ok: false, reason: "That traveller’s trip is no longer active." } as const;
    if (/Only pending/.test(error.message ?? "")) return { ok: false, reason: "That offer is no longer pending." } as const;
    if (/reward isn't valid/.test(error.message ?? "")) return { ok: false, reason: "That offer’s reward isn’t valid, so it can’t be accepted. The traveller can send a new offer." } as const;
    if (/no longer matches/.test(error.message ?? "")) return { ok: false, reason: "That offer no longer matches the traveller’s trip, so it can’t be accepted." } as const;
    return {
      ok: false,
      reason: error.code === "42501" ? "That isn’t available any more. Refresh to see the latest." : "We couldn’t do that. Please try again in a moment.",
    } as const;
  });
  if (!("value" in result)) return { ok: false, reason: "That’s a lot of changes in a short time. Please wait a minute and try again." };
  if (result.value.ok) revalidatePath(returnTo);
  return result.value;
}
