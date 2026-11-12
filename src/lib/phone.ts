// Countries we accept mobile numbers from: India plus the main countries travellers fly in from.
// shortcut: simplified mobile-number rules per country; switch to libphonenumber-js if more countries are added.
export const PHONE_COUNTRIES = [
  { code: "IN", name: "India", dial: "91", mobile: /^[6-9]\d{9}$/ },
  { code: "US", name: "United States", dial: "1", mobile: /^[2-9]\d{2}[2-9]\d{6}$/ },
  { code: "CA", name: "Canada", dial: "1", mobile: /^[2-9]\d{2}[2-9]\d{6}$/ },
  { code: "GB", name: "United Kingdom", dial: "44", mobile: /^7\d{9}$/ },
  { code: "AE", name: "United Arab Emirates", dial: "971", mobile: /^5\d{8}$/ },
  { code: "AU", name: "Australia", dial: "61", mobile: /^4\d{8}$/ },
  { code: "SG", name: "Singapore", dial: "65", mobile: /^[89]\d{7}$/ },
] as const;

/** Minimum wait between verification codes. Supabase Auth enforces its own limit on the server. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Turns a country + typed number into E.164 (+919876543210), or null if it isn't a valid mobile number. */
export function toE164(countryCode: string, input: string): string | null {
  const country = PHONE_COUNTRIES.find((c) => c.code === countryCode);
  if (!country || input.length > 30) return null;

  let digits = input.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) {
    if (!digits.startsWith(`+${country.dial}`)) return null;
    digits = digits.slice(country.dial.length + 1);
  }
  if (!/^\d+$/.test(digits)) return null;
  digits = digits.replace(/^0/, ""); // national trunk prefix, e.g. 098… or 07…

  return country.mobile.test(digits) ? `+${country.dial}${digits}` : null;
}

/** "+919000000001" or "919000000001" → "+91 ••••••0001". Never shows more than the last 4 digits. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return "••••";
  const dial = [...new Set(PHONE_COUNTRIES.map((c) => c.dial))]
    .sort((a, b) => b.length - a.length)
    .find((d) => digits.startsWith(d));
  const last4 = digits.slice(-4);
  return dial ? `+${dial} ${"•".repeat(digits.length - dial.length - 4)}${last4}` : `+•••• ${last4}`;
}
