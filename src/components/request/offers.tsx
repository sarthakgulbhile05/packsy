"use client";

import { useState } from "react";
import { CurrencySelect, RateNote } from "@/components/currency/currency";
import { BuyerQuote } from "@/components/marketplace/price-breakdown";
import { formatMinor, toMinor, validateTravellerReward } from "@/lib/pricing";
import { compareOffers, type Offer, type RequestDraft } from "@/lib/request-draft";
import { errorText, fieldClass, labelClass, secondaryButton } from "./ui";

/**
 * Offers on a request. Nothing real can arrive yet (requests aren't published), so the list starts
 * empty; the form lets the buyer preview how a traveller's offer works. Those are labelled practice.
 */
export function OffersPanel({ request }: { request: RequestDraft }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const compared = compareOffers(offers);

  return (
    <section aria-labelledby="offers-title" className="mt-6 rounded-3xl border border-[#E3E8F0] bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="offers-title" className="font-[family-name:var(--font-display)] text-xl font-semibold text-[#101C35]">
          Traveller offers
        </h2>
        {compared.length > 0 && <CurrencySelect />}
      </div>
      {compared.length > 0 && <RateNote className="mt-1" currency="INR" />}

      {compared.length === 0 ? (
        <div className="mt-4 rounded-2xl bg-[#F5F7FA] p-5 text-center">
          <p className="font-semibold text-[#101C35]">No offers yet</p>
          <p className="mt-1 text-sm text-[#5B6B86]">Offers arrive once your request is published to travellers on the same route.</p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3" aria-label="Offers, lowest total first">
          {compared.map((o) => (
            <li key={o.id} className="rounded-2xl border border-[#E3E8F0] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[#101C35]">{o.traveller}</span>
                <span className="rounded-full bg-[#FFF4E0] px-2 py-0.5 text-xs font-semibold text-[#8A5A00]">Practice offer · on this device</span>
                {o.lowestTotal && <span className="rounded-full bg-[#E7F7F5] px-2 py-0.5 text-xs font-semibold text-[#0F7A6E]">Lowest total</span>}
                {o.earliest && <span className="rounded-full bg-[#EAF1FD] px-2 py-0.5 text-xs font-semibold text-[#1F4FB0]">Earliest arrival</span>}
              </div>
              {o.pricing.ok && (
                <div className="mt-3">
                  <BuyerQuote pricing={o.pricing.pricing} estimate />
                  <p className="mt-1 text-xs text-[#5B6B86]">The traveller would receive {formatMinor(o.pricing.pricing.netReward, o.currency)} after Orbitly’s 10% fee.</p>
                  <p className="mt-1 text-xs text-[#5B6B86]">Illustrative practice figures, not a real offer or a final amount. Customs and delivery aren’t included.</p>
                </div>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                <Detail term="Arrives by" value={formatDate(o.arrival)} />
                <Detail term="Handoff" value={o.handoff} wide />
                {o.conditions && <Detail term="Conditions" value={o.conditions} wide />}
              </dl>
              <button type="button" disabled className={`${secondaryButton} mt-3 h-10 cursor-not-allowed text-sm opacity-60`}>
                Accept · opens when requests go live
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="group mt-5 rounded-2xl border border-[#E3E8F0]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-4 font-semibold text-[#101C35] focus-visible:ring-4 focus-visible:ring-[#20C7B5]/30 focus-visible:outline-none">
          Preview: how a traveller makes an offer
          <span aria-hidden="true" className="transition-transform group-open:rotate-180 motion-reduce:transition-none">
            ⌄
          </span>
        </summary>
        <div className="border-t border-[#E3E8F0] p-4">
          <OfferForm request={request} onAdd={(o) => setOffers((list) => [...list, o])} />
        </div>
      </details>
    </section>
  );
}

function OfferForm({ request, onAdd }: { request: RequestDraft; onAdd: (o: Offer) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const handoffs = [`Meet in person in ${request.deliverTo || "your city"}`, "Courier within the country after landing", "Pickup at the arrival airport"];
  const [error, setError] = useState("");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const price = toMinor(String(f.get("price") ?? ""), "INR");
    const fee = toMinor(String(f.get("fee") ?? ""), "INR");
    const arrival = String(f.get("arrival") ?? "");
    if (!price) return setError("Enter the product value in rupees.");
    if (fee === null) return setError("Enter the traveller reward in rupees.");
    const reward = validateTravellerReward(fee, "INR");
    if (!reward.ok) return setError(reward.message);
    if (!arrival || arrival < today) return setError("Choose an arrival date from today onwards.");
    setError("");
    onAdd({
      id: crypto.randomUUID(),
      traveller: String(f.get("traveller") || "Traveller").slice(0, 40),
      productPrice: price,
      serviceFee: fee,
      currency: "INR", // offers are priced in rupees today
      arrival,
      handoff: String(f.get("handoff")),
      conditions: String(f.get("conditions") ?? "").slice(0, 300),
    });
    e.currentTarget.reset();
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <p className="text-sm text-[#5B6B86] sm:col-span-2">
        This is what verified travellers will fill in. Offers you add here are practice only and stay on this device.
      </p>
      <label className={labelClass}>
        Traveller name
        <input name="traveller" maxLength={40} placeholder="e.g. Priya" className={fieldClass} />
      </label>
      <label className={labelClass}>
        Product value (₹)
        <input name="price" type="number" inputMode="decimal" min="0.01" step="0.01" className={fieldClass} />
      </label>
      <label className={labelClass}>
        Traveller reward (₹, before Orbitly’s 10% fee)
        <input name="fee" type="number" inputMode="decimal" min="0" step="0.01" className={fieldClass} />
      </label>
      <label className={labelClass}>
        Arrives by
        <input name="arrival" type="date" min={today} className={fieldClass} />
      </label>
      <label className={labelClass}>
        Handoff
        <select name="handoff" className={fieldClass}>
          {handoffs.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </label>
      <label className={`${labelClass} sm:col-span-2`}>
        Limitations or conditions
        <textarea name="conditions" rows={2} maxLength={300} placeholder="e.g. Only if the store has size 9 in stock" className={fieldClass} />
      </label>
      {error && (
        <p role="alert" className={`${errorText} sm:col-span-2`}>
          {error}
        </p>
      )}
      <button type="submit" className={`${secondaryButton} sm:col-span-2`}>
        Add practice offer
      </button>
    </form>
  );
}

function Detail({ term, value, wide }: { term: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-xs text-[#5B6B86]">{term}</dt>
      <dd className="text-[#33415C]">{value}</dd>
    </div>
  );
}

export function formatDate(iso: string) {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
