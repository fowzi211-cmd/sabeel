// Default "best" ordering for offer comparison (design pack R09). Verified status is a filter,
// never a paid boost. Ratings are real from slice 5; on-time delivery % is still a later-slice
// metric, so every supplier gets the same neutral on-time prior until then.

export const PRIOR_RATING = 4.0; // out of 5
export const PRIOR_ON_TIME = 0.9; // 0..1

export interface RankInput {
  totalHalalas: number;
  leadHours: number;
  rating: number | null;
  onTimePct: number | null; // 0..100
}

const normalizedInverse = (value: number, min: number, max: number) => (max === min ? 1 : (max - value) / (max - min));

/** Returns a 0..1 score per row (same order as the input); higher is better. */
export function rankScores(rows: RankInput[]): number[] {
  if (rows.length === 0) return [];
  const totals = rows.map((r) => r.totalHalalas);
  const leads = rows.map((r) => r.leadHours);
  const [tMin, tMax] = [Math.min(...totals), Math.max(...totals)];
  const [lMin, lMax] = [Math.min(...leads), Math.max(...leads)];

  return rows.map((r) => {
    const rating = (r.rating ?? PRIOR_RATING) / 5;
    const onTime = r.onTimePct === null ? PRIOR_ON_TIME : r.onTimePct / 100;
    return 0.4 * rating + 0.25 * onTime + 0.2 * normalizedInverse(r.totalHalalas, tMin, tMax) + 0.15 * normalizedInverse(r.leadHours, lMin, lMax);
  });
}
