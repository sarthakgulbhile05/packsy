import Image from "next/image";
import Link from "next/link";
import { ICONS, Journey, TRAVELLER_STEPS } from "@/components/home/sections";
import { SiteFooter } from "@/components/nav/site-footer";
import { SiteHeader } from "@/components/nav/site-header";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { JsonLd } from "@/components/seo/json-ld";
import { MARKETPLACE_OPEN, SIGNUPS_OPEN } from "@/lib/preview";
import { PRICING_POLICY } from "@/lib/pricing";
import { openGraph, publicOrigin, SITE_NAME, TWITTER } from "@/lib/site";
// Photo: Surface (C-o9HNzQ_rA), Unsplash License. Illustrative.
import packing from "../../../public/people/packing.jpg";

const TITLE = "Carry requests along your route";
const DESCRIPTION =
  "Travelling between countries? See how travellers can carry products for people at their destination, in either direction, and set their own fee. Trip listings open soon: Orbitly is in early public preview.";

export const metadata = { title: TITLE, description: DESCRIPTION, alternates: { canonical: "/travel" }, openGraph: openGraph("/travel", `${TITLE} · Orbitly`, DESCRIPTION), twitter: TWITTER };

function travelJsonLd() {
  const origin = publicOrigin();
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${origin}/travel#webpage`,
    url: `${origin}/travel`,
    name: `${TITLE} · Orbitly`,
    description: DESCRIPTION,
    inLanguage: "en-IN",
    isPartOf: { "@type": "WebSite", "@id": `${origin}/#website`, name: SITE_NAME, url: `${origin}/` },
  };
}

const GOOD_TO_KNOW = [
  { title: "You choose what to carry", text: "Only offer on items you’re comfortable buying and packing. You can always say no." },
  { title: "You set your fee", text: "Each offer shows the product price and your fee separately, so buyers see exactly what they pay you." },
  { title: "Customs still apply", text: "Stay within the customs allowances of both countries and your airline’s rules, and declare what you carry. Some products can’t be carried." },
];

/** The traveller side. Trip listings aren't built yet, so this page says so plainly and shows the path. */
export default function TravelPage() {
  return (
    <div className="flex flex-1 flex-col bg-white text-navy">
      <JsonLd data={travelJsonLd()} />
      <SiteHeader />
      <main className="flex-1">
        <section aria-labelledby="travel-title" className="border-b border-sand-deep bg-sand">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
            <div>
            <p className="text-sm font-semibold tracking-[0.12em] text-teal-ink uppercase">Travel</p>
            <h1 id="travel-title" className="mt-4 max-w-3xl font-heading text-[clamp(2rem,6vw,3.25rem)] leading-[1.08] font-semibold tracking-[-0.02em]">
              Already travelling? Your spare luggage space can help someone.
            </h1>
            <p className="mt-5 max-w-2xl text-[1.05rem] leading-relaxed text-muted sm:text-lg">
              Share your trip, from India to abroad or abroad to India, see requests on exactly that route, and earn the reward you set for carrying what they want.
            </p>
            <p className="mt-3 max-w-2xl text-sm text-muted">
              You set your reward, in whole rupees from ₹1. Orbitly keeps {PRICING_POLICY.travellerFeeBps / 100}% of it and you receive the rest;
              there’s no guaranteed payout. Every offer shows your reward, the fee and what you’d receive before you send it.
            </p>
            {MARKETPLACE_OPEN ? (
              <div className="mt-8">
                <Link href="/trips" className={buttonClass({ size: "lg" })}>
                  Share a trip
                </Link>
              </div>
            ) : (
            <>
            <Alert tone="info" title="Trip listings open soon" className="mt-8 max-w-2xl">
              {SIGNUPS_OPEN
                ? "You can’t post a trip yet. Create an account and verify your phone now, and you’ll be ready to offer as soon as trips open."
                : "You can’t post a trip yet, and new accounts open soon. Orbitly is in an early public preview."}
            </Alert>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              {SIGNUPS_OPEN && (
                <Link href="/signup" className={buttonClass({ size: "lg" })}>
                  Create an account
                </Link>
              )}
              <Link href="/login" className={buttonClass({ variant: SIGNUPS_OPEN ? "secondary" : "primary", size: "lg" })}>
                Log in
              </Link>
            </div>
            </>
            )}
            </div>
            <figure className="mx-auto w-full max-w-md lg:max-w-none">
              <div className="relative aspect-[4/3] overflow-hidden rounded-[1.75rem] bg-sand-deep shadow-raised lg:aspect-[4/5]">
                <Image
                  src={packing}
                  alt="Someone packing a suitcase, seen from above"
                  fill
                  priority
                  placeholder="blur"
                  sizes="(min-width: 1024px) 420px, (min-width: 640px) 448px, 100vw"
                  className="hero-photo object-cover object-[60%_50%]"
                />
              </div>
              <figcaption className="mt-2.5 text-right text-xs text-muted">Illustrative photo: Surface, Unsplash</figcaption>
            </figure>
          </div>
        </section>

        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <h2 className="sr-only">For travellers</h2>
          <Journey tone="dark" label="Travel" title="How it works for travellers" steps={TRAVELLER_STEPS} icon={ICONS.plane} />
          <section aria-labelledby="know-title">
            <h2 id="know-title" className="font-heading text-2xl font-semibold">
              Good to know
            </h2>
            <ul className="mt-6 space-y-6">
              {GOOD_TO_KNOW.map((g) => (
                <li key={g.title} className="border-l-2 border-teal pl-4">
                  <h3 className="font-semibold">{g.title}</h3>
                  <p className="mt-1 text-[0.95rem] leading-relaxed text-muted">{g.text}</p>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-sm text-muted">
              Want something from abroad instead?{" "}
              <Link href="/#start" className="font-semibold text-teal-ink hover:underline">
                Start a request
              </Link>
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
