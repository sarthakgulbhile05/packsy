import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { HeroGlobe } from "./hero-globe";

const display = "font-heading";

/** Line icons drawn on a 24px grid, stroke-only, so every icon on the page shares one weight. */
export function Icon({ d, className = "size-5" }: { d: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );
}

export const ICONS = {
  bag: <><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  plane: <path d="M10.5 13.5 4 11l1.5-1.5 7 1 4-4a2 2 0 0 1 3 3l-4 4 1 7L15 22l-2.5-6.5L9 19v2.5L7.5 23 6 19l-4-1.5L3.5 16H6z" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  scale: <><path d="M12 4v16M5 20h14M6 8h12" /><path d="m6 8-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0z" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z" /><path d="m9 12 2 2 4-4" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.6 4-5.2 7-5.2s5.8 1.6 7 5.2" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export function SectionIntro({ eyebrow, title, text, id }: { eyebrow: string; title: string; text?: string; id: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold tracking-[0.12em] text-teal-ink uppercase">{eyebrow}</p>
      <h2 id={id} className={`${display} mt-3 text-[clamp(1.6rem,4.5vw,2.4rem)] leading-[1.15] font-semibold text-navy`}>
        {title}
      </h2>
      {text && <p className="mt-3 text-[1.05rem] leading-relaxed text-muted">{text}</p>}
    </div>
  );
}

const BUYER_STEPS = [
  { title: "Find something from another country", text: "A new release, a regional speciality, or something simply not sold where you live." },
  { title: "Share a link, photo or description", text: "Whatever you have is enough to describe it." },
  { title: "Find a traveller who may bring it", text: "Travellers on the same route, in the same direction, see your request and can offer to carry it." },
  { title: "Review the proposed arrangement", text: "Product price, traveller fee and any other costs, shown separately. You decide." },
  { title: "Complete the agreed hand-over", text: "Meet or collect where it’s delivered, the way you both agreed." },
];
export const TRAVELLER_STEPS = [
  { title: "Share your upcoming journey", text: "Where you’re flying from, where to, and when you land." },
  { title: "Discover relevant requests", text: "See what people at your destination want from where you’re leaving." },
  { title: "Choose one that suits your trip", text: "Only what fits your luggage, route and customs allowance." },
  { title: "Discuss and agree the arrangement", text: "Set your fee. The buyer reviews it before anything is bought." },
  { title: "Complete the agreed hand-over", text: "Buy the item, carry it on your trip, and hand it over as agreed." },
];

export function Journey({ tone, label, title, steps, icon }: { tone: "light" | "dark"; label: string; title: string; steps: typeof BUYER_STEPS; icon: React.ReactNode }) {
  const dark = tone === "dark";
  return (
    <article className={`rounded-card p-5 sm:p-8 ${dark ? "bg-navy text-white" : "border border-line bg-white"}`}>
      <div className="flex items-center gap-3">
        <span className={`grid size-11 place-items-center rounded-full ${dark ? "bg-teal text-navy" : "bg-teal-soft text-teal-ink"}`}>
          <Icon d={icon} />
        </span>
        <div>
          <p className={`text-sm font-semibold ${dark ? "text-teal" : "text-teal-ink"}`}>{label}</p>
          <h3 className={`${display} text-xl font-semibold`}>{title}</h3>
        </div>
      </div>
      <ol className="mt-6 space-y-0">
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-4 pb-5 last:pb-0">
            {/* The line joining each step to the next */}
            {i < steps.length - 1 && <span aria-hidden="true" className={`absolute top-9 bottom-1 left-[15px] w-px ${dark ? "bg-white/15" : "bg-line"}`} />}
            <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${dark ? "border border-white/25 text-white" : "border border-line-strong text-navy"}`}>
              {i + 1}
            </span>
            <div className="pt-1">
              <h4 className="font-semibold">{s.title}</h4>
              <p className={`mt-1 text-[0.95rem] leading-relaxed ${dark ? "text-white/70" : "text-muted"}`}>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" id="how" className="scroll-mt-24 border-t border-line py-20 sm:py-24">
      <SectionIntro id="how-title" eyebrow="How Orbitly works" title="Two journeys, one marketplace." text="Buyers and travellers on the same route meet in the middle, in either direction. One account can be either, or both." />
      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <Journey tone="light" label="Shop" title="For buyers" steps={BUYER_STEPS} icon={ICONS.bag} />
        <Journey tone="dark" label="Travel" title="For travellers" steps={TRAVELLER_STEPS} icon={ICONS.plane} />
      </div>
      <p className="mt-5 text-sm text-muted">Orbitly is in early preview: you can draft a request today. Offers, agreements and hand-overs open with the marketplace.</p>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="pb-20 sm:pb-24">
      <div className="relative overflow-hidden rounded-card bg-navy px-6 py-12 text-white sm:px-12 sm:py-16 lg:grid lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:gap-8">
        <div className="relative z-10 text-center lg:text-left">
          <h2 id="cta-title" className={`${display} text-[clamp(1.6rem,4.5vw,2.4rem)] leading-tight font-semibold text-balance`}>
            Someone is already making the journey.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/75 lg:mx-0">Start with what you’d like from another country, or with the trip you’re already taking.</p>
          <div className="mx-auto mt-8 grid max-w-md gap-3 sm:grid-cols-2 lg:mx-0">
            <Link href="/#start" className={buttonClass({ variant: "accent", size: "lg", full: true })}>
              Request an item
            </Link>
            <Link href="/travel" className={`${buttonClass({ size: "lg", full: true })} border border-white/30 !bg-transparent hover:!bg-white/10`}>
              I’m travelling
            </Link>
          </div>
        </div>
        {/* The same routes, in both directions, as a quiet sign-off. Decorative. */}
        <HeroGlobe className="mx-auto mt-10 hidden aspect-[750/720] w-full max-w-[340px] lg:mt-0 lg:block" />
      </div>
    </section>
  );
}
