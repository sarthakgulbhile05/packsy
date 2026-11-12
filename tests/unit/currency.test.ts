import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_JOURNEYS } from "@/components/home/journey-examples";
import { autoCurrency, convert, FALLBACK_CURRENCY, formatCurrency, isStaleRate, parsePreference, toMajor, type RateTable } from "@/lib/currency";
import { fetchRates, readPreference, writePreference, type PreferenceStore } from "@/lib/display-currency";
import { createRateSource, parseProviderResponse } from "@/lib/exchange-rates";
import { journeyDirection, journeyPricing } from "@/lib/journey";
import { calculateOrderPricing, PRICING_POLICY, rupees } from "@/lib/pricing";

// Rates used only inside these tests (EUR base, made-up but well-formed). Never shown in the product.
const RATES: RateTable = { EUR: 1, INR: 100, USD: 1.25, GBP: 0.8, JPY: 160, SGD: 1.5 };
const NOW = Date.parse("2026-11-10T12:00:00Z");

describe("formatting", () => {
  it("formats each currency its own way, with the right precision", () => {
    expect(formatCurrency(1234567.5, "INR")).toBe("₹12,34,567.50");
    expect(formatCurrency(305, "USD")).toBe("$305.00");
    expect(formatCurrency(1234.5, "EUR")).toBe("€1,234.50");
    expect(formatCurrency(99.999, "GBP")).toBe("£100.00");
    expect(formatCurrency(1250.4, "JPY")).toBe("¥1,250");
  });

  it("handles zero, decimals and very large values", () => {
    expect(formatCurrency(0, "USD")).toBe("$0.00");
    expect(formatCurrency(0.05, "INR")).toBe("₹0.05");
    expect(formatCurrency(12_345_678_901.23, "USD")).toBe("$12,345,678,901.23");
  });

  it("returns null for missing, invalid and unsupported input instead of guessing", () => {
    expect(formatCurrency(undefined, "USD")).toBeNull();
    expect(formatCurrency(NaN, "USD")).toBeNull();
    expect(formatCurrency(Infinity, "USD")).toBeNull();
    expect(formatCurrency("100", "USD")).toBeNull();
    expect(formatCurrency(100, "XYZ")).toBeNull();
    expect(formatCurrency(100, "CAD")).toBeNull(); // real, but not one Orbitly shows
  });

  it("turns minor units into major units per currency", () => {
    expect(toMajor(243_334, "INR")).toBe(2433.34);
    expect(toMajor(1250, "JPY")).toBe(1250);
  });
});

describe("conversion", () => {
  it("converts through the base currency", () => {
    expect(convert(100, "INR", "USD", RATES)).toBeCloseTo(1.25);
    expect(convert(1, "USD", "INR", RATES)).toBeCloseTo(80);
    expect(convert(50, "EUR", "GBP", RATES)).toBeCloseTo(40);
  });

  it("returns the amount unchanged for the same currency", () => expect(convert(42.5, "INR", "INR", RATES)).toBe(42.5));

  it("refuses to convert without a usable rate", () => {
    expect(convert(100, "INR", "AED", RATES)).toBeNull(); // the ECB doesn't publish AED
    expect(convert(100, "INR", "USD", null)).toBeNull();
    expect(convert(100, "INR", "USD", { ...RATES, USD: 0 })).toBeNull();
    expect(convert(100, "INR", "USD", { ...RATES, USD: NaN })).toBeNull();
    expect(convert(NaN, "INR", "USD", RATES)).toBeNull();
    expect(convert(100, "XYZ", "USD", RATES)).toBeNull();
  });
});

describe("automatic currency", () => {
  it("uses the first browser locale with a region we know", () => {
    expect(autoCurrency(["en-IN"])).toBe("INR");
    expect(autoCurrency(["en-US", "en"])).toBe("USD");
    expect(autoCurrency(["fr", "de-DE"])).toBe("EUR");
    expect(autoCurrency(["en-GB"])).toBe("GBP");
    expect(autoCurrency(["ja-JP"])).toBe("JPY");
  });

  it("falls back to rupees when the browser gives no usable region", () => {
    expect(autoCurrency([])).toBe(FALLBACK_CURRENCY);
    expect(autoCurrency(undefined)).toBe("INR");
    expect(autoCurrency(["en", "fr"])).toBe("INR"); // a language isn't a country
    expect(autoCurrency(["pt-BR"])).toBe("INR"); // a region we don't show
    expect(autoCurrency(["not a locale!!"])).toBe("INR");
  });
});

