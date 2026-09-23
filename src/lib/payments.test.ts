import { describe, expect, it } from "vitest";
import { amountOwedFor, dueAtFrom, isOnTime, isValidAdjustment } from "./payments";

describe("dueAtFrom", () => {
  it("is exactly PAYMENT_DUE_DAYS (3) after now", () => {
    const now = new Date("2026-09-22T10:00:00Z");
    const due = dueAtFrom(now);
    expect(due.toISOString()).toBe("2026-09-25T10:00:00.000Z");
  });
});

describe("isOnTime", () => {
  const due = new Date("2026-09-25T10:00:00Z");
  it("is true when paid before or exactly at the due date", () => {
    expect(isOnTime(new Date("2026-09-24T09:00:00Z"), due)).toBe(true);
    expect(isOnTime(new Date(due), due)).toBe(true);
  });
  it("is false when paid after the due date, or never marked paid", () => {
    expect(isOnTime(new Date("2026-09-25T10:00:01Z"), due)).toBe(false);
    expect(isOnTime(null, due)).toBe(false);
  });
});

describe("amountOwedFor", () => {
  it("uses the adjusted total when a dispute lowered the price", () => {
    expect(amountOwedFor(38_000, 30_000)).toBe(30_000);
  });
  it("falls back to the order total otherwise", () => {
    expect(amountOwedFor(38_000, null)).toBe(38_000);
  });
});

describe("isValidAdjustment", () => {
  it("accepts a positive integer at or below the original total", () => {
    expect(isValidAdjustment(30_000, 38_000)).toBe(true);
    expect(isValidAdjustment(38_000, 38_000)).toBe(true);
  });
  it("rejects zero, negative, non-integer or above-original amounts", () => {
    expect(isValidAdjustment(0, 38_000)).toBe(false);
    expect(isValidAdjustment(-100, 38_000)).toBe(false);
    expect(isValidAdjustment(30_000.5, 38_000)).toBe(false);
    expect(isValidAdjustment(38_001, 38_000)).toBe(false);
  });
});
