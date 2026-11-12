import { AuthApiError } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authErrorMessage, logAuthError } from "@/lib/auth-errors";

const apiError = (message: string, status: number, code?: string) => new AuthApiError(message, status, code);

describe("authErrorMessage", () => {
  it("maps known codes to fixed friendly text", () => {
    expect(authErrorMessage(apiError("Invalid login credentials", 400, "invalid_credentials"))).toBe(
      "Incorrect email or password.",
    );
    expect(authErrorMessage(apiError("Token has expired or is invalid", 403, "otp_expired"))).toMatch(
      /incorrect or has expired/,
    );
    expect(authErrorMessage(apiError("x", 429, "over_sms_send_rate_limit"))).toMatch(/wait a minute/);
    expect(authErrorMessage(apiError("x", 422, "phone_exists"))).toMatch(/can't be used/);
    expect(authErrorMessage(apiError("x", 500, "sms_send_failed"))).toMatch(/couldn't send a code/);
  });

  it("never returns Supabase's raw message, which can contain personal data", () => {
    const raw = 'Email address "someone@example.com" is invalid';
    const msg = authErrorMessage(apiError(raw, 400, "email_address_invalid"));
    expect(msg).not.toContain("someone@example.com");
    expect(authErrorMessage(apiError(raw, 400, "some_new_code"))).not.toContain("someone");
  });

  it("treats unknown 429s as rate limits", () => {
    expect(authErrorMessage(apiError("slow down", 429))).toMatch(/Too many attempts/);
  });

  it("falls back to a generic message for unknown or non-auth errors", () => {
    expect(authErrorMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
    expect(authErrorMessage(undefined)).toBe("Something went wrong. Please try again.");
  });
});

describe("logAuthError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the code and status but not the message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logAuthError("login", apiError('Email "a@b.co" is invalid', 400, "email_address_invalid"));
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("email_address_invalid");
    expect(logged).not.toContain("a@b.co");
  });
});
