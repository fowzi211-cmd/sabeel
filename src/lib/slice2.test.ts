import { describe, expect, it } from "vitest";
import { feeHalalas, formatSar, packetEqMilliFor, sarToHalalas, supplierKeeps, vatIncluded } from "./money";
import { capForPaidCount, tierFor } from "./trust";
import { generateSlots, riyadhClock, riyadhDay } from "@/server/delivery";
import { rankScores } from "@/server/ranking";

describe("VAT and money", () => {
  it("extracts the VAT contained in a VAT-inclusive price", () => {
    expect(vatIncluded(38_000)).toBe(4957); // SAR 380.00 → 49.57 (matches the wireframes)
    expect(vatIncluded(34_000)).toBe(4435);
    expect(vatIncluded(0)).toBe(0);
  });

  it("packet-equivalents follow the 20-bottle packet", () => {
    expect(packetEqMilliFor(20, 500)).toBe(1000);
    expect(packetEqMilliFor(24, 330)).toBe(1200);
    expect(packetEqMilliFor(12, 500)).toBe(600);
    expect(packetEqMilliFor(48, 200)).toBe(2400);
    expect(packetEqMilliFor(1, 19_000)).toBe(1000); // 19 L jug
  });

  it("fee = packet-equivalents × quantity × rate (design pack example: 62 → SAR 31.00)", () => {
    expect(feeHalalas(1000, 50, 50)).toBe(2500);
    expect(feeHalalas(1200, 10, 50)).toBe(600);
    expect(feeHalalas(1000, 50, 50) + feeHalalas(1200, 10, 50)).toBe(3100);
    expect(feeHalalas(600, 1, 50)).toBe(30);
  });

  it("supplier keeps price minus fee minus VAT on the fee", () => {
    // 40 packets: order total SAR 380.00, fee SAR 20.00, VAT on fee SAR 3.00 → keeps SAR 357.00
    const fee = feeHalalas(1000, 40, 50);
    expect(supplierKeeps(38_000, fee)).toEqual({ fee: 2000, feeVat: 300, keep: 35_700 });
  });

  it("parses amounts strictly", () => {
    expect(sarToHalalas("9")).toBe(900);
    expect(sarToHalalas("9.5")).toBe(950);
    expect(sarToHalalas("9,50")).toBe(950);
    expect(sarToHalalas("٩٫٥٠")).toBe(950);
    expect(sarToHalalas("0.07")).toBe(7);
    for (const bad of ["", "abc", "9.999", "-5", "1e3", "9.", ".5", "1 000"]) expect(sarToHalalas(bad)).toBeNull();
  });

  it("formats in both languages", () => {
    expect(formatSar(38_000, "en")).toBe("SAR 380.00");
    expect(formatSar(950, "en")).toBe("SAR 9.50");
    expect(formatSar(38_000, "ar")).toContain("ر.س");
  });
});

describe("buyer trust tiers", () => {
  it("start at SAR 500 and grow with on-time paid orders", () => {
    expect(tierFor(0)).toBe(1);
    expect(tierFor(1)).toBe(1);
    expect(tierFor(2)).toBe(2);
    expect(tierFor(5)).toBe(3);
    expect(tierFor(10)).toBe(4);
    expect(capForPaidCount(0)).toBe(50_000);
    expect(capForPaidCount(2)).toBe(200_000);
    expect(capForPaidCount(12)).toBe(1_500_000);
  });
});

describe("delivery slots (Asia/Riyadh, Friday Jumu'ah blackout)", () => {
  const rules = { deliveryStart: "08:00", deliveryEnd: "22:00", fridayBlackoutStart: "11:00", fridayBlackoutEnd: "14:00" };
  // Sunday 2026-09-20 08:00 Riyadh = 05:00 UTC.
  const sunday8am = new Date("2026-09-20T05:00:00Z");

  it("offers 3-hour windows inside opening hours", () => {
    const slots = generateSlots({ now: sunday8am, rules, leadHours: 0, days: 1 });
    expect(slots.map((s) => `${riyadhClock(s.start)}-${riyadhClock(s.end)}`)).toEqual(["08:00-11:00", "11:00-14:00", "14:00-17:00", "17:00-20:00"]);
  });

  it("respects the supplier's lead time", () => {
    const slots = generateSlots({ now: sunday8am, rules, leadHours: 24, days: 2 });
    expect(riyadhDay(slots[0].start)).toBe("2026-09-21");
    expect(riyadhClock(slots[0].start)).toBe("08:00");
    // 05:00 UTC + 6 h lead → first slot starting at or after 14:00 Riyadh
    const short = generateSlots({ now: sunday8am, rules, leadHours: 6, days: 1 });
    expect(riyadhClock(short[0].start)).toBe("14:00");
  });

  it("never schedules across the Friday prayer window", () => {
    const friday = new Date("2026-09-25T05:00:00Z"); // Friday 08:00 Riyadh
    const slots = generateSlots({ now: friday, rules, leadHours: 0, days: 1 });
    expect(slots.map((s) => riyadhClock(s.start))).toEqual(["08:00", "14:00", "17:00"]);
  });

  it("other weekdays keep the midday slot", () => {
    const thursday = new Date("2026-09-24T05:00:00Z");
    expect(generateSlots({ now: thursday, rules, leadHours: 0, days: 1 }).map((s) => riyadhClock(s.start))).toContain("11:00");
  });

  it("uses Riyadh's calendar day, not UTC's, around midnight", () => {
    // 22:30 UTC on Saturday is 01:30 Sunday in Riyadh → "today" is Sunday.
    const late = new Date("2026-09-19T22:30:00Z");
    const slots = generateSlots({ now: late, rules, leadHours: 0, days: 1 });
    expect(riyadhDay(slots[0].start)).toBe("2026-09-20");
  });

  it("returns nothing when the lead time exceeds the horizon", () => {
    expect(generateSlots({ now: sunday8am, rules, leadHours: 24 * 30, days: 7 })).toEqual([]);
  });

  it("works without a Friday blackout", () => {
    const friday = new Date("2026-09-25T05:00:00Z");
    const slots = generateSlots({ now: friday, rules: { deliveryStart: "08:00", deliveryEnd: "14:00" }, leadHours: 0, days: 1 });
    expect(slots).toHaveLength(2);
  });
});

describe("offer ranking", () => {
  it("prefers cheaper and faster offers when quality is unknown", () => {
    const [a, b, c] = rankScores([
      { totalHalalas: 34_000, leadHours: 24, rating: null, onTimePct: null },
      { totalHalalas: 38_000, leadHours: 24, rating: null, onTimePct: null },
      { totalHalalas: 34_000, leadHours: 48, rating: null, onTimePct: null },
    ]);
    expect(a).toBeGreaterThan(b);
    expect(a).toBeGreaterThan(c);
  });

  it("a much better rating can outweigh a small price difference", () => {
    const [cheap, better] = rankScores([
      { totalHalalas: 36_000, leadHours: 24, rating: 3.0, onTimePct: 70 },
      { totalHalalas: 36_500, leadHours: 24, rating: 4.9, onTimePct: 99 },
    ]);
    expect(better).toBeGreaterThan(cheap);
  });

  it("handles one row and empty input", () => {
    expect(rankScores([])).toEqual([]);
    expect(rankScores([{ totalHalalas: 1, leadHours: 1, rating: null, onTimePct: null }])[0]).toBeGreaterThan(0);
  });
});