describe("preference", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m } satisfies PreferenceStore & { m: Map<string, string> };
  };
  afterEach(() => writePreference(null, "auto"));

  it("is automatic until the buyer picks a currency", () => expect(readPreference(store())).toBe("auto"));

  it("keeps a manual choice, and only an explicit reset clears it", () => {
    const s = store();
    writePreference(s, "GBP");
    expect(readPreference(s)).toBe("GBP");
    // Automatic detection only reads; nothing in it writes the preference, so a manual choice stands.
    expect(autoCurrency(["en-IN"])).toBe("INR");
    expect(readPreference(s)).toBe("GBP");
    writePreference(s, "auto");
    expect(readPreference(s)).toBe("auto");
    expect(s.m.size).toBe(0);
  });

  it("ignores anything stored that isn't a currency we show", () => {
    const s = store();
    s.setItem("orbitly.displayCurrency", "BTC");
    expect(readPreference(s)).toBe("auto");
    expect(parsePreference("<script>")).toBe("auto");
  });

  it("falls back to this tab when storage is blocked", () => {
    const blocked: PreferenceStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    writePreference(blocked, "EUR");
    expect(readPreference(blocked)).toBe("EUR");
    expect(readPreference(null)).toBe("EUR");
  });
});

describe("exchange-rate provider", () => {
  const good = { amount: 1, base: "EUR", date: "2026-11-09", rates: { GBP: 0.8343, INR: 105.1435, JPY: 176.79, SGD: 1.4328, USD: 1.1193 } };
  const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response);
  vi.spyOn(console, "error").mockImplementation(() => {});

  it("accepts a well-formed reply and adds the EUR base", () => {
    expect(parseProviderResponse(good, NOW)).toEqual({ date: "2026-11-09", rates: { EUR: 1, ...good.rates } });
  });

  it("rejects malformed replies", () => {
    for (const bad of [null, "text", {}, { ...good, base: "USD" }, { ...good, date: "yesterday" }, { ...good, date: "2026-13-45" }, { ...good, date: "2027-01-01" }, { ...good, rates: null }, { ...good, rates: { ...good.rates, USD: -1 } }, { ...good, rates: { ...good.rates, USD: "1.1" } }, { ...good, rates: { USD: 1.1 } }]) {
      expect(parseProviderResponse(bad, NOW)).toBeNull();
    }
  });

  it("treats a currency the provider doesn't publish as unsupported, not as an error", () => {
    expect(parseProviderResponse(good, NOW)?.rates.AED).toBeUndefined();
  });

  it("serves a fresh copy without asking the provider again", async () => {
    let t = NOW;
    const f = reply(good);
    const get = createRateSource({ fetchImpl: f, now: () => t });
    expect(await get()).toMatchObject({ ok: true, date: "2026-11-09", stale: false, provider: "Frankfurter" });
    t += 60 * 60 * 1000;
    await get();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("marks an old rate date as stale", async () => {
    const get = createRateSource({ fetchImpl: reply({ ...good, date: "2026-11-01" }), now: () => NOW });
    expect(await get()).toMatchObject({ ok: true, stale: true });
  });

  it("serves the last good copy, marked stale, when the provider fails later", async () => {
    let t = NOW;
    let fail = false;
    const f = vi.fn(async () => {
      if (fail) throw new Error("network down");
      return { ok: true, json: async () => good } as unknown as Response;
    });
    const get = createRateSource({ fetchImpl: f, now: () => t });
    await get();
    fail = true;
    t += 7 * 60 * 60 * 1000; // past the refresh window
    expect(await get()).toMatchObject({ ok: true, stale: true, date: "2026-11-09" });
  });

  it("says rates are unavailable when there's nothing good to show", async () => {
    for (const f of [
      vi.fn(async () => { throw new Error("network down"); }),
      vi.fn(async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }),
      reply(good, false),
      reply({ nonsense: true }),
    ]) {
      expect(await createRateSource({ fetchImpl: f as unknown as typeof fetch, now: () => NOW })()).toEqual({ ok: false, reason: "Exchange rates are unavailable right now." });
    }
  });

  it("asks for every Orbitly currency except the base, over HTTPS, with a timeout", async () => {
    const f = reply(good);
    await createRateSource({ fetchImpl: f, now: () => NOW })();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=INR,USD,GBP,AED,JPY,SGD");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("stale rates are always labelled", () => {
  it("re-checks the date where the rate is shown, even if the server said it was current", () => {
    expect(isStaleRate({ stale: false, date: "2026-11-09" }, NOW)).toBe(false);
    // A cached copy the server marked current, shown a week later:
    expect(isStaleRate({ stale: false, date: "2026-11-09" }, NOW + 7 * 24 * 60 * 60 * 1000)).toBe(true);
    expect(isStaleRate({ stale: true, date: "2026-11-09" }, NOW)).toBe(true); // served after a failed fetch
    expect(isStaleRate({ stale: false, date: "not a date" }, NOW)).toBe(true); // unreadable dates are never "current"
  });
});

describe("rate loading in the browser", () => {
  const live = { ok: true, provider: "Frankfurter", source: "European Central Bank reference rates", base: "EUR", date: "2026-11-09", fetchedAt: "2026-11-10T12:00:00.000Z", stale: false, rates: { EUR: 1, INR: 105.1435 } };
  const respond = (body: unknown, reject = false) => vi.fn(async () => (reject ? Promise.reject(new Error("offline")) : ({ json: async () => body }) as unknown as Response)) as unknown as typeof fetch;

  it("passes a good payload through", async () => expect(await fetchRates(respond(live), () => NOW)).toEqual(live));

  it("labels a cached payload the server called current as older once its date has aged", async () => {
    expect(await fetchRates(respond(live), () => NOW + 7 * 24 * 60 * 60 * 1000)).toMatchObject({ ok: true, stale: true });
  });

  it("never throws: offline, a 503, junk and half-formed payloads all mean 'unavailable'", async () => {
    const unavailable = { ok: false, reason: "Exchange rates are unavailable right now." };
    expect(await fetchRates(respond(null, true))).toEqual(unavailable);
    expect(await fetchRates(respond(unavailable))).toEqual(unavailable); // what /api/rates sends with a 503
    expect(await fetchRates(respond("<html>"))).toEqual(unavailable);
    expect(await fetchRates(respond({ ok: true, rates: {} }))).toEqual(unavailable);
    const throwsOnJson = vi.fn(async () => ({ json: async () => { throw new SyntaxError("bad json"); } }) as unknown as Response) as unknown as typeof fetch;
    expect(await fetchRates(throwsOnJson)).toEqual(unavailable);
  });
});

describe("both marketplace directions", () => {
  const into = EXAMPLE_JOURNEYS.filter((j) => journeyDirection(j) === "into_india");
  const out = EXAMPLE_JOURNEYS.filter((j) => journeyDirection(j) === "out_of_india");

  it("converts Into India and Out of India amounts through the same path", () => {
    for (const j of [...into, ...out]) {
      const total = journeyPricing(j)!.buyerTotal;
      const usd = convert(toMajor(total, "INR"), "INR", "USD", RATES)!;
      expect(usd).toBeCloseTo(toMajor(total, "INR") / 80);
      expect(formatCurrency(usd, "USD")).toMatch(/^\$/);
    }
    expect(into.length).toBe(3);
    expect(out.length).toBe(3);
  });

  it("shows a foreign budget to an Indian buyer, and a rupee price to a buyer abroad", () => {
    expect(formatCurrency(convert(500, "USD", "INR", RATES), "INR")).toBe("₹40,000.00");
    expect(formatCurrency(convert(25_000, "INR", "USD", RATES), "USD")).toBe("$312.50");
  });
});

describe("financial safety: display currency never touches real amounts", () => {
  it("keeps the 3% buyer fee and 10% traveller fee, with no minimum reward", () => {
    expect(PRICING_POLICY).toMatchObject({ buyerFeeBps: 300, travellerFeeBps: 1000 });
    expect(PRICING_POLICY).not.toHaveProperty("minNetReward");
  });

  it("prices an order identically whatever display currency the buyer has chosen", () => {
    const price = () => calculateOrderPricing({ currency: "INR", productValue: rupees(10_000), grossReward: rupees(2_000) });
    const baseline = price();
    for (const c of ["USD", "EUR", "GBP", "JPY", "SGD", "AED", "auto"] as const) {
      writePreference(null, c); // the buyer switches display currency
      expect(price()).toEqual(baseline);
    }
    writePreference(null, "auto");
    expect(baseline.ok && baseline.pricing).toMatchObject({ currency: "INR", buyerFee: rupees(300), travellerFee: rupees(200), netReward: rupees(1_800), buyerTotal: rupees(12_300) });
  });

  it("never alters the amount it converts", () => {
    const pricing = calculateOrderPricing({ currency: "INR", productValue: rupees(2_000), grossReward: 33_400 });
    const frozen = JSON.stringify(pricing);
    if (pricing.ok) for (const c of ["USD", "EUR", "GBP"]) convert(toMajor(pricing.pricing.buyerTotal, "INR"), "INR", c, RATES);
    expect(JSON.stringify(pricing)).toBe(frozen);
  });

  it("can't be used to price in another currency: the engine still refuses non-INR rewards", () => {
    expect(calculateOrderPricing({ currency: "USD", productValue: 10_000, grossReward: 5_000 }).ok).toBe(false);
  });

  it("converts the engine's total, not a recalculated fee: converting parts or the whole gives the same answer", () => {
    const p = calculateOrderPricing({ currency: "INR", productValue: rupees(10_000), grossReward: rupees(2_000) });
    if (!p.ok) throw new Error("unexpected");
    const whole = convert(toMajor(p.pricing.buyerTotal, "INR"), "INR", "USD", RATES)!;
    const parts = [p.pricing.productValue, p.pricing.grossReward, p.pricing.buyerFee].map((m) => convert(toMajor(m, "INR"), "INR", "USD", RATES)!);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(whole, 9);
  });
});
