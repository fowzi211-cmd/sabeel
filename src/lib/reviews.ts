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
