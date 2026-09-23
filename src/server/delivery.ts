// Delivery windows for Makkah (design pack R13). All wall-clock rules are Asia/Riyadh, which is
// UTC+3 all year (no daylight saving), so plain offset arithmetic is exact and needs no library.

const RIYADH_OFFSET_MS = 3 * 3_600_000;
const HOUR = 3_600_000;

export interface SlotRules {
  /** "HH:MM" Asia/Riyadh — first and last moments deliveries may happen. */
  deliveryStart: string;
  deliveryEnd: string;
  /** Jumu'ah window on Fridays with no deliveries (both or neither). */
  fridayBlackoutStart?: string | null;
  fridayBlackoutEnd?: string | null;
}

export interface Slot {
  start: Date;
  end: Date;
}

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Bookable windows for the next `days` days: fixed-length slots (default 3 h) inside the district's
 * hours, never overlapping the Friday blackout, and never earlier than now + the supplier's lead time.
 */
export function generateSlots(opts: {
  now: Date;
  rules: SlotRules;
  leadHours: number;
  days?: number;
  slotHours?: number;
}): Slot[] {
  const { now, rules, leadHours } = opts;
  const days = opts.days ?? 7;
  const slotMin = (opts.slotHours ?? 3) * 60;
  const earliest = now.getTime() + leadHours * HOUR;

  const local = new Date(now.getTime() + RIYADH_OFFSET_MS); // read with getUTC* = Riyadh wall clock
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();

  const dayStart = minutes(rules.deliveryStart);
  const dayEnd = minutes(rules.deliveryEnd);
  const hasBlackout = !!rules.fridayBlackoutStart && !!rules.fridayBlackoutEnd;
  const bStart = hasBlackout ? minutes(rules.fridayBlackoutStart!) : 0;
  const bEnd = hasBlackout ? minutes(rules.fridayBlackoutEnd!) : 0;

  const slots: Slot[] = [];
  for (let off = 0; off < days; off++) {
    const weekday = new Date(Date.UTC(y, m, d + off)).getUTCDay(); // 5 = Friday
    for (let s = dayStart; s + slotMin <= dayEnd; s += slotMin) {
      if (hasBlackout && weekday === 5 && s < bEnd && s + slotMin > bStart) continue;
      const start = Date.UTC(y, m, d + off, 0, s) - RIYADH_OFFSET_MS;
      if (start < earliest) continue;
      slots.push({ start: new Date(start), end: new Date(start + slotMin * 60_000) });
    }
  }
  return slots;
}

/** "HH:MM" in Riyadh for display. */
export function riyadhClock(d: Date): string {
  const l = new Date(d.getTime() + RIYADH_OFFSET_MS);
  return `${String(l.getUTCHours()).padStart(2, "0")}:${String(l.getUTCMinutes()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" in Riyadh — used to group slots by day. */
export function riyadhDay(d: Date): string {
  return new Date(d.getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}
