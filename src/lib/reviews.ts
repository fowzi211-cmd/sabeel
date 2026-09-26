// Pure review rules (design pack §H). No database here so they are easy to test.

import { REVIEWS_UNTIL_RATED, REVIEW_SUBMIT_WINDOW_DAYS } from "./fulfilment";

const DAY = 86_400_000;

/** A buyer may still submit a review this many days after the delivery was confirmed. */
export const reviewDeadline = (confirmedAt: Date): Date => new Date(confirmedAt.getTime() + REVIEW_SUBMIT_WINDOW_DAYS * DAY);
export const canStillReview = (confirmedAt: Date, now: Date): boolean => now.getTime() <= reviewDeadline(confirmedAt).getTime();

/** A supplier shows a real rating only once it has enough reviews; before that it is "New" (design pack §H). */
export const isRatedSupplier = (reviewCount: number): boolean => reviewCount >= REVIEWS_UNTIL_RATED;

/** Simple average, one decimal place. null with no reviews yet — the caller decides how to show that. */
export function averageStars(stars: number[]): number | null {
  if (stars.length === 0) return null;
  return Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10;
}

/** Design pack R07: w = 0.5^(age_days ÷ 180) — a review from 180 days ago counts half as much as today's. */
export const RATING_HALF_LIFE_DAYS = 180;
/** R07's prior: the platform average counts as this many extra reviews, so one 5★ can't top the list. */
export const RATING_PRIOR_REVIEWS = 3;

/**
 * Exponential-decay weighted average of 1–5 scores, optionally pulled toward `priorMean` by
 * RATING_PRIOR_REVIEWS: (Σ w·r + 3·mean) ÷ (Σ w + 3). Weights never reach zero, so a long-inactive
 * supplier's old reviews still count, just less than fresh ones. null with no scores.
 */
export function weightedAverage(scores: { value: number; createdAt: Date }[], now: Date = new Date(), priorMean?: number): number | null {
  if (scores.length === 0) return null;
  let weightSum = 0;
  let sum = 0;
  for (const s of scores) {
    const daysAgo = Math.max(0, (now.getTime() - s.createdAt.getTime()) / DAY);
    const weight = Math.pow(0.5, daysAgo / RATING_HALF_LIFE_DAYS);
    weightSum += weight;
    sum += weight * s.value;
  }
  if (priorMean !== undefined) {
    weightSum += RATING_PRIOR_REVIEWS;
    sum += RATING_PRIOR_REVIEWS * priorMean;
  }
  return Math.round((sum / weightSum) * 10) / 10;
}

export const weightedAverageStars = (reviews: { stars: number; createdAt: Date }[], now: Date = new Date(), priorMean?: number): number | null =>
  weightedAverage(reviews.map((r) => ({ value: r.stars, createdAt: r.createdAt })), now, priorMean);
