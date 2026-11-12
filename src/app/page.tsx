import Image from "next/image";
import Link from "next/link";
import { DIRECTION_ROUTE, DirectionChip, RouteArrow } from "@/components/home/direction";
import { Journeys } from "@/components/home/journeys";
import { Faq, QUESTIONS } from "@/components/home/faq";
import { FinalCta, HowItWorks, Icon, ICONS } from "@/components/home/sections";
import { Story } from "@/components/home/story";
import { Trust } from "@/components/home/trust";
import { SiteFooter } from "@/components/nav/site-footer";
import { SiteHeader } from "@/components/nav/site-header";
import { RequestComposer } from "@/components/request/composer";
import { buttonClass } from "@/components/ui/button";
import { JsonLd } from "@/components/seo/json-ld";
import { openGraph, publicOrigin, SITE_NAME } from "@/lib/site";
import journeyTerminal from "../../public/people/journey-terminal.jpg";

const TITLE = "Orbitly · Products travel with people";
const DESCRIPTION =
  "Request a product from another country and a traveller already making that journey can offer to bring it, for a fee they set. Abroad to India, India to abroad. Orbitly is in early public preview.";

export const metadata = { description: DESCRIPTION, alternates: { canonical: "/" }, openGraph: openGraph("/", TITLE, DESCRIPTION) };

// Organization, WebSite, this page and the visible FAQ. No ratings, prices or counts: none exist yet.
function homeJsonLd() {
  const origin = publicOrigin();
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: SITE_NAME,
        url: `${origin}/`,
        logo: `${origin}/icon.png`,
        description: "Orbitly connects people who want a product from another country with travellers already making that journey, in either direction.",
      },
      { "@type": "WebSite", "@id": `${origin}/#website`, name: SITE_NAME, url: `${origin}/`, inLanguage: "en-IN", publisher: { "@id": `${origin}/#organization` } },
      { "@type": "WebPage", "@id": `${origin}/#webpage`, url: `${origin}/`, name: TITLE, description: DESCRIPTION, inLanguage: "en-IN", isPartOf: { "@id": `${origin}/#website` } },
      {
        "@type": "FAQPage",
        "@id": `${origin}/#faq`,
        isPartOf: { "@id": `${origin}/#webpage` },
        mainEntity: QUESTIONS.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      },
    ],
  };
}

// Two equal ways in. The examples are illustrative routes, not live listings.
const DIRECTIONS = [
  { id: "into_india", example: "Sneakers from Tokyo to Bengaluru" },
  { id: "out_of_india", example: "Block-printed cotton from Mumbai to London" },
] as const;

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-white text-navy">
      <JsonLd data={homeJsonLd()} />
      <SiteHeader />

      <section aria-labelledby="hero-title" className="relative overflow-hidden bg-sand">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-5 pt-8 pb-10 sm:px-8 sm:pt-14 sm:pb-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:py-20">
          <div>
            <p className="text-sm font-semibold tracking-[0.12em] text-teal-ink uppercase">People helping people</p>
            <h1 id="hero-title" className="mt-3 font-heading text-[clamp(2.1rem,7.6vw,4.1rem)] leading-[1.04] font-semibold tracking-[-0.03em] text-balance">
              The world is closer than you think.
            </h1>
            <p className="mt-5 max-w-xl text-[1.05rem] leading-relaxed text-pretty text-ink sm:text-lg">
              Ask for something from another country. Someone already making that journey can offer to bring it, and you can review the
              estimated costs in their offer before deciding.
            </p>

            <ul aria-label="Orbitly works in both directions" className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {DIRECTIONS.map((d) => (
                <li key={d.id}>
                  <Link
                    href="/#journeys"
                    className="group flex h-full flex-col gap-1.5 rounded-2xl border border-sand-deep bg-white/70 p-3.5 transition-colors hover:border-navy/30 hover:bg-white focus-visible:ring-4 focus-visible:ring-teal/40 focus-visible:outline-none motion-reduce:transition-none"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <DirectionChip direction={d.id} />
                      <span className="flex items-center gap-1 text-xs font-medium text-muted">
                        {DIRECTION_ROUTE[d.id][0]}
                        <RouteArrow className="h-2.5 w-8 text-navy/40" />
                        <span className="sr-only">{" to "}</span>
                        {DIRECTION_ROUTE[d.id][1]}
                      </span>
                    </span>
                    <span className="text-sm text-ink">e.g. {d.example}</span>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="/#start" className={buttonClass({ size: "lg" })}>
                Request an item
                <Icon d={ICONS.arrow} className="size-5" />
              </Link>
              <Link href="/travel" className={buttonClass({ variant: "secondary", size: "lg" })}>
                <Icon d={ICONS.plane} className="size-5" />
                I’m travelling
              </Link>
            </div>
          </div>

          <figure className="relative mx-auto w-full max-w-[34rem] lg:max-w-none">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[1.75rem] bg-sand-deep shadow-raised sm:aspect-[5/4] lg:aspect-[4/5]">
              <Image
                src={journeyTerminal}
                alt="A traveller walking through an airport terminal with a small suitcase"
                fill
                priority
                placeholder="blur"
                sizes="(min-width: 1024px) 520px, (min-width: 640px) 544px, 100vw"
                className="hero-photo object-cover object-[50%_62%]"
              />
              {/* The idea in one line: a request and a trip on the same route. Illustrative, like the photo; it sits over the
                  ceiling so it never covers the traveller. */}
              <div className="absolute top-3 left-3 max-w-[16.5rem] rounded-2xl bg-white/95 p-3.5 text-navy shadow-raised backdrop-blur-sm sm:top-5 sm:left-5 sm:max-w-[19rem] sm:p-4">
                <p className="flex items-center gap-2 font-heading text-base font-semibold">
                  London
                  <RouteArrow className="h-3 w-12 text-navy/45" />
                  <span className="sr-only">{" to "}</span>
                  Mumbai
                </p>
                <p className="mt-1 text-sm leading-snug text-muted">A trip that’s happening anyway, and a request on the same route.</p>
              </div>
            </div>
            <figcaption className="mt-2.5 text-right text-xs text-muted">Illustrative photo: Sergey Zolkin, Unsplash</figcaption>
          </figure>
        </div>
      </section>

      <main>
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        {/* Discover → request → explore → understand → trust. Keep this order: changes need product sign-off. */}
        <section id="start" aria-labelledby="start-title" className="scroll-mt-24 pt-12 pb-16 sm:pt-16 sm:pb-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="start-title" className="font-heading text-[clamp(1.5rem,4.5vw,2.4rem)] leading-[1.15] font-semibold">
              What are you looking for?
            </h2>
            <p className="mt-2.5 text-[1.05rem] leading-relaxed text-muted">Found something in another country? Share it with Orbitly.</p>
            <p className="mt-3 inline-flex rounded-full bg-teal-soft px-3 py-1 text-sm font-medium text-teal-ink">
              Early preview · Requests stay on your device until the marketplace opens
            </p>
            <div className="mt-6 text-left">
              <RequestComposer />
            </div>
          </div>
        </section>
        <Journeys />
        </div>
        {/* Understand: the people behind it, full width, before the step-by-step. */}
        <Story />
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <HowItWorks />
        <Trust />
        <Faq />
        <FinalCta />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
