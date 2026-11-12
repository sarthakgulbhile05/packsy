import { Icon, ICONS, SectionIntro } from "./sections";

// Every "in place" line is enforced in code or database rules today (see supabase/migrations: offers_complete,
// itemised cost columns, request privacy, offer visibility; Turnstile and rate limits on auth). Phone
// verification is enforced too, but stays "being tested" until SMS delivery works. Move an item up only once it works.
const STATUS = [
  {
    title: "In place today",
    note: "Enforced by Orbitly’s code and database rules.",
    dot: "bg-teal",
    items: [
      ["Itemised offers", "Product price, traveller reward and Orbitly’s fee are each shown separately. Offers don’t include customs or delivery estimates yet."],
      ["Complete offers only", "Every offer needs an arrival date, a hand-over method and the traveller’s declaration that the item is lawful to carry on that route."],
      ["Private by default", "Requests stay private until you publish them. Offers are visible only to you and the traveller."],
      ["Protected accounts", "Bot checks and rate limits on sign-in, and secure password resets."],
    ],
  },
  {
    title: "Being tested",
    note: "Built, and not switched on yet.",
    dot: "bg-info",
    items: [
      ["Phone verification", "Requests and offers are blocked until a phone number is verified. Text-message delivery is still being set up."],
      ["Saving requests to your account", "Off until its privacy rules are verified. Until then, requests stay on your device."],
    ],
  },
  {
    title: "Planned",
    note: "Not available yet.",
    dot: "bg-line-strong",
    items: [
      ["Accepting offers in Orbitly", ""],
      ["Messages between buyer and traveller", ""],
      ["Delivery check-ins and confirmation", ""],
      ["ID document verification", ""],
      ["Reviews after completed journeys", ""],
    ],
  },
] as const;

export function Trust() {
  return (
    <section aria-labelledby="trust-title" id="trust" className="scroll-mt-24 -mx-5 bg-mist px-5 py-20 sm:mx-0 sm:rounded-card sm:px-10 sm:py-16 lg:px-14">
      <SectionIntro
        id="trust-title"
        eyebrow="Trust and safety"
        title="Good connections begin with trust."
        text="Before anyone spends a rupee, both sides should know exactly who, what, how much and when. Here’s what Orbitly does today, what’s being tested, and what’s still to come."
      />

      <div className="mt-10 grid overflow-hidden rounded-card border border-line bg-white lg:grid-cols-[1.35fr_1fr_1fr]">
        {STATUS.map((col, i) => (
          <div key={col.title} className={`min-w-0 p-6 sm:p-7 ${i > 0 ? "border-t border-line lg:border-t-0 lg:border-l" : ""}`}>
            <h3 className="flex items-center gap-2 font-semibold text-navy">
              <span aria-hidden="true" className={`size-2 rounded-full ${col.dot}`} />
              {col.title}
            </h3>
            <p className="mt-1 text-sm text-muted">{col.note}</p>
            <ul className="mt-5 space-y-3.5">
              {col.items.map(([title, text]) => (
                <li key={title} className="text-[0.95rem]">
                  <span className={text ? "font-semibold text-navy" : "text-ink"}>{title}</span>
                  {text && <span className="mt-0.5 block text-sm leading-relaxed text-muted">{text}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-5 flex gap-3 rounded-2xl border border-line bg-white p-4 text-[0.95rem] leading-relaxed text-ink">
        <Icon d={ICONS.shield} className="mt-0.5 size-5 shrink-0 text-teal-ink" />
        <span>
          <strong className="font-semibold text-navy">Not offered:</strong> Orbitly doesn’t handle payments, and doesn’t offer payment protection,
          refunds, insurance or guaranteed delivery. We’ll say so plainly here until that changes.
        </span>
      </p>
    </section>
  );
}
