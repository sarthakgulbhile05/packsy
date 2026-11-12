// Display currency: how a buyer chooses to *see* an amount. Informational only. It never feeds the pricing engine
// (src/lib/pricing.ts), never changes a stored amount, and is never a payment quote. Conversions here use plain
// numbers because they're for reading, not for money that changes hands; the engine stays integer-exact.
import { CURRENCIES, isCurrency, MINOR_DIGITS, type Currency } from "./pricing";

export const DISPLAY_CURRENCIES = CURRENCIES;

/** Rates against one base, as the provider publishes them: units of each currency per 1 base unit. */
export type RateTable = Partial<Record<Currency, number>>;

/** What /api/rates returns. `stale`: the provider's date is old, or the latest fetch failed and an older copy is served. */
export type RatesPayload =
  | { ok: true; provider: string; source: string; base: Currency; date: string; fetchedAt: string; stale: boolean; rates: RateTable }
  | { ok: false; reason: string };

/** The ECB skips weekends and holidays; a rate dated more than this many days ago is labelled as older. */
export const STALE_AFTER_DAYS = 4;

/**
 * Whether a rate must be labelled as older. Checked again wherever it's shown, not only when the server fetched
 * it, because caches (CDN, browser, a tab left open) can keep a payload around after its date has aged.
 */
export function isStaleRate(payload: { stale: boolean; date: string }, now: number): boolean {
  const at = Date.parse(`${payload.date}T00:00:00Z`);
  return payload.stale || !Number.isFinite(at) || now - at > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

// One locale per currency, so a currency always reads the way its own users write it (lakh grouping for INR).
const LOCALE: Record<Currency, string> = { INR: "en-IN", USD: "en-US", EUR: "en-IE", GBP: "en-GB", AED: "en-AE", JPY: "en-US", SGD: "en-SG" };

/** A major-unit amount, formatted. Null for anything that isn't a finite number in a supported currency. */
export function formatCurrency(value: unknown, currency: unknown): string | null {
  if (!isCurrency(currency) || typeof value !== "number" || !Number.isFinite(value)) return null;
  const digits = MINOR_DIGITS[currency];
  return new Intl.NumberFormat(LOCALE[currency], { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Minor units (paise, cents) → major units. */
export const toMajor = (minor: number, currency: Currency) => minor / 10 ** MINOR_DIGITS[currency];

/**
 * An amount from one currency in another, via the table's base. Null when either rate is missing or invalid,
 * so callers show the original amount instead of a guess.
 */
export function convert(amount: unknown, from: unknown, to: unknown, rates: RateTable | null | undefined): number | null {
  if (!rates || !isCurrency(from) || !isCurrency(to) || typeof amount !== "number" || !Number.isFinite(amount)) return null;
  if (from === to) return amount;
  const a = rates[from];
  const b = rates[to];
  if (!(typeof a === "number" && a > 0 && Number.isFinite(a)) || !(typeof b === "number" && b > 0 && Number.isFinite(b))) return null;
  return (amount / a) * b;
}

// Countries whose currency we can display, by ISO 3166 region code. Euro area members map to EUR.
const EURO = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"];
const REGION_CURRENCY: Record<string, Currency> = {
  IN: "INR", US: "USD", GB: "GBP", AE: "AED", JP: "JPY", SG: "SGD",
  ...Object.fromEntries(EURO.map((r) => [r, "EUR" as const])),
};

/** Orbitly's home market, used when the browser gives no usable region. */
export const FALLBACK_CURRENCY: Currency = "INR";

/**
 * The automatic choice: the first browser locale that names a region we know (en-GB → GBP). Language alone
 * ("en", "fr") says nothing about where someone lives, so it's skipped. No location or IP lookup is used.
 */
export function autoCurrency(locales: readonly string[] | undefined | null): Currency {
  for (const tag of locales ?? []) {
    try {
      const region = new Intl.Locale(tag).region;
      if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    } catch {
      // not a valid locale tag; try the next one
    }
  }
  return FALLBACK_CURRENCY;
}

/** The stored preference: "auto", or a currency the buyer picked. Anything else reads as auto. */
export type CurrencyPreference = "auto" | Currency;
export const parsePreference = (raw: unknown): CurrencyPreference => (isCurrency(raw) ? raw : "auto");
