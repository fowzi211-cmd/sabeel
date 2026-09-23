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

/** A recent review should move a supplier's rating more than an old one (design pack §H "ranking" gap). */
export const RATING_HALF_LIFE_DAYS = 90;

/**
 * Exponential-decay weighted average: a review from `RATING_HALF_LIFE_DAYS` ago counts half as much
 * as one from today, one from twice that ago a quarter as much, and so on — never zero, so a
 * long-inactive supplier's old reviews still count, just less than fresh ones.
 */
export function weightedAverageStars(reviews: { stars: number; createdAt: Date }[], now: Date = new Date()): number | null {
  if (reviews.length === 0) return null;
  let weightSum = 0;
  let starsSum = 0;
  for (const r of reviews) {
    const daysAgo = Math.max(0, (now.getTime() - r.createdAt.getTime()) / DAY);
    const weight = Math.pow(0.5, daysAgo / RATING_HALF_LIFE_DAYS);
    weightSum += weight;
    starsSum += weight * r.stars;
  }
  return Math.round((starsSum / weightSum) * 10) / 10;
}
