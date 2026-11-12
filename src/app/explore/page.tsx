import Link from "next/link";
import { EXAMPLE_JOURNEYS } from "@/components/home/journey-examples";
import { JourneyFeed } from "@/components/home/journey-lanes";
import { Icon, ICONS } from "@/components/home/sections";
import { SiteFooter } from "@/components/nav/site-footer";
import { SiteHeader } from "@/components/nav/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SIGNUPS_OPEN } from "@/lib/preview";
import { NOINDEX, openGraph, TWITTER } from "@/lib/site";

const TITLE = "Explore the marketplace";
const DESCRIPTION =
  "Browse illustrative examples of products travelling into and out of India with people already making the journey, with their estimated costs shown. Orbitly is in early public preview.";

// noindex while every listing is an illustrative example; index it (and add it to the sitemap) once it shows real listings.
export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: NOINDEX,
  alternates: { canonical: "/explore" },
  openGraph: openGraph("/explore", `${TITLE} · Orbitly`, DESCRIPTION),
  twitter: TWITTER,
};

/**
 * The public, read-only marketplace. It only ever shows the bundled illustrative examples: it reads no database,
 * no requests, offers or trips, and has nothing to book, pay or accept. Real listings stay behind MARKETPLACE_OPEN
 * and sign-in (/requests, /trips) until a reviewed public listing source exists.
 */
export default function ExplorePage() {
  return (
    <div className="flex flex-1 flex-col bg-white text-navy">
      <SiteHeader />
      <main className="flex-1">
        <section aria-labelledby="explore-title" className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-[0.12em] text-teal-ink uppercase">Marketplace preview</p>
              <h1 id="explore-title" className="mt-3 font-heading text-[clamp(1.9rem,5.5vw,3rem)] leading-[1.08] font-semibold tracking-[-0.02em] text-balance">
                {TITLE}
              </h1>
              <p className="mt-3 text-[1.05rem] leading-relaxed text-muted">Discover products travelling across borders with people already making the journey.</p>
            </div>
            <Badge tone="warning" className="self-start sm:self-auto">Illustrative examples, not real orders</Badge>
          </div>

          <Alert tone="info" title="These are examples, not live listings" className="mt-6">
            The marketplace isn’t open yet. Every product, route, price and traveller here is illustrative: none can be bought, booked or paid for, and
            no real buyer or traveller is shown.
          </Alert>

          <JourneyFeed journeys={EXAMPLE_JOURNEYS} example limit={Infinity} searchable />
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Illustrative prices in rupees, as Orbitly offers are today; prices abroad use rough, illustrative rates. Open a journey for the full breakdown,
            including Orbitly’s 3% buyer fee. Customs, if any, is a separate estimated cost, and the actual duty may differ.
          </p>

          <div className="mt-10 rounded-card bg-sand px-5 py-8 sm:px-8">
            <h2 className="font-heading text-xl font-semibold">Want something like this?</h2>
            <p className="mt-1.5 text-muted">Ask for a product from another country, or see how travelling with Orbitly works.</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link href="/#start" className={buttonClass({ size: "lg" })}>
                Ask for something
                <Icon d={ICONS.arrow} className="size-5" />
              </Link>
              <Link href="/travel" className={buttonClass({ variant: "secondary", size: "lg" })}>
                <Icon d={ICONS.plane} className="size-5" />
                I’m travelling
              </Link>
              {SIGNUPS_OPEN && (
                <Link href="/signup" className={buttonClass({ variant: "secondary", size: "lg" })}>
                  Create an account
                </Link>
              )}
            </div>
            <p className="mt-4 text-sm text-muted">
              Curious what happens after an offer is accepted?{" "}
              <Link href="/tracking" className="font-semibold text-teal-ink hover:underline">
                See how order tracking will work
              </Link>
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
