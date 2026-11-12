import { describe, expect, it } from "vitest";
import { maskPhone, toE164 } from "@/lib/phone";

describe("toE164", () => {
  it.each([
    ["IN", "98765 43210", "+919876543210"],
    ["IN", "098765-43210", "+919876543210"],
    ["IN", "+91 98765 43210", "+919876543210"],
    ["IN", "9000000001", "+919000000001"],
    ["US", "(415) 555-2671", "+14155552671"],
    ["GB", "07700 900123", "+447700900123"],
    ["AE", "050 123 4567", "+971501234567"],
    ["AU", "0412 345 678", "+61412345678"],
    ["SG", "8123 4567", "+6581234567"],
  ])("%s %s → %s", (country, input, expected) => {
    expect(toE164(country, input)).toBe(expected);
  });

  it.each([
    ["IN", "12345"], // too short
    ["IN", "5876543210"], // Indian mobiles start 6–9
    ["IN", "+44 7700 900123"], // country code doesn't match the chosen country
    ["IN", "98765abc10"],
    ["IN", ""],
    ["US", "1 415 555 2671"], // leading 1 typed into the national field
    ["GB", "020 7946 0018"], // landline, not mobile
    ["XX", "9876543210"], // unsupported country
    ["IN", "9".repeat(40)],
  ])("rejects %s %s", (country, input) => {
    expect(toE164(country, input)).toBeNull();
  });
});

describe("maskPhone", () => {
  it("shows only the country code and last 4 digits", () => {
    expect(maskPhone("+919000000001")).toBe("+91 ••••••0001");
    expect(maskPhone("919876543210")).toBe("+91 ••••••3210"); // Supabase stores numbers without "+"
    expect(maskPhone("+971501234567")).toBe("+971 •••••4567");
    expect(maskPhone("+14155552671")).toBe("+1 ••••••2671");
  });

  it("never reveals the middle digits", () => {
    expect(maskPhone("+919876543210")).not.toContain("98765");
  });

  it("handles unknown countries and junk safely", () => {
    expect(maskPhone("+33612345678")).toBe("+•••• 5678");
    expect(maskPhone("123")).toBe("••••");
    expect(maskPhone("")).toBe("••••");
  });
});
