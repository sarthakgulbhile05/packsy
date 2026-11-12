import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DirectionChip } from "@/components/home/direction";
import { ActionButton } from "@/components/marketplace/action-button";
import { OfferForm } from "@/components/marketplace/offer-form";
import { formatDate } from "@/components/request/offers";
import { RequestShell } from "@/components/request/request-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { countryName, routeLabel } from "@/lib/countries";
import { ELIGIBILITY } from "@/lib/eligibility";
import { routeDirection } from "@/lib/journey";
import { MARKETPLACE_OPEN } from "@/lib/preview";
import { calculateNetTravellerReward, formatMinor, rupees } from "@/lib/pricing";
import { readPricingSnapshots } from "@/lib/pricing-snapshots";
import { formatMoney } from "@/lib/request-draft";
import { isRequestId, type RequestRow } from "@/lib/request-row";
import { NOINDEX } from "@/lib/site";
import { TRIP_COLUMNS, tripStatus, type TripRow } from "@/lib/trip";
import { cancelTrip, withdrawOffer } from "../actions";

export const metadata = { title: "Trip", robots: NOINDEX };

export default function TripPage({ params }: PageProps<"/trips/[id]">) {
  return (
    <RequestShell>
      <Suspense fallback={<p className="text-muted">Loading your trip…</p>}>
        <TripDetail params={params} />
      </Suspense>
    </RequestShell>
  );
}

type MyOffer = { id: string; request_id: string; status: string; service_fee_inr: number; arrival_date: string };
const OFFER_LABELS: Record<string, string> = { pending: "Waiting for the buyer", accepted: "Accepted", rejected: "Declined", withdrawn: "Withdrawn", closed: "Closed" };
/** What matching_requests() returns: what a traveller needs to decide, never the buyer's account id. */
type MatchedRequest = Pick<RequestRow, "id" | "title" | "description" | "quantity" | "delivery_city" | "needed_by" | "eligibility_status">;

