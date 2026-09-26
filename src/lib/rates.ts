// Design pack R08's two remaining figures. Pure rules, no database. A rate over too few cases shows as
// "no figure yet" (null) rather than a noisy percentage, same as on-time %.

export const RATE_WINDOW_DAYS = 90;
export const RATE_MIN_SAMPLE = 5;

/** Whole-number percent, or null when fewer than RATE_MIN_SAMPLE cases. */
export function ratePercent(hits: number, total: number): { pct: number | null; count: number } {
  if (total < RATE_MIN_SAMPLE) return { pct: null, count: total };
  return { pct: Math.round((hits / total) * 100), count: total };
}

/** Acceptance = accepted ÷ offers the supplier actually answered or let lapse (still-open offers don't count). */
export const acceptanceRate = (c: { accepted: number; declined: number; expired: number }) =>
  ratePercent(c.accepted, c.accepted + c.declined + c.expired);

/** Dispute = delivered orders with a (not dismissed) delivery dispute ÷ delivered orders. */
export const disputeRate = (delivered: number, disputed: number) => ratePercent(disputed, delivered);

export interface DisputeLike { category: string; outcome: string | null }

/** A payment dispute is about the buyer, and a dismissed one was found baseless — neither counts against a supplier. */
export const countsAgainstSupplier = (d: DisputeLike): boolean => d.category !== "NON_PAYMENT" && d.outcome !== "DISMISS";
