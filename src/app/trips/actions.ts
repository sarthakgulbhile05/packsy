"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, requireVerifiedPhone } from "@/lib/auth";
import { offerToRow, type OfferErrors } from "@/lib/offer";
import { MARKETPLACE_OPEN } from "@/lib/preview";
import { createLimiter } from "@/lib/rate-limit";
import { MARKETPLACE_CLOSED, runLifecycleStep, type ActionResult } from "@/lib/marketplace-lifecycle";
import { isRequestId } from "@/lib/request-row";
import { readTrip, tripToRow, type TripErrors, type TripInput } from "@/lib/trip";

// Trips and offers. The database's row rules (stage 4) are the boundary: a trip is always the caller's own,
// and an offer must come from the caller's own trip on the same route. These checks give clear answers.

const CLOSED = MARKETPLACE_CLOSED;
const FAILED = "We couldn’t save that. Please try again in a moment.";

// 10 changes a minute per traveller, 300 a minute and 20 at once for the server process.
const writeLimit = createLimiter({ perKey: 10, global: 300, windowMs: 60_000, maxInFlight: 20 });
const LIMITED = "That’s a lot of changes in a short time. Please wait a minute and try again.";

export type TripFormState = { errors?: TripErrors; message?: string; values?: TripInput };

/** Publishes a new trip for the signed-in traveller, then opens it to show matching requests. */
export async function createTrip(_prev: TripFormState, form: FormData): Promise<TripFormState> {
  if (!MARKETPLACE_OPEN) return { message: CLOSED };
  const values = readTrip(form);
  const mapped = tripToRow(values);
  if (!mapped.ok) return { errors: mapped.errors, values };
  const { supabase, user } = await requireVerifiedPhone("/trips");

  const result = await writeLimit(user.id, async () => {
    const { data, error } = await supabase.from("trips").insert(mapped.row).select("id").single();
    if (error) console.error("[trips] create failed", { code: error.code });
    return error ? null : (data.id as string);
  });
  if (!("value" in result)) return { message: LIMITED, values };
  if (!result.value) return { message: FAILED, values };
  revalidatePath("/trips");
  redirect(`/trips/${result.value}`);
}

/** Cancels the caller's own active trip. Offers already sent stay as they are until the buyer acts. */
export async function cancelTrip(id: unknown): Promise<ActionResult> {
  if (!MARKETPLACE_OPEN) return { ok: false, reason: CLOSED };
  if (!isRequestId(id)) return { ok: false, reason: "That trip isn’t available." };
  const { supabase, user } = await requireUser(`/trips/${id}`);
  const result = await writeLimit(user.id, async () => {
    const { data, error } = await supabase.from("trips").update({ status: "cancelled" }).eq("id", id).eq("traveller_id", user.id).select("id");
    if (error) console.error("[trips] cancel failed", { code: error.code });
    return !error && Boolean(data?.length);
  });
  if (!("value" in result)) return { ok: false, reason: LIMITED };
  if (!result.value) return { ok: false, reason: "Only your own active trips can be cancelled." };
  revalidatePath("/trips");
  revalidatePath(`/trips/${id}`);
  return { ok: true };
}

const PRICING_UPDATE_PENDING = "Orbitly’s pricing has been updated, and this offer can’t be sent until the update is complete. Nothing was sent.";

export type OfferFormState = { errors?: OfferErrors; message?: string; sent?: boolean };

/** Sends an offer on a request that matches one of the caller's trips. The database re-checks the match. */
export async function sendOffer(_prev: OfferFormState, form: FormData): Promise<OfferFormState> {
  if (!MARKETPLACE_OPEN) return { message: CLOSED };
  const requestId = form.get("requestId");
  const tripId = form.get("tripId");
  if (!isRequestId(requestId) || !isRequestId(tripId)) return { message: "That request isn’t available any more." };
  const { supabase, user } = await requireVerifiedPhone(`/trips/${tripId}`);

  // The arrival date is the trip's own, read from the database rather than the form.
  const { data: trip } = await supabase.from("trips").select("arrival_date").eq("id", tripId).eq("traveller_id", user.id).maybeSingle();
  if (!trip) return { message: "That trip isn’t available." };
  const mapped = offerToRow(form, { requestId, tripId, arrivalDate: trip.arrival_date as string });
  if (!mapped.ok) return { errors: mapped.errors };

  const result = await writeLimit(user.id, async () => {
    const { error } = await supabase.from("offers").insert(mapped.row);
    if (!error) return { sent: true } as const;
    console.error("[offers] send failed", { code: error.code });
    if (error.code === "23505") return { message: "You’ve already offered on this request." };
    // Dev's database still enforces pricing v1.1's ₹300 floor, which Q13a removed. Nothing was saved.
    if (/offers_min_net_reward/.test(error.message ?? "")) return { message: PRICING_UPDATE_PENDING };
    if (error.code === "42501") return { message: "This request no longer matches your trip, or it has closed." };
    return { message: FAILED };
  });
  if (!("value" in result)) return { message: LIMITED };
  if ("sent" in result.value) revalidatePath(`/trips/${tripId}`);
  return result.value;
}

/** Withdraws the caller's own pending offer. */
export async function withdrawOffer(id: unknown): Promise<ActionResult> {
  return runLifecycleStep("withdraw_offer", id, "/trips");
}