async function TripDetail({ params }: Pick<PageProps<"/trips/[id]">, "params">) {
  const { id } = await params;
  if (!isRequestId(id)) notFound();
  const { supabase, user } = await requireUser(`/trips/${id}`);
  if (!MARKETPLACE_OPEN) notFound();

  const { data: trip } = await supabase.from("trips").select(TRIP_COLUMNS).eq("id", id).eq("traveller_id", user.id).returns<TripRow[]>().maybeSingle();
  if (!trip) notFound();
  const status = tripStatus(trip);

  // The database decides what matches (same route, same direction, dates, live, not restricted).
  const [matched, { data: offers }] = await Promise.all([
    status.live ? supabase.rpc("matching_requests", { p_trip_id: id }) : Promise.resolve({ data: [], error: null }),
    supabase.from("offers").select("id, request_id, status, service_fee_inr, arrival_date").eq("trip_id", id).eq("traveller_id", user.id).returns<MyOffer[]>(),
  ]);
  const matches = matched.data as MatchedRequest[] | null;
  const error = matched.error;
  if (error) console.error("[trips] matching failed", { code: error.code });
  const tripDirection = routeDirection(trip.departure_country, trip.destination_country);
  const offerFor = new Map((offers ?? []).map((o) => [o.request_id, o]));
  // Accepted offers: what you receive was frozen at acceptance. Others: worked out now, by the same engine.
  const locked = await readPricingSnapshots(supabase, (offers ?? []).filter((o) => o.status === "accepted").map((o) => o.id));
  const youReceive = (o: MyOffer) => formatMinor(locked.get(o.id)?.netReward ?? calculateNetTravellerReward(rupees(o.service_fee_inr)), "INR");
  // A request leaves matching_requests once it's matched, closed or expired, and requests are owner-only, so
  // these offers are shown from the traveller's own offer rows, without the request's details.
  const listed = new Set(matches?.map((r) => r.id));
  const earlier = (offers ?? []).filter((o) => !listed.has(o.request_id));

  return (
    <>
      <Link href="/trips" className="text-sm font-semibold text-teal-ink underline">
        ← My trips
      </Link>
      <div className="mt-3 mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl leading-tight font-semibold break-words">{routeLabel(trip.departure_country, trip.destination_country)}</h1>
          {tripDirection && <DirectionChip direction={tripDirection} className="mt-2" />}
          <p className="mt-1 text-muted">
            {formatDate(trip.departure_date)} → {formatDate(trip.arrival_date)}
            {trip.capacity_kg ? ` · up to ${trip.capacity_kg} kg` : ""}
          </p>
          {/* Nothing verifies trips yet, so we say so rather than showing a badge. */}
          <p className="mt-1 text-sm text-muted">Trip details aren’t verified by Orbitly yet.</p>
        </div>
        <Badge tone={status.live ? "success" : "neutral"}>{status.label}</Badge>
      </div>
      {status.live && trip.status === "active" && (
        <ActionButton action={cancelTrip.bind(null, trip.id)} busyText="Cancelling…" confirm="Cancel this trip? Buyers won’t see it any more.">
          Cancel trip
        </ActionButton>
      )}

      <section aria-labelledby="matches" className="mt-8">
        <h2 id="matches" className="font-heading text-xl font-semibold">
          Requests on your route
        </h2>
        <p className="mt-1 text-sm text-muted">
          Published requests to buy in {countryName(trip.departure_country)} and deliver in {countryName(trip.destination_country)}, needed after you land.
        </p>
        {error && (
          <p role="alert" className="mt-4 text-danger">
            We couldn’t load matching requests. Please refresh to try again.
          </p>
        )}
        {!error && !matches?.length && (
          <div className="mt-4">
            <EmptyState title={status.live ? "No matching requests yet" : "This trip isn’t active"}>
              {status.live ? "Nobody has published a request on this route for your dates yet. Check back later." : "Only active, upcoming trips show matching requests."}
            </EmptyState>
          </div>
        )}
        <ul className="mt-4 space-y-4">
          {matches?.map((r) => {
            const mine = offerFor.get(r.id);
            const eligibility = ELIGIBILITY[r.eligibility_status];
            return (
              <li key={r.id} className="rounded-card border border-line bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 font-semibold break-words">{r.title}</h3>
                  <Badge tone={eligibility.tone}>{eligibility.label}</Badge>
                </div>
                {r.description && <p className="mt-1 text-sm break-words text-muted">{r.description}</p>}
                <p className="mt-2 text-sm text-muted">
                  To {r.delivery_city}
                  {r.needed_by ? ` · needed by ${formatDate(r.needed_by)}` : ""} · qty {r.quantity}
                </p>
                <p className="mt-2 text-xs text-muted">{eligibility.text}</p>
                {mine ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                    <Badge tone={mine.status === "accepted" ? "success" : "info"}>Your offer: {OFFER_LABELS[mine.status] ?? mine.status}</Badge>
                    <span className="text-sm text-muted">
                      You receive {youReceive(mine)} from a {formatMoney(mine.service_fee_inr, "INR")} reward
                    </span>
                    {mine.status === "pending" && (
                      <ActionButton action={withdrawOffer.bind(null, mine.id)} busyText="Withdrawing…">
                        Withdraw offer
                      </ActionButton>
                    )}
                  </div>
                ) : (
                  <OfferForm requestId={r.id} tripId={trip.id} />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {earlier.length > 0 && (
        <section aria-labelledby="my-offers" className="mt-8">
          <h2 id="my-offers" className="font-heading text-xl font-semibold">
            Your offers from this trip
          </h2>
          <p className="mt-1 text-sm text-muted">Offers on requests that are no longer open. Messaging and delivery updates aren’t available yet.</p>
          <ul className="mt-4 space-y-3">
            {earlier.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-white p-4 text-sm">
                <span className="text-muted">
                  Reward {formatMoney(o.service_fee_inr, "INR")} · you receive {youReceive(o)} after
                  Orbitly’s 10% fee · arriving {formatDate(o.arrival_date)}
                </span>
                <Badge tone={o.status === "accepted" ? "success" : "neutral"}>{OFFER_LABELS[o.status] ?? o.status}</Badge>
                {o.status === "pending" && (
                  <ActionButton action={withdrawOffer.bind(null, o.id)} busyText="Withdrawing…">
                    Withdraw offer
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
