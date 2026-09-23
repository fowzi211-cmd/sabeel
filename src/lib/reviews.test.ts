import { describe, expect, it } from "vitest";
import { averageStars, canStillReview, isRatedSupplier, reviewDeadline } from "./reviews";

describe("reviewDeadline / canStillReview", () => {
  const confirmedAt = new Date("2026-09-22T10:00:00Z");
  it("30 days after confirmation", () => {
    expect(reviewDeadline(confirmedAt).toISOString()).toBe("2026-10-22T10:00:00.000Z");
  });
  it("still open before or exactly at the deadline", () => {
    expect(canStillReview(confirmedAt, new Date("2026-10-01T00:00:00Z"))).toBe(true);
    expect(canStillReview(confirmedAt, reviewDeadline(confirmedAt))).toBe(true);
  });
  it("closed just after the deadline", () => {
    expect(canStillReview(confirmedAt, new Date(reviewDeadline(confirmedAt).getTime() + 1))).toBe(false);
  });
});

describe("isRatedSupplier", () => {
  it("not rated below REVIEWS_UNTIL_RATED (3)", () => {
    expect(isRatedSupplier(0)).toBe(false);
    expect(isRatedSupplier(2)).toBe(false);
  });
  it("rated at or above the threshold", () => {
    expect(isRatedSupplier(3)).toBe(true);
    expect(isRatedSupplier(10)).toBe(true);
  });
});

describe("averageStars", () => {
  it("null with no reviews", () => expect(averageStars([])).toBeNull());
  it("simple average to one decimal", () => {
    expect(averageStars([5, 4, 5])).toBe(4.7);
    expect(averageStars([5, 5])).toBe(5);
    expect(averageStars([1, 2])).toBe(1.5);
  });
});
