import { SectionIntro } from "./sections";

// Answers must match what the product does today (see Trust's status board). Update both together.
// The home page's FAQPage structured data reads this list, so it always matches what's on screen.
export const QUESTIONS = [
  {
    q: "How does Orbitly work?",
    a: "Someone shares a product they want from another country, and where it should go. A traveller already making that exact journey, in the same direction, can offer to buy it and bring it in their luggage, for a fee they set. It works from abroad to India and from India to abroad. The buyer reviews the full offer before anything is bought.",
  },
  {
    q: "Can I request any product?",
    a: "Almost anything that’s lawful to take between the two countries and reasonable to carry in luggage. Rules depend on the item and the route, and some items can’t be carried at all. Every offer includes the traveller’s declaration that the item is lawful to carry and will be declared at customs.",
  },
  {
    q: "Can I share a photo instead of a link?",
    a: "Yes. Paste a link, add a photo or screenshot, or describe it in your own words. During the preview, your photo stays on your device.",
  },
  {
    q: "How do travellers take part?",
    a: "By sharing an upcoming trip: where they’re flying from, where to, and when. They see only requests on that exact route and direction, and offer on the ones that suit them. Trip listings open soon.",
  },
  {
    q: "How are traveller fees agreed?",
    a: "The traveller sets a fee in each offer, shown separately from the product price and any other costs. The buyer decides whether to accept. There’s no fixed fee, and no amount is guaranteed.",
  },
  {
    q: "What about customs and import rules?",
    a: "Customs and import rules depend on the item and on both countries. Travellers must stay within the rules and allowances of the countries they travel between, declare what they carry, and pay any duty due. Orbitly never promises duty-free delivery. Any customs estimate is listed as a separate cost in the offer.",
  },
  {
    q: "How are people verified?",
    a: "Orbitly requires a verified phone number before anyone can make a request or an offer. Text-message delivery is still being set up, so verification isn’t open yet. ID checks and reviews from completed journeys are planned.",
  },
  {
    q: "What if something goes wrong?",
    a: "Orbitly doesn’t handle payments yet, and doesn’t offer refunds, insurance or guaranteed delivery. Delivery check-ins and a way to report problems are planned.",
  },
  {
    q: "Is Orbitly open to everyone?",
    a: "Not yet. Orbitly is in early public preview: new accounts aren’t open, requests stay on your device, and no orders have been completed. The journeys on this page are examples.",
  },
];

export function Faq() {
  return (
    <section aria-labelledby="faq-title" id="faq" className="scroll-mt-24 py-20 sm:py-24">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.6fr] lg:gap-14">
        <SectionIntro id="faq-title" eyebrow="Questions" title="Questions people ask." text="Straight answers about how Orbitly works today." />
        <div className="min-w-0 divide-y divide-line border-y border-line">
          {QUESTIONS.map(({ q, a }, i) => (
            <details key={q} open={i === 0} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold text-navy focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full border border-line text-muted transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none">
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </span>
              </summary>
              <p className="pr-10 pb-4 text-[0.95rem] leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
