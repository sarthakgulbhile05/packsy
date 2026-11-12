import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { journeyPricing, type Journey } from "@/lib/journey";
import { ApproxAmount } from "@/components/currency/currency";
import { formatMinor } from "@/lib/pricing";
import { EXAMPLE_JOURNEYS } from "./journey-examples";
import { JourneyFeed } from "./journey-lanes";
import { Icon, ICONS, SectionIntro } from "./sections";

// The traveller example is the first product example, so the two halves of the section quote the same figures.
const OFFER = EXAMPLE_JOURNEYS[0];
const OFFER_PRICE = journeyPricing(OFFER)!; // the examples' tests require every example to price
const inr = (paise: number) => formatMinor(paise, "INR");

const TRAVELLER_FLOW = [
  ["Share your trip", "London to Mumbai, landing in 9 days, with room in your bag."],
  ["See a request on your route", "Someone in Mumbai would like these headphones from the UK."],
  ["Offer, if it suits you", "You set your own fee. Only take what you’re happy to carry."],
  ["Agree, then hand over", "Both sides review the full offer before anything is bought."],
] as const;

function Person({ role, place, dark }: { role: string; place: string; dark?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <span className={`grid size-12 place-items-center rounded-full ring-4 ring-white/10 ${dark ? "bg-teal text-navy" : "bg-white text-navy"}`}>
        <Icon d={ICONS.user} />
      </span>
      <span className="text-xs font-medium text-white/60">{role}</span>
      <span className="-mt-1.5 truncate text-sm font-semibold text-white">{place}</span>
    </div>
  );
}

/** An example offer between a traveller and a buyer, with exactly the fields a real offer requires. */
function ExampleOffer() {
  const rows: [string, string][] = [
    ["Product price", `£235 · ${inr(OFFER_PRICE.productValue)}`],
    ["Traveller reward", inr(OFFER_PRICE.grossReward)],
    ["Orbitly buyer fee (3%)", inr(OFFER_PRICE.buyerFee)],
    ["Arrives", `${OFFER.buyer.city}, in 9 days`],
    ["Hand-over", "Meet in person"],
  ];
  return (
    <figure className="min-w-0">
      <div className="grid grid-cols-[auto_1fr_auto] items-start gap-2 sm:gap-4">
        <Person role="Traveller" place={OFFER.traveller.city} dark />
        {/* The route between them; a light travels it unless motion is reduced. */}
        <svg viewBox="0 0 200 24" preserveAspectRatio="none" className="trust-route mt-4 h-6 w-full" aria-hidden="true">
          <path d="M2 12 C 60 2, 140 2, 198 12" fill="none" stroke="rgb(255 255 255 / 0.3)" strokeWidth="1.5" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
          <path d="M2 12 C 60 2, 140 2, 198 12" pathLength={1} fill="none" stroke="var(--color-teal)" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="tr-travel" />
        </svg>
        <Person role="Buyer" place={OFFER.buyer.city} />
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl bg-white text-navy shadow-raised">
        <div className="flex items-center gap-4 border-b border-line p-4">
          <Image src={OFFER.product.image.src} alt="" placeholder="blur" sizes="64px" className="size-16 shrink-0 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-teal-ink">Example offer</p>
            <p className="truncate font-heading font-semibold">{OFFER.product.name}</p>
            <p className="text-sm text-muted">{OFFER.product.detail}</p>
          </div>
        </div>
        <dl className="divide-y divide-line px-4 text-sm">
          {rows.map(([term, value]) => (
            <div key={term} className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted">{term}</dt>
              <dd className="text-right font-medium tabular-nums">{value}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 py-2.5 font-semibold">
            <dt>Buyer pays</dt>
            <dd className="text-right tabular-nums">
              {inr(OFFER_PRICE.buyerTotal)}
              <ApproxAmount minor={OFFER_PRICE.buyerTotal} currency="INR" className="text-xs font-normal text-muted" />
            </dd>
          </div>
        </dl>
        <p className="flex items-center gap-2 bg-teal-soft/60 px-4 py-3 text-sm text-teal-ink">
          <Icon d={ICONS.shield} className="size-4 shrink-0" />
          Traveller declares the item is lawful to bring into India
        </p>
      </div>
      <figcaption className="mt-3 text-center text-xs text-white/60">Illustration only. Not a real order, traveller or buyer.</figcaption>
    </figure>
  );
}

/** The traveller's side of the marketplace: how a trip meets a request. */
function TravellerOpportunity() {
  return (
    <div className="mt-16 grid items-center gap-10 rounded-card bg-navy px-5 py-10 text-white sm:px-10 sm:py-12 lg:grid-cols-[1fr_1fr] lg:gap-14">
      <div className="min-w-0">
        <p className="text-sm font-semibold tracking-[0.12em] text-teal uppercase">For travellers</p>
        <h3 className="mt-3 font-heading text-[clamp(1.45rem,4vw,2rem)] leading-tight font-semibold text-balance">Your next trip could bring someone what they’ve been looking for.</h3>
        <ol className="mt-7 space-y-4">
          {TRAVELLER_FLOW.map(([title, text], i) => (
            <li key={title} className="flex gap-4">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-white/25 text-sm font-semibold">{i + 1}</span>
              <span className="min-w-0">
                <span className="block font-semibold">{title}</span>
                <span className="mt-0.5 block text-[0.95rem] leading-relaxed text-white/70">{text}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm leading-relaxed text-white/60">
          In this example the reward is {inr(OFFER_PRICE.grossReward)}, and the traveller receives {inr(OFFER_PRICE.netReward)} after Orbitly’s 10% fee. Rewards are
          agreed request by request, with no set or guaranteed amount.
        </p>
        <Link href="/travel" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-control font-semibold text-teal transition-[gap] hover:gap-3 focus-visible:ring-4 focus-visible:ring-teal/40 focus-visible:outline-none motion-reduce:transition-none">
          How travelling with Orbitly works
          <Icon d={ICONS.arrow} className="size-4" />
        </Link>
      </div>
      <ExampleOffer />
    </div>
  );
}

/**
 * The marketplace preview: what people could get, a place to start a request, and the traveller's side.
 * Until real completed deliveries are passed in as `live`, the products are labelled examples.
 */
export function Journeys({ live = [] }: { live?: Journey[] }) {
  const example = live.length === 0;
  const journeys = example ? EXAMPLE_JOURNEYS : live;

  return (
    <section aria-labelledby="journeys-title" id="journeys" className="scroll-mt-24 border-t border-line py-16 sm:py-20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <SectionIntro
          id="journeys-title"
          eyebrow="Marketplace preview"
          title="Explore the marketplace"
          text="Discover products travelling across borders with people already making the journey."
        />
        {example && <Badge tone="warning" className="self-start sm:self-auto">Illustrative examples, not real orders</Badge>}
      </div>

      <JourneyFeed journeys={journeys} example={example} />
      {example && (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Illustrative prices in rupees, as Orbitly offers are today; prices abroad use rough, illustrative rates. Open a journey for the full
          breakdown, including Orbitly’s 3% buyer fee. Customs, if any, is a separate estimated cost, and the actual duty may differ.
        </p>
      )}

      <Link href="/explore" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-control font-semibold text-teal-ink transition-[gap] hover:gap-3 focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none motion-reduce:transition-none">
        Explore all products
        <Icon d={ICONS.arrow} className="size-4" />
      </Link>

      <TravellerOpportunity />
    </section>
  );
}
