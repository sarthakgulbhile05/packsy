import Image, { type StaticImageData } from "next/image";
import handover from "../../../public/people/handover.jpg";
import recipient from "../../../public/people/recipient.jpg";
import traveller from "../../../public/people/traveller.jpg";

// The three people-moments behind every Orbitly request. Photos: Unsplash License (free for commercial use; no
// model releases, so they're labelled as illustrative and never presented as Orbitly members). traveller by
// krakenimages (FywFo9bHbLo), handover by RoseBox (BFdSCxmqvYc), recipient by Vitaly Gariev (WMMLed1OK1Y).
const MOMENTS: { label: string; title: string; text: string; image: StaticImageData; alt: string; focus: string }[] = [
  {
    label: "The traveller",
    title: "Already going.",
    text: "Flying London to Mumbai, or Delhi to Dubai, with a little room in their bag. They choose what they carry and set a reward that’s worth their while.",
    image: traveller,
    alt: "A woman standing in an airport terminal beside her suitcases",
    focus: "object-[50%_38%]",
  },
  {
    label: "The hand-over",
    title: "Agreed first, then met.",
    text: "Before anything is bought, both people review the item, the reward and the estimated costs in the offer. Then they hand it over the way they agreed.",
    image: handover,
    alt: "One person handing a sealed cardboard box to another",
    focus: "object-[50%_55%]",
  },
  {
    label: "The recipient",
    title: "Finally, theirs.",
    text: "Something they couldn’t find at home, brought by someone who was making the journey anyway.",
    image: recipient,
    alt: "A smiling man reaching into a cardboard box he has just opened",
    focus: "object-[50%_40%]",
  },
];

/** People helping people: the human side of the marketplace, before the step-by-step. */
export function Story() {
  return (
    <section aria-labelledby="story-title" id="people" className="scroll-mt-24 bg-sand py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-[0.12em] text-teal-ink uppercase">Why Orbitly exists</p>
          <h2 id="story-title" className="mt-3 font-heading text-[clamp(1.6rem,4.5vw,2.4rem)] leading-[1.15] font-semibold text-balance text-navy">
            People helping people, on journeys that already exist.
          </h2>
          <p className="mt-3 text-[1.05rem] leading-relaxed text-ink">
            Every day, people fly between countries with room to spare. Orbitly connects them with someone at the other end who wants
            something they can’t easily get.
          </p>
        </div>

        <ol className="mt-10 grid gap-6 sm:grid-cols-3 sm:gap-5 lg:gap-8">
          {MOMENTS.map((m, i) => (
            <li key={m.label} className="reveal">
              <div className="relative aspect-[3/2] overflow-hidden rounded-card bg-sand-deep sm:aspect-[4/5]">
                <Image src={m.image} alt={m.alt} fill placeholder="blur" sizes="(min-width: 1024px) 352px, (min-width: 640px) 33vw, 100vw" className={`object-cover ${m.focus}`} />
                <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-navy shadow-card">
                  {i + 1} · {m.label}
                </span>
              </div>
              <h3 className="mt-4 font-heading text-xl font-semibold text-navy">{m.title}</h3>
              <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink">{m.text}</p>
            </li>
          ))}
        </ol>

        <p className="mt-8 text-xs leading-relaxed text-muted">
          Photos are illustrative and show models, not Orbitly members. Credits: krakenimages, RoseBox and Vitaly Gariev, on Unsplash.
        </p>
      </div>
    </section>
  );
}
