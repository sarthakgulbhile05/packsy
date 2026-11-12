import { acceptOffer, cancelRequest, completeRequest, declineOffer } from "@/app/request/actions";
import { formatDate } from "@/components/request/offers";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { countryName, routeLabel } from "@/lib/countries";
import { ELIGIBILITY } from "@/lib/eligibility";
import { HANDOFF_METHODS, priceOffer, type PricedOffer } from "@/lib/offer";
import { formatMinor } from "@/lib/pricing";
import { readPricingSnapshots } from "@/lib/pricing-snapshots";
import { formatMoney } from "@/lib/request-draft";
import type { RequestRow } from "@/lib/request-row";
import type { createClient } from "@/lib/supabase/server";
import { CurrencySelect, RateNote } from "@/components/currency/currency";
import { DirectionChip } from "@/components/home/direction";
import { routeDirection } from "@/lib/journey";
import { ActionButton } from "./action-button";
import { BuyerQuote } from "./price-breakdown";

type MatchingTrip = { trip_id: string; departure_country: string; departure_date: string; arrival_date: string };
type ReceivedOffer = PricedOffer & {
  id: string;
  status: string;
  product_price_amount: number;
  product_currency: string;
  fx_rate_to_inr: number;
  product_price_fixed: boolean;
  other_costs_note: string | null;
  arrival_date: string;
  handoff_method: string;
};

const OFFER_TONES: Record<string, "success" | "info" | "neutral"> = { accepted: "success", pending: "info" };

