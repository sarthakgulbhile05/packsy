import Link from "next/link";
import { OrbitlyLogo } from "@/components/brand/orbitly-logo";
import { CurrencySelect } from "@/components/currency/currency";

const COLUMNS = [
  {
    title: "Marketplace",
    links: [
      { href: "/#start", label: "Shop" },
      { href: "/travel", label: "Travel" },
      { href: "/#how", label: "How it works" },
      { href: "/#trust", label: "Trust and safety" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Log in" },
      { href: "/signup", label: "Sign up" },
      { href: "/profile", label: "Profile" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy (draft)" },
      { href: "/terms", label: "Terms & Conditions (draft)" },
    ],
  },
];

/** Footer for marketing pages: the same destinations as the header, grouped. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-mist">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-12 sm:grid-cols-3 sm:px-8 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="sm:col-span-3 lg:col-span-1">
          <OrbitlyLogo className="w-[84px]" priority={false} />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">Products travel with people, between India and the world. Early public preview.</p>
          <CurrencySelect className="mt-4" />
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="text-sm font-semibold text-navy">{c.title}</h2>
            <ul className="mt-3 space-y-1">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-9 items-center text-sm text-muted hover:text-teal-ink focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  );
}
