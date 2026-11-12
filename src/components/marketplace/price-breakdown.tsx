import { ApproxAmount } from "@/components/currency/currency";
import { calculateNetTravellerReward, calculateTravellerPlatformFee, formatMinor, type OrderPricing } from "@/lib/pricing";

// Read-only breakdowns from the pricing engine. Every amount is in view: nothing hides in a tooltip.

function Row({ term, value, note, strong, approx }: { term: string; value: string; note?: string; strong?: boolean; approx?: React.ReactNode }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? "font-semibold text-navy" : ""}`}>
      <dt className={strong ? "" : "text-muted"}>
        {term}
        {note && <span className="block text-xs font-normal text-muted">{note}</span>}
      </dt>
      <dd className="shrink-0 text-right tabular-nums">
        {value}
        {approx}
      </dd>
    </div>
  );
}

export const TRAVELLER_FEE_NOTE = "Orbitly deducts 10% of the agreed traveller reward. Your net reward will be shown before you accept the order.";

/** What the traveller receives: gross reward, Orbitly's 10%, and the net amount, which leads. */
export function TravellerPayout({ grossReward }: { grossReward: number }) {
  const fee = calculateTravellerPlatformFee(grossReward);
  return (
    <div className="rounded-control bg-mist px-4 py-3 text-sm">
      <dl className="divide-y divide-line">
        <Row term="Gross agreed reward" value={formatMinor(grossReward, "INR")} />
        <Row term="Orbitly fee (10%)" value={`−${formatMinor(fee, "INR")}`} />
        <div className="flex items-baseline justify-between gap-4 pt-2.5">
          <dt className="font-semibold text-navy">You receive</dt>
          <dd className={`font-heading text-xl font-semibold tabular-nums text-teal-ink`}>{formatMinor(calculateNetTravellerReward(grossReward), "INR")}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted">{TRAVELLER_FEE_NOTE} Your own travel costs aren’t included.</p>
    </div>
  );
}

/** Everything the buyer would pay for one offer, itemised, ending in the total. */
export function BuyerQuote({ pricing, productNote, estimate }: { pricing: OrderPricing; productNote?: string; estimate: boolean }) {
  const f = (n: number) => formatMinor(n, pricing.currency);
  return (
    <dl className="divide-y divide-line text-sm">
      <Row term="Product value" note={productNote} value={f(pricing.productValue)} />
      <Row term="Traveller reward" value={f(pricing.grossReward)} />
      <Row term="Orbitly buyer fee (3% of product value)" value={f(pricing.buyerFee)} />
      {pricing.delivery > 0 && <Row term="Delivery" value={f(pricing.delivery)} />}
      {pricing.other > 0 && <Row term="Other costs" value={f(pricing.other)} />}
      {pricing.customsEstimate !== null && <Row term="Customs estimate" note="Decided by customs at arrival" value={f(pricing.customsEstimate)} />}
      {/* The engine's own total, converted for reading only: no fee is recalculated in another currency. */}
      <Row
        term={estimate ? "Estimated total" : "Total payable"}
        value={f(pricing.buyerTotal)}
        strong
        approx={<ApproxAmount minor={pricing.buyerTotal} currency={pricing.currency} className="text-xs font-normal text-muted" />}
      />
    </dl>
  );
}