/** The buyer's side of a published request: who's on the route, offers received, and the next step. */
export async function RequestMarketplace({ request, supabase }: { request: RequestRow; supabase: Awaited<ReturnType<typeof createClient>> }) {
  const live = request.status === "open";
  const [matched, { data: offers, error: offersError }] = await Promise.all([
    live ? supabase.rpc("matching_trips", { p_request_id: request.id }) : Promise.resolve({ data: [], error: null }),
    supabase
      .from("offers")
      .select(
        "id, status, product_price_amount, product_currency, fx_rate_to_inr, product_price_fixed, product_price_inr, service_fee_inr, delivery_inr, other_costs_inr, other_costs_note, customs_estimate_inr, arrival_date, handoff_method",
      )
      .eq("request_id", request.id)
      .order("estimated_total_inr", { ascending: true })
      .returns<ReceivedOffer[]>(),
  ]);
  const trips = matched.data as MatchingTrip[] | null;
  const tripsError = matched.error;
  if (tripsError || offersError) console.error("[requests] marketplace read failed", { code: tripsError?.code ?? offersError?.code });
  const eligibility = ELIGIBILITY[request.eligibility_status];
  // Accepted offers show the price frozen at acceptance; others are priced now, by the same engine.
  const locked = await readPricingSnapshots(supabase, (offers ?? []).filter((o) => o.status === "accepted").map((o) => o.id));
  // Lowest total first. Offers that can't be priced sort last.
  const priced = (offers ?? [])
    .map((o) => {
      const agreed = locked.get(o.id);
      return { o, agreed: Boolean(agreed), price: agreed ? ({ ok: true, pricing: agreed } as const) : priceOffer(o) };
    })
    .sort((a, b) => (a.price.ok ? a.price.pricing.buyerTotal : Infinity) - (b.price.ok ? b.price.pricing.buyerTotal : Infinity));
  const direction = routeDirection(request.source_country, request.destination_country);
  const route = request.source_country && request.destination_country ? routeLabel(request.source_country, request.destination_country) : null;

  return (
    <div className="mt-6 space-y-6">
      <section aria-labelledby="route-title" className="rounded-card border border-line bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="route-title" className="font-heading text-lg font-semibold break-words">
              {route ?? "No route yet"}
            </h2>
            {direction && <DirectionChip direction={direction} className="mt-2" />}
          </div>
          <Badge tone={eligibility.tone}>{eligibility.label}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted">{eligibility.text}</p>
      </section>

      {live && (
        <section aria-labelledby="trips-title">
          <h2 id="trips-title" className="font-heading text-lg font-semibold">
            Travellers on your route
          </h2>
          {tripsError ? (
            <p role="alert" className="mt-2 text-danger">We couldn’t load matching trips. Please refresh to try again.</p>
          ) : trips?.length ? (
            <>
              <p className="mt-1 text-sm text-muted">
                {trips.length === 1 ? "1 trip" : `${trips.length} trips`} from {countryName(request.source_country)} arriving in time. Travellers decide whether to offer; trip details aren’t verified yet.
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {trips.map((t) => (
                  <li key={t.trip_id} className="rounded-control border border-line bg-white px-4 py-3 text-sm">
                    Departs {formatDate(t.departure_date)} · lands {formatDate(t.arrival_date)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="mt-3">
              <EmptyState title="No travellers on this route yet">Your request stays open. Travellers who share a matching trip will see it.</EmptyState>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="offers-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="offers-title" className="font-heading text-lg font-semibold">
            Offers
          </h2>
          <CurrencySelect />
        </div>
        <RateNote className="mt-1" currency="INR" />
        {offersError && <p role="alert" className="mt-2 text-danger">We couldn’t load offers. Please refresh to try again.</p>}
        {!offersError && !offers?.length && <p className="mt-1 text-sm text-muted">No offers yet.</p>}
        <ul className="mt-3 space-y-3">
          {priced.map(({ o, agreed, price }) => {
            const estimate = !o.product_price_fixed || o.customs_estimate_inr !== null;
            const foreign = o.product_currency !== "INR";
            return (
              <li key={o.id} className="rounded-card border border-line bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold">
                    {price.ok ? `${estimate ? "About " : ""}${formatMinor(price.pricing.buyerTotal, "INR")} in total` : "This offer can’t be priced"}
                  </p>
                  <Badge tone={OFFER_TONES[o.status] ?? "neutral"}>{o.status}</Badge>
                </div>
                {price.ok ? (
                  <div className="mt-2">
                    <BuyerQuote
                      pricing={price.pricing}
                      estimate={estimate}
                      productNote={[
                        foreign && `${formatMoney(o.product_price_amount, o.product_currency)} at the traveller’s rate of ₹${o.fx_rate_to_inr} per ${o.product_currency}`,
                        o.product_price_fixed ? "Fixed by the traveller" : "Estimate: may change with the store price or exchange rate",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                    {o.other_costs_inr > 0 && o.other_costs_note && <p className="mt-1 text-xs text-muted">Other costs: {o.other_costs_note}</p>}
                    <p className="mt-2 text-xs text-muted">The traveller receives {formatMinor(price.pricing.netReward, "INR")} after Orbitly’s 10% fee.</p>
                    {agreed && <p className="mt-1 text-xs font-medium text-teal-ink">Price agreed when you accepted (pricing policy v{price.pricing.policyVersion}). It won’t change.</p>}
                    {o.status === "accepted" && !agreed && (
                      <p className="mt-1 text-xs text-warning">Accepted before prices were locked, so this is worked out with today’s pricing policy.</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">This offer can’t be priced, so it can’t be accepted. The traveller can send a new offer.</p>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-sm text-muted">
                  <dt>Arrives</dt>
                  <dd>{formatDate(o.arrival_date)}</dd>
                  <dt>Hand-over</dt>
                  <dd>{HANDOFF_METHODS.find((h) => h.id === o.handoff_method)?.label ?? o.handoff_method}</dd>
                </dl>
                {live && o.status === "pending" && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    {price.ok && (
                      <ActionButton
                        variant="primary"
                        action={acceptOffer.bind(null, o.id, request.id)}
                        busyText="Accepting…"
                        confirm={`Accept this offer at ${estimate ? "about " : ""}${formatMinor(price.pricing.buyerTotal, "INR")} in total? Other pending offers will close.`}
                      >
                        Accept offer
                      </ActionButton>
                    )}
                    <ActionButton action={declineOffer.bind(null, o.id, request.id)} busyText="Declining…">
                      Decline
                    </ActionButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Customs duty, if any, is decided at arrival and isn’t included unless the traveller estimated it. Amounts follow Orbitly’s pricing policy
          v1.1. Orbitly doesn’t take payments yet.
        </p>
      </section>

      {(request.status === "open" || request.status === "matched") && (
        <div className="flex flex-wrap gap-3 border-t border-line pt-5">
          {request.status === "matched" && (
            <ActionButton variant="primary" action={completeRequest.bind(null, request.id)} busyText="Saving…" confirm="Confirm you’ve received the item?">
              I’ve received it
            </ActionButton>
          )}
          <ActionButton action={cancelRequest.bind(null, request.id)} busyText="Cancelling…" confirm="Cancel this request? Any open offers will close.">
            Cancel request
          </ActionButton>
        </div>
      )}
    </div>
  );
}
