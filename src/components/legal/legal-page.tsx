import Link from "next/link";
import { SiteFooter } from "@/components/nav/site-footer";
import { SiteHeader } from "@/components/nav/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export type LegalSection = { id: string; title: string; body: React.ReactNode };

export const DRAFT_NOTICE = "Draft — Pending Legal Review";
export const LAST_UPDATED = "12 November 2026";

// Prose styles for section bodies, so the page files stay plain JSX.
const PROSE =
  "mt-3 space-y-3 text-[0.97rem] leading-relaxed text-ink [&_a]:font-semibold [&_a]:text-teal-ink [&_a:hover]:underline [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-navy [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-navy [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5";

function Contents({ sections }: { sections: LegalSection[] }) {
  return (
    <ol className="space-y-1 text-sm">
      {sections.map((s, i) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            className="flex gap-2 rounded-control px-2 py-1.5 text-muted hover:bg-mist hover:text-teal-ink focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none"
          >
            <span className="w-5 shrink-0 tabular-nums">{i + 1}.</span>
            <span>{s.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Shared layout for the draft Privacy Policy and Terms pages: draft notice, contents, numbered sections. */
export function LegalPage({ title, intro, sections, other }: { title: string; intro: React.ReactNode; sections: LegalSection[]; other: { href: string; label: string } }) {
  return (
    <div className="flex flex-1 flex-col bg-white text-navy">
      <SiteHeader />
      <main className="flex-1">
        <section aria-labelledby="legal-title" className="border-b border-line bg-sand">
          <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
            <Badge tone="warning">{DRAFT_NOTICE}</Badge>
            <h1 id="legal-title" className="mt-4 font-heading text-[clamp(1.9rem,5.5vw,3rem)] leading-[1.08] font-semibold tracking-[-0.02em] text-balance">
              {title}
            </h1>
            <p className="mt-3 text-sm text-muted">Last updated {LAST_UPDATED}. Not yet in effect.</p>
            <Alert tone="warning" title={DRAFT_NOTICE} className="mt-6 max-w-3xl">
              This is a working draft for review by qualified legal counsel. It hasn’t been legally approved, it isn’t in effect, and it may change
              before it is. Where something hasn’t been decided yet, this draft says so rather than guessing.
            </Alert>
            <div className="mt-6 max-w-3xl text-[1.05rem] leading-relaxed text-ink">{intro}</div>
          </div>
        </section>

        <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12 lg:py-14">
          <nav aria-label="On this page" className="lg:sticky lg:top-8 lg:self-start">
            <details className="rounded-card border border-line bg-white p-3 lg:hidden">
              <summary className="cursor-pointer rounded-control px-2 py-1.5 text-sm font-semibold text-navy focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none">
                On this page
              </summary>
              <div className="mt-2">
                <Contents sections={sections} />
              </div>
            </details>
            <div className="hidden lg:block">
              <p className="px-2 text-xs font-semibold tracking-[0.12em] text-muted uppercase">On this page</p>
              <div className="mt-2">
                <Contents sections={sections} />
              </div>
            </div>
          </nav>

          <div className="min-w-0 max-w-3xl">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-6 border-b border-line py-7 first:pt-0 last:border-b-0">
                <h2 id={`${s.id}-title`} className="font-heading text-xl font-semibold sm:text-2xl">
                  <span className="mr-2 text-subtle tabular-nums">{i + 1}.</span>
                  {s.title}
                </h2>
                <div className={PROSE}>{s.body}</div>
              </section>
            ))}
            <p className="mt-8 text-sm text-muted">
              See also the{" "}
              <Link href={other.href} className="font-semibold text-teal-ink hover:underline">
                {other.label}
              </Link>
              , also a draft pending legal review.
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
