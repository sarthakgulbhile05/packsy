/** A trimmed string from a form field, or "" if missing or not text. */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Why a new password is not acceptable, or null if it is fine. Matches the Supabase password policy. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 8) return "Use a password of at least 8 characters.";
  if (password.length > 72) return "Use a password of at most 72 characters.";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return "Use a password with both letters and numbers.";
  }
  return null;
}
