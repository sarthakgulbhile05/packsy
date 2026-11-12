// Countries Orbitly offers in route pickers, as ISO 3166-1 alpha-2 codes. The database stores only the code
// (any two capital letters), so adding a country here needs no migration. Names come from the browser or
// server's own locale data, so they stay correct without a hand-kept list of names.

export const COUNTRY_CODES = [
  "IN", "US", "GB", "AE", "CA", "AU", "SG", "DE", "FR", "NL", "IE", "IT", "ES", "CH", "SE",
  "JP", "KR", "HK", "MY", "TH", "NZ", "SA", "QA", "KW", "OM", "BH", "ZA", "NG", "KE", "BD", "LK", "NP",
] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

const names = new Intl.DisplayNames(["en"], { type: "region" });

export const isCountryCode = (v: unknown): v is CountryCode => typeof v === "string" && (COUNTRY_CODES as readonly string[]).includes(v);
export const countryName = (code: string) => (isCountryCode(code) ? (names.of(code) ?? code) : code);

/** Picker options, India first (most routes start or end there today), then A–Z. */
export const COUNTRY_OPTIONS = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
  a.code === "IN" ? -1 : b.code === "IN" ? 1 : a.name.localeCompare(b.name),
);

/** "United States → India" */
export const routeLabel = (from: string, to: string) => `${countryName(from)} → ${countryName(to)}`;
