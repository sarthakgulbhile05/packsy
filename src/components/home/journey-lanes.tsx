"use client";

import { useState } from "react";
import { CurrencySelect, RateNote } from "@/components/currency/currency";
import { inputClass } from "@/components/ui/field";
import { DIRECTION_LABEL, previewJourneys, searchJourneys, type DirectionFilter, type Journey } from "@/lib/journey";
import { JourneyCard } from "./journey-card";

const FILTERS: [DirectionFilter, string][] = [
  ["all", "All"],
  ["into_india", DIRECTION_LABEL.into_india],
  ["out_of_india", DIRECTION_LABEL.out_of_india],
];
// Columns follow the number of cards, so three never leave an empty fourth slot.
const COLUMNS = ["", "", "sm:grid-cols-2", "sm:grid-cols-2 lg:grid-cols-3", "sm:grid-cols-2 lg:grid-cols-4"];

/**
 * One marketplace, two directions: a single feed with one filter. Each card says which way it travels.
 * The homepage shows a short preview; /explore passes `limit={Infinity}` and `searchable`.
 */
export function JourneyFeed({ journeys, example, limit = 4, searchable = false }: { journeys: Journey[]; example: boolean; limit?: number; searchable?: boolean }) {
  const [filter, setFilter] = useState<DirectionFilter>("all");
  const [query, setQuery] = useState("");
  const shown = previewJourneys(searchJourneys(journeys, query), filter, limit);

  return (
    <>
      {searchable && (
        <div className="mt-7">
          <label htmlFor="marketplace-search" className="text-sm font-medium text-ink">
            Search products and cities
          </label>
          <input
            id="marketplace-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. sneakers, London"
            aria-controls="marketplace-feed"
            autoComplete="off"
            className={`${inputClass} mt-1.5`}
          />
        </div>
      )}
      <div className={`${searchable ? "mt-4" : "mt-7"} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div role="group" aria-label="Show examples by direction" className="grid grid-cols-3 gap-1 rounded-full border border-line bg-white p-1 sm:inline-flex">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              aria-controls="marketplace-feed"
              onClick={() => setFilter(id)}
              className="min-h-10 rounded-full px-1 text-[0.8125rem] font-semibold whitespace-nowrap text-muted transition-colors hover:text-navy focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none aria-pressed:bg-navy aria-pressed:text-white motion-reduce:transition-none sm:px-4 sm:text-sm"
            >
              {label}
            </button>
          ))}
        </div>
        <CurrencySelect />
      </div>
      <RateNote className="mt-2 sm:text-right" currency="INR" />

      {shown.length > 0 ? (
        <ul id="marketplace-feed" aria-live="polite" className={`mt-5 grid gap-3 sm:gap-5 ${COLUMNS[Math.min(shown.length, 4)]}`}>
          {shown.map((j) => (
            <li key={j.id} className="flex min-w-0">
              <JourneyCard journey={j} example={example} />
            </li>
          ))}
        </ul>
      ) : (
        <div id="marketplace-feed" aria-live="polite" className="mt-5 rounded-card border border-dashed border-line-strong px-5 py-8 text-center text-sm text-muted">
          {query.trim() ? (
            <>
              <p>Nothing matches “{query.trim()}”{filter !== "all" && ` in ${DIRECTION_LABEL[filter]}`}.</p>
              <button type="button" onClick={() => setQuery("")} className="mt-3 min-h-11 rounded-control px-3 font-semibold text-teal-ink hover:underline focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none">
                Clear search
              </button>
            </>
          ) : (
            <p>Nothing in this direction yet.</p>
          )}
        </div>
      )}
    </>
  );
}
