import { DIRECTION_LABEL, type JourneyDirection } from "@/lib/journey";

// One look for the two directions everywhere: teal into India, navy out of it. Two halves of one marketplace.
export const DIRECTION_DOT = { into_india: "bg-teal", out_of_india: "bg-navy" } as const;
const CHIP = { into_india: "bg-teal-soft text-teal-ink", out_of_india: "bg-navy/[0.07] text-navy" } as const;
export const DIRECTION_ROUTE = { into_india: ["Abroad", "India"], out_of_india: ["India", "Abroad"] } as const;

/** "Into India" / "Out of India", as a small labelled chip. */
export function DirectionChip({ direction, className = "" }: { direction: JourneyDirection; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP[direction]} ${className}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${DIRECTION_DOT[direction]}`} />
      {DIRECTION_LABEL[direction]}
    </span>
  );
}

/** A dashed route that reads left to right, the way the item travels; a light runs along it unless motion is reduced. */
export function RouteArrow({ className = "h-3 w-14 text-navy/45" }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 12" className={`trust-route ${className}`} aria-hidden="true">
      <path d="M2 6 H 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 4" />
      <path d="M2 6 H 48" pathLength={1} fill="none" stroke="var(--color-teal)" strokeWidth="2.5" strokeLinecap="round" className="tr-travel" />
      <path d="M47 2 L 53 6 L 47 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
