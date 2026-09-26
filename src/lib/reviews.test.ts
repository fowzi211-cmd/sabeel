import { describe, expect, it } from "vitest";
import { averageStars, canStillReview, isRatedSupplier, reviewDeadline, weightedAverageStars } from "./reviews";

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

describe("weightedAverageStars", () => {
  const now = new Date("2026-09-22T00:00:00Z");
  it("null with no reviews", () => expect(weightedAverageStars([], now)).toBeNull());

  it("equals the simple average when every review is equally fresh", () => {
    const reviews = [{ stars: 5, createdAt: now }, { stars: 3, createdAt: now }, { stars: 4, createdAt: now }];
    expect(weightedAverageStars(reviews, now)).toBe(4); // (5+3+4)/3
  });

  it("weighs a recent review more than an old one", () => {
    const oldFive = [{ stars: 5, createdAt: new Date(now.getTime() - 365 * 86_400_000) }];
    const recentOne = [{ stars: 1, createdAt: now }];
    const mixed = weightedAverageStars([...oldFive, ...recentOne], now)!;
    // A year-old 5★ barely counts against a same-day 1★ — the result should sit close to 1, not 3 (the simple average).
    expect(mixed).toBeLessThan(2);
  });

  it("a review from exactly one half-life ago counts about half as much as today's", () => {
    const halfLifeAgo = new Date(now.getTime() - 180 * 86_400_000); // R07: w = 0.5^(age ÷ 180)
    const reviews = [{ stars: 5, createdAt: now }, { stars: 1, createdAt: halfLifeAgo }];
    // weight(today)=1, weight(180d ago)=0.5 → (1*5 + 0.5*1) / 1.5 = 3.667 → 3.7
    expect(weightedAverageStars(reviews, now)).toBe(3.7);
  });

  it("R07 prior: the platform average counts as 3 extra reviews, pulling a thin record toward it", () => {
    const three = [{ stars: 5, createdAt: now }, { stars: 5, createdAt: now }, { stars: 5, createdAt: now }];
    // (15 + 3*4.0) / (3 + 3) = 4.5 — three perfect reviews don't beat the platform by the full margin
    expect(weightedAverageStars(three, now, 4)).toBe(4.5);
  });

  it("the prior matters less as reviews accumulate", () => {
    const many = Array.from({ length: 27 }, () => ({ stars: 5, createdAt: now }));
    // (135 + 12) / 30 = 4.9
    expect(weightedAverageStars(many, now, 4)).toBe(4.9);
  });

  it("never fully discounts an old review — weight approaches but never reaches zero", () => {
    const veryOld = [{ stars: 1, createdAt: new Date(now.getTime() - 5000 * 86_400_000) }];
    expect(weightedAverageStars(veryOld, now)).toBe(1); // still the only review, so still the whole average
  });
});
