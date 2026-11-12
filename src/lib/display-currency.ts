"use client";

import { useSyncExternalStore } from "react";
import { autoCurrency, isStaleRate, parsePreference, type CurrencyPreference, type RatesPayload } from "./currency";
import type { Currency } from "./pricing";

// The buyer's display-currency preference, on this device only (no account or profile field). localStorage when
// it works, otherwise it lasts for the tab. Storage can throw (private modes, blocked cookies), so every access is guarded.
const KEY = "orbitly.displayCurrency";
let memory: CurrencyPreference = "auto";
const listeners = new Set<() => void>();

export type PreferenceStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Reads the saved choice; "auto" when there's none, it's unreadable, or it isn't a currency we show. */
export function readPreference(storage: PreferenceStore | null): CurrencyPreference {
  try {
    const raw = storage?.getItem(KEY);
    return raw === null || raw === undefined ? memory : parsePreference(raw);
  } catch {
    return memory;
  }
}

/** Saves a manual choice, or clears it to go back to automatic. Automatic detection never writes here. */
export function writePreference(storage: PreferenceStore | null, pref: CurrencyPreference) {
  memory = pref;
  try {
    if (pref === "auto") storage?.removeItem(KEY);
    else storage?.setItem(KEY, pref);
  } catch {
    // kept in memory for this tab
  }
  listeners.forEach((l) => l());
}

const storage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange(); // other tabs
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Null on the server and during hydration, so server and client render the same; then the real choice. */
export function useDisplayCurrency(): { preference: CurrencyPreference; currency: Currency; auto: Currency } | null {
  const pref = useSyncExternalStore(subscribe, () => readPreference(storage()), () => null);
  if (pref === null) return null;
  const auto = autoCurrency(typeof navigator === "undefined" ? [] : navigator.languages);
  return { preference: pref, currency: pref === "auto" ? auto : pref, auto };
}

export const setDisplayCurrency = (pref: CurrencyPreference) => writePreference(storage(), pref);

// Rates: fetched once per page load, however many amounts are on screen.
let ratesState: RatesPayload | "loading" | null = null;
const rateListeners = new Set<() => void>();

const UNAVAILABLE: RatesPayload = { ok: false, reason: "Exchange rates are unavailable right now." };

/**
 * Never throws and never blocks: any failure (network, 503, junk) becomes "unavailable", and amounts stay original.
 * Staleness is re-checked here, against this browser's clock, because a CDN or browser cache can hand back a
 * payload the server marked current after its date has aged.
 */
export async function fetchRates(fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<RatesPayload> {
  try {
    const payload: unknown = await (await fetchImpl("/api/rates")).json();
    if (typeof payload !== "object" || payload === null || !("ok" in payload)) return UNAVAILABLE;
    const p = payload as RatesPayload;
    if (!p.ok) return p;
    if (typeof p.date !== "string" || typeof p.rates !== "object" || p.rates === null || typeof p.provider !== "string") return UNAVAILABLE;
    return { ...p, stale: isStaleRate(p, now()) };
  } catch {
    return UNAVAILABLE;
  }
}

function loadRates() {
  if (ratesState !== null) return;
  ratesState = "loading";
  void fetchRates().then((payload) => {
    ratesState = payload;
    rateListeners.forEach((l) => l());
  });
}

function subscribeRates(onChange: () => void) {
  rateListeners.add(onChange);
  loadRates();
  return () => void rateListeners.delete(onChange);
}

/** "loading", then the payload (which may say rates are unavailable). Null on the server. */
export function useRates(): RatesPayload | "loading" | null {
  return useSyncExternalStore(subscribeRates, () => ratesState ?? "loading", () => null);
}
