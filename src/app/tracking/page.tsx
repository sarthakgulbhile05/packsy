import Link from "next/link";
import { DirectionChip } from "@/components/home/direction";
import { Icon, ICONS } from "@/components/home/sections";
import { SiteFooter } from "@/components/nav/site-footer";
import { SiteHeader } from "@/components/nav/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { PAYMENTS_UNAVAILABLE } from "@/lib/payments/flags";
import { MAIN_PATH, STATE_LABEL, type TransactionState } from "@/lib/payments/transaction";
import { NOINDEX } from "@/lib/site";

const TITLE = "How order tracking will work";

export const metadata = {
  title: TITLE,
  description: "A preview of how buyers and travellers will follow an Orbitly order, from payment to hand-over. Coming soon; payments aren’t available yet.",
  robots: NOINDEX,
};

// Where the illustrative order is shown to be. Purely for the picture: there is no real order behind this page.
const EXAMPLE_AT: TransactionState = "IN_TRANSIT";

const PAYOUT_CONDITIONS = [
  "The payment provider has confirmed the buyer’s payment",
  "The traveller has added purchase evidence",
  "The traveller has recorded the hand-over",
  "The buyer has confirmed delivery, or Orbitly’s review has finished",
  "No problem report or chargeback is open on the order",
];

const EVIDENCE = [
  { title: "Purchase evidence", text: "A receipt or invoice showing the item, its price and the date it was bought." },
  { title: "Delivery evidence", text: "A record of the hand-over, such as a photo or the buyer’s confirmation." },
];

function Timeline({ side, title }: { side: "buyer" | "traveller"; title: string }) {
  const current = MAIN_PATH.indexOf(EXAMPLE_AT as (typeof MAIN_PATH)[number]);
  return (
    <section aria-labelledby={`${side}-view`} className="min-w-0 rounded-card border border-line bg-white p-5 sm:p-6">
      <h2 id={`${side}-view`} className="font-heading text-lg font-semibold">
        {title}
      </h2>
      <ol className="mt-5 space-y-3.5">
        {MAIN_PATH.map((state, i) => {
          const status = i < current ? "done" : i === current ? "current" : "upcoming";
          return (
            <li key={state} className="flex items-start gap-3 text-sm" aria-current={status === "current" ? "step" : undefined}>
              {/* Neutral marks only: nothing here is a real confirmation, so no green ticks. */}
              <span
                aria-hidden="true"
                className={`mt-1 size-2.5 shrink-0 rounded-full ${
                  status === "done" ? "bg-navy/70" : status === "current" ? "bg-white ring-[3px] ring-teal" : "border border-line-strong bg-white"
                }`}
              />
              <span className={`min-w-0 flex-1 ${status === "upcoming" ? "text-muted" : "text-navy"}`}>
                {STATE_LABEL[state][side]}
                {status === "current" && <span className="ml-2 rounded-full bg-mist px-2 py-0.5 text-xs font-medium text-muted">Example position</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A preview of order tracking. Static and illustrative: it reads no data and offers no checkout. */
export default function TrackingPage() {
  return (
    <div className="flex flex-1 flex-col bg-white text-navy">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-[0.12em] text-teal-ink uppercase">Coming soon</p>
              <h1 className="mt-3 font-heading text-[clamp(1.9rem,5.5vw,3rem)] leading-[1.08] font-semibold tracking-[-0.02em] text-balance">{TITLE}</h1>
              <p className="mt-3 text-[1.05rem] leading-relaxed text-muted">
                Once payments open, buyers and travellers will follow each order step by step, from payment through purchase and the journey to the
                hand-over.
              </p>
            </div>
            <Badge tone="warning" className="self-start sm:self-auto">Illustrative, not a real order</Badge>
          </div>

          <Alert tone="warning" title="Not available yet" className="mt-6">
            {PAYMENTS_UNAVAILABLE} Nothing on this page is a real order, payment or payout, and the steps may change before launch.
          </Alert>

          <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
            <DirectionChip direction="into_india" />
            <span className="font-semibold text-navy">Example: wireless headphones, London to Mumbai</span>
            <span>Orders into and out of India follow the same steps.</span>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Timeline side="buyer" title="What the buyer sees" />
            <Timeline side="traveller" title="What the traveller sees" />
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-3">
            <section aria-labelledby="evidence-title">
              <h2 id="evidence-title" className="font-heading text-lg font-semibold">
                What travellers will add
              </h2>
              <ul className="mt-4 space-y-4">
                {EVIDENCE.map((e) => (
                  <li key={e.title} className="border-l-2 border-teal pl-4">
                    <h3 className="font-semibold">{e.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{e.text}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">Exact requirements will be confirmed before launch.</p>
            </section>

            <section aria-labelledby="payout-title">
              <h2 id="payout-title" className="font-heading text-lg font-semibold">
                When a traveller’s payout becomes eligible
              </h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {PAYOUT_CONDITIONS.map((c) => (
                  <li key={c} className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-navy/50" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Payouts are planned to go through a payment provider, not Orbitly, once one is chosen and approved, and would show as paid only after the provider confirms them. No provider is in place yet.
              </p>
            </section>

            <section aria-labelledby="problem-title">
              <h2 id="problem-title" className="font-heading text-lg font-semibold">
                If something goes wrong
              </h2>
              <p className="mt-4 text-sm leading-relaxed">
                Either side will be able to report a problem, such as an item that’s unavailable, delayed or not what was asked for. While a report is
                open, no payout or refund is sent, and a person at Orbitly reviews the order.
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Refund and dispute policies are still being written and reviewed. Nothing here is a promise of a particular outcome, delivery or refund.
              </p>
            </section>
          </div>

          <div className="mt-12 flex flex-col gap-3 sm:flex-row">
            <Link href="/explore" className={buttonClass({ size: "lg" })}>
              Explore the marketplace
              <Icon d={ICONS.arrow} className="size-5" />
            </Link>
            <Link href="/#start" className={buttonClass({ variant: "secondary", size: "lg" })}>
              Ask for something
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
