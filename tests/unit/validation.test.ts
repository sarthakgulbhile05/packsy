import { describe, expect, it } from "vitest";
import { field, isEmail, passwordProblem } from "@/lib/validation";

describe("validation", () => {
  it("field trims text and ignores files/missing values", () => {
    const fd = new FormData();
    fd.set("name", "  Asha  ");
    fd.set("file", new Blob(["x"]));
    expect(field(fd, "name")).toBe("Asha");
    expect(field(fd, "file")).toBe("");
    expect(field(fd, "missing")).toBe("");
  });

  it("isEmail accepts normal addresses and rejects junk", () => {
    expect(isEmail("asha@example.com")).toBe(true);
    expect(isEmail("asha@example")).toBe(false);
    expect(isEmail("a b@example.com")).toBe(false);
    expect(isEmail("")).toBe(false);
    expect(isEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });

  it("passwordProblem enforces 8–72 characters with letters and numbers", () => {
    expect(passwordProblem("abcdefg1")).toBeNull();
    expect(passwordProblem("short1")).toMatch(/at least 8/);
    expect(passwordProblem("abcdefgh")).toMatch(/letters and numbers/);
    expect(passwordProblem("12345678")).toMatch(/letters and numbers/);
    expect(passwordProblem(`a1${"x".repeat(71)}`)).toMatch(/at most 72/);
    expect(passwordProblem(null)).toMatch(/at least 8/);
  });
});
