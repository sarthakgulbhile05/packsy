"use client";

import Image from "next/image";
import { useId, useRef } from "react";
import { journeyDirection, journeyPricing, journeySaving, type Journey, type JourneyParty } from "@/lib/journey";
import { ApproxAmount, RateNote } from "@/components/currency/currency";
import { DirectionChip } from "./direction";
import { formatMinor, rupees } from "@/lib/pricing";
import { Icon, ICONS } from "./sections";

const STATUS = { delivered: "Delivered", in_transit: "In transit" } as const;
const place = (p: JourneyParty) => `${p.city}, ${p.country}`;

/** One journey: photo, route between traveller and buyer, and what each side got out of it. Opens a detail view. */
export function JourneyCard({ journey, example }: { journey: Journey; example: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { product } = journey;
  const blur = typeof product.image.src === "string" ? "empty" : "blur";
  const close = () => dialog.current?.close();
  const direction = journeyDirection(journey);
  const pricing = journeyPricing(journey);
  const inr = (paise: number) => formatMinor(paise, "INR");
  const saving = pricing ? inr(journeySaving(pricing, journey)) : "—";

  return (
    <article className="group relative flex w-full min-w-0 overflow-hidden rounded-card border border-line bg-white transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:flex-col">
      {/* Phones: a small photo beside the text keeps the feed short. Wider screens: photo on top. */}
      <div className="relative w-28 shrink-0 overflow-hidden bg-mist sm:aspect-[4/3] sm:w-auto">
        <Image
          src={product.image.src}
          alt={product.image.alt}
          fill
          placeholder={blur}
          sizes="(min-width: 1024px) 300px, (min-width: 640px) 50vw, 112px"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        {/* Examples never carry a delivery status: nothing was delivered. */}
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[0.7rem] font-semibold text-navy shadow-card sm:top-3 sm:left-3 sm:text-xs">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-teal" />
          {example ? "Example" : STATUS[journey.status]}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3.5 sm:p-5">
        {direction && <DirectionChip direction={direction} className="self-start" />}
        <h3 className="mt-2 line-clamp-2 font-heading text-[1.02rem] leading-snug font-semibold text-navy">{product.name}</h3>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[0.8rem] text-muted">
          <span className="truncate">{journey.traveller.city}</span>
          <Icon d={ICONS.arrow} className="size-3.5 shrink-0" />
          <span className="sr-only">{" to "}</span>
          <span className="truncate">{journey.buyer.city}</span>
        </p>

        <dl className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <dt className="sr-only">Product price</dt>
            <dd className="font-heading text-lg leading-tight font-semibold text-navy tabular-nums">
              {inr(rupees(journey.productPriceInr))}
              <ApproxAmount minor={rupees(journey.productPriceInr)} currency="INR" className="font-sans text-xs font-normal text-muted" />
            </dd>
          </div>
          <div className="text-right">
            <dt className="text-xs text-muted">Traveller reward</dt>
            <dd className="text-sm font-semibold text-navy tabular-nums">{inr(rupees(journey.travellerFeeInr))}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          className="mt-auto inline-flex min-h-10 items-center gap-1.5 self-start rounded-control pt-2 text-sm font-semibold text-teal-ink transition-[gap] hover:gap-2.5 focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none motion-reduce:transition-none"
        >
          View journey<span className="sr-only">: {product.name}</span>
          <Icon d={ICONS.arrow} className="size-4" />
        </button>
      </div>

      {/* Native modal: focus is trapped and Escape closes it. Clicking the backdrop closes it too. */}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClick={(e) => e.target === e.currentTarget && close()}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(calc(100%-2rem),56rem)] overflow-y-auto rounded-card bg-white p-0 text-navy shadow-raised backdrop:bg-navy/60"
      >
        <div className="grid md:grid-cols-[1fr_1.15fr]">
          <div className="relative aspect-[4/3] bg-mist md:aspect-auto">
            <Image src={product.image.src} alt="" fill placeholder={blur} sizes="(min-width: 768px) 420px, 100vw" className="object-cover" />
          </div>
          <div className="p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm font-semibold tracking-[0.12em] text-teal-ink uppercase">{example ? "Example journey" : STATUS[journey.status]}</p>
              <button
                type="button"
                onClick={close}
                className="-mt-2 -mr-2 grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-mist hover:text-navy focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none"
              >
                <Icon d={ICONS.close} className="size-5" />
                <span className="sr-only">Close</span>
              </button>
            </div>
            <h2 id={titleId} className="mt-2 font-heading text-2xl font-semibold">
              {product.name}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted">
              {place(journey.traveller)} <Icon d={ICONS.arrow} className="size-4 text-teal-ink" /> {place(journey.buyer)}
            </p>

            <ol className="mt-6 space-y-3">
              {journey.steps.map((s, i) => (
                <li key={s.label} className="flex items-baseline gap-3 text-sm">
                  <span aria-hidden="true" className={`size-2 shrink-0 translate-y-[-1px] rounded-full ${i === journey.steps.length - 1 ? "bg-teal" : "bg-line-strong"}`} />
                  <span className="flex-1 text-navy">{s.label}</span>
                  <span className="shrink-0 text-muted">{s.when}</span>
                </li>
              ))}
            </ol>

            {/* Examples say so before any figure: none of these is a live offer, quote, guaranteed price or saving. */}
            {example && (
              <p className="mt-6 rounded-control bg-warning-soft px-3 py-2 text-sm font-medium text-warning">
                Illustrative figures only. Not a live offer, a quote, or a guaranteed price or saving.
              </p>
            )}
            <dl className={`${example ? "mt-4" : "mt-6"} space-y-2 border-t border-line pt-5 text-sm`}>
              {(
                [
                  [example ? "Example product price" : "Product price", rupees(journey.productPriceInr)],
                  [example ? "Example traveller reward" : "Traveller reward", rupees(journey.travellerFeeInr)],
                  ...(pricing
                    ? [
                        ["Orbitly buyer fee (3%)", pricing.buyerFee],
                        [example ? "Example total for the buyer" : "Buyer paid in total", pricing.buyerTotal, true],
                      ]
                    : []),
                  [example ? `Estimated price in ${journey.buyer.city}` : `Same item in ${journey.buyer.city}`, rupees(journey.localPriceInr)],
                ] as [string, number, boolean?][]
              ).map(([term, value, approx]) => (
                <div key={term} className="flex justify-between gap-4">
                  <dt className="text-muted">{term}</dt>
                  <dd className="text-right font-medium tabular-nums">
                    {inr(value)}
                    {approx && <ApproxAmount minor={value} currency="INR" className="text-xs font-normal text-muted" />}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-line pt-2 font-semibold">
                <dt>{example ? "Possible saving (not guaranteed)" : "Buyer saved"}</dt>
                <dd className="text-right text-teal-ink tabular-nums">
                  {saving}
                  {pricing && <ApproxAmount minor={journeySaving(pricing, journey)} currency="INR" className="text-xs font-normal text-muted" />}
                </dd>
              </div>
            </dl>
            <RateNote className="mt-2" currency="INR" />
            {pricing && (
              <p className="mt-3 text-sm text-muted">
                {example ? "In this example, the traveller would receive " : "The traveller receives "}
                <span className="font-semibold text-navy">{inr(pricing.netReward)}</span> after Orbitly’s 10% fee.
              </p>
            )}
            {example && (
              <p className="mt-5 rounded-control bg-mist p-3 text-xs leading-relaxed text-muted">
                An illustrative example, not a real order or listing: every price, reward and saving here is an estimate, and nothing can be bought at
                these prices. Real prices, rewards and exchange rates vary, and customs, if any, is a separate estimated cost: the actual duty may differ. The traveller reward is what the buyer
                pays the traveller; Orbitly keeps 10% of it, and the traveller’s own travel costs come out of the rest. Real offers show the amounts the
                buyer and traveller actually agree.
              </p>
            )}
          </div>
        </div>
      </dialog>
    </article>
  );
}
