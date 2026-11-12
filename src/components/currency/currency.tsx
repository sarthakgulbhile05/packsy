"use client";

import { useId } from "react";
import { convert, DISPLAY_CURRENCIES, formatCurrency, toMajor } from "@/lib/currency";
import { setDisplayCurrency, useDisplayCurrency, useRates } from "@/lib/display-currency";
import { isCurrency, type Currency } from "@/lib/pricing";

// Display only. These components add an approximate line next to amounts the page already shows in their
// original currency; they never replace or recalculate one.

const NAMES: Record<Currency, string> = {
  INR: "Indian rupee", USD: "US dollar", EUR: "Euro", GBP: "British pound", AED: "UAE dirham", JPY: "Japanese yen", SGD: "Singapore dollar",
};

/**
 * "Approx. $305.00" for an amount shown elsewhere in its own currency. Renders nothing when the buyer's display
 * currency is the same, while rates load, or when no trustworthy rate exists: the original amount stands alone.
 */
export function ApproxAmount({ amount, minor, currency, className = "text-xs text-muted" }: { amount?: number; minor?: number; currency: string; className?: string }) {
  const display = useDisplayCurrency();
  const rates = useRates();
  if (!display || !isCurrency(currency) || display.currency === currency || !rates || rates === "loading" || !rates.ok) return null;
  const value = minor !== undefined ? toMajor(minor, currency) : amount;
  const formatted = formatCurrency(convert(value, currency, display.currency, rates.rates), display.currency);
  if (!formatted) return null;
  return (
    <span className={`block ${className}`}>
      Approx. {formatted}
      {rates.stale && <span className="text-warning"> · older rate</span>}
    </span>
  );
}

/**
 * One line about the conversion: what it is, how old the rate is, and that it isn't a payment amount. Pass the
 * amounts' own `currency` and it stays hidden when nothing is converted (the buyer views that same currency).
 */
export function RateNote({ className = "", currency }: { className?: string; currency?: string }) {
  const display = useDisplayCurrency();
  const rates = useRates();
  if (!display || !rates || rates === "loading" || display.currency === currency) return null;
  if (!rates.ok) return <p className={`text-xs text-muted ${className}`}>Conversions are unavailable right now, so amounts show in their original currency.</p>;
  const day = new Date(`${rates.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const unsupported = !rates.rates[display.currency];
  const stale = rates.stale;
  return (
    <p className={`text-xs text-muted ${className}`}>
      {unsupported
        ? `No reference rate is published for ${display.currency}, so amounts show in their original currency. `
        : `Indicative conversion only, not a payment amount. `}
      <span className={stale ? "text-warning" : ""}>
        {stale ? "Older rate" : "Rate"} from {day}
      </span>{" "}
      · {rates.source}, via {rates.provider}.
    </p>
  );
}

/** "Show prices in": automatic (from the browser's region) or a currency the buyer picks, saved on this device. */
export function CurrencySelect({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const id = useId();
  const display = useDisplayCurrency();
  const rates = useRates();
  const known = rates && rates !== "loading" && rates.ok ? rates.rates : null;
  const dark = tone === "dark";
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm ${className}`}>
      <label htmlFor={id} className={`whitespace-nowrap ${dark ? "text-white/70" : "text-muted"}`}>
        Show prices in
      </label>
      <select
        id={id}
        value={display?.preference ?? "auto"}
        disabled={!display}
        onChange={(e) => setDisplayCurrency(isCurrency(e.target.value) ? e.target.value : "auto")}
        className={`min-h-10 max-w-full min-w-0 rounded-control border px-2.5 text-sm font-semibold focus-visible:ring-4 focus-visible:ring-teal/30 focus-visible:outline-none ${
          dark ? "border-white/25 bg-navy text-white" : "border-line-strong bg-white text-navy"
        }`}
      >
        <option value="auto">Automatic{display ? ` (${display.auto})` : ""}</option>
        {DISPLAY_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c} · {NAMES[c]}
            {known && !known[c] ? " (original only)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
