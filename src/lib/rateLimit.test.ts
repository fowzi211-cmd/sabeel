import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { checkRateLimit } from "./rateLimit";

describe("checkRateLimit", () => {
  it("allows up to `max` hits within the window", () => {
    const key = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(() => checkRateLimit(key, 3, 60_000, 1000)).not.toThrow();
  });

  it("throws RATE_LIMITED on the hit past `max`", () => {
    const key = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 60_000, 1000);
    expect(() => checkRateLimit(key, 3, 60_000, 1000)).toThrow(AppError);
    try {
      checkRateLimit(key, 3, 60_000, 1000);
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("RATE_LIMITED");
    }
  });

  it("resets once the window has passed", () => {
    const key = `t-${Math.random()}`;
    checkRateLimit(key, 1, 1000, 1000);
    expect(() => checkRateLimit(key, 1, 1000, 1500)).toThrow(AppError);
    expect(() => checkRateLimit(key, 1, 1000, 2001)).not.toThrow(); // window (1000..2000) has passed
  });

  it("tracks separate keys independently", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    checkRateLimit(a, 1, 60_000, 1000);
    expect(() => checkRateLimit(b, 1, 60_000, 1000)).not.toThrow();
  });
});
