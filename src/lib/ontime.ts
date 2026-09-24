// Pure on-time delivery rule (design pack R08): delivered within the promised window (+15 min tolerance)
// ÷ delivered orders, last 90 days. Too few deliveries show as "no figure yet" rather than a noisy percentage.

export const ON_TIME_TOLERANCE_MIN = 15;
export const ON_TIME_WINDOW_DAYS = 90;
export const ON_TIME_MIN_SAMPLE = 5;

const MIN = 60_000;
const DAY = 86_400_000;

export interface DeliverySample { deliveredAt: Date; windowEnd: Date }

export const isDeliveredOnTime = (s: DeliverySample): boolean =>
  s.deliveredAt.getTime() <= s.windowEnd.getTime() + ON_TIME_TOLERANCE_MIN * MIN;

/** Whole-number percent, or null when fewer than ON_TIME_MIN_SAMPLE deliveries fall in the last 90 days. */
export function onTimePercent(samples: DeliverySample[], now: Date = new Date()): { pct: number | null; count: number } {
  const since = now.getTime() - ON_TIME_WINDOW_DAYS * DAY;
  const recent = samples.filter((s) => s.deliveredAt.getTime() >= since && s.deliveredAt.getTime() <= now.getTime());
  if (recent.length < ON_TIME_MIN_SAMPLE) return { pct: null, count: recent.length };
  return { pct: Math.round((recent.filter(isDeliveredOnTime).length / recent.length) * 100), count: recent.length };
}
