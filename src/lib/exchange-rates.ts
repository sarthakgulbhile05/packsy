import "server-only";
import { CURRENCIES, type Currency } from "./pricing";
import { isStaleRate, type RatesPayload, type RateTable } from "./currency";

// Indicative exchange rates for display. Source: Frankfurter, a free, keyless service that republishes the
// European Central Bank's daily reference rates (working days, around 16:00 CET). No credentials. The ECB doesn't
// publish AED, so AED has no rate and shows in its original currency only.
export const PROVIDER = {
  name: "Frankfurter",
  source: "European Central Bank reference rates",
  url: `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${CURRENCIES.filter((c) => c !== "EUR").join(",")}`,
};

const REFRESH_MS = 6 * 60 * 60 * 1000; // re-fetch at most four times a day per server instance
const KEEP_MS = 7 * 24 * 60 * 60 * 1000; // after a failed fetch, an older copy is served (marked stale) for up to a week
const TIMEOUT_MS = 5000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The provider's reply, checked field by field. Null if anything is off: we never show a rate we can't trust. */
export function parseProviderResponse(json: unknown, now: number): { date: string; rates: RateTable } | null {
  if (typeof json !== "object" || json === null) return null;
  const { base, date, rates } = json as { base?: unknown; date?: unknown; rates?: unknown };
  if (base !== "EUR" || typeof date !== "string" || !DAY.test(date)) return null;
  const at = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(at) || at > now + 36 * 60 * 60 * 1000) return null; // invalid, or a date in the future
  if (typeof rates !== "object" || rates === null) return null;
  const table: RateTable = { EUR: 1 };
  for (const c of CURRENCIES) {
    const v = (rates as Record<string, unknown>)[c];
    if (v === undefined) continue; // not published (AED)
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
    table[c as Currency] = v;
  }
  if (!table.INR) return null; // every Orbitly transaction amount is in rupees; without INR nothing converts
  return { date, rates: table };
}

/**
 * A rate source with an in-memory copy. Injectable fetch and clock for tests.
 * shortcut: the copy is per server instance (like the rate limiter); fine for read-only, low-stakes display data.
 */
export function createRateSource({ fetchImpl = fetch, now = () => Date.now() }: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
  let last: { date: string; rates: RateTable; fetchedAt: number } | null = null;

  const payload = (copy: NonNullable<typeof last>, failed: boolean): RatesPayload => ({
    ok: true,
    provider: PROVIDER.name,
    source: PROVIDER.source,
    base: "EUR",
    date: copy.date,
    fetchedAt: new Date(copy.fetchedAt).toISOString(),
    stale: isStaleRate({ stale: failed, date: copy.date }, now()),
    rates: copy.rates,
  });

  return async function getRates(): Promise<RatesPayload> {
    const t = now();
    if (last && t - last.fetchedAt < REFRESH_MS) return payload(last, false);
    try {
      const res = await fetchImpl(PROVIDER.url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const parsed = parseProviderResponse(await res.json(), t);
      if (!parsed) throw new Error("malformed");
      last = { ...parsed, fetchedAt: t };
      return payload(last, false);
    } catch (error) {
      console.error("[rates] fetch failed", { reason: error instanceof Error ? error.name === "TimeoutError" ? "timeout" : error.message.slice(0, 40) : "unknown" });
      if (last && t - last.fetchedAt < KEEP_MS) return payload(last, true);
      return { ok: false, reason: "Exchange rates are unavailable right now." };
    }
  };
}

export const getRates = createRateSource();
