import { describe, expect, it } from "vitest";
import { isDeliveredOnTime, onTimePercent } from "./ontime";

const now = new Date("2026-09-24T12:00:00Z");
const at = (minutesAfterWindowEnd: number, daysAgo = 1) => {
  const windowEnd = new Date(now.getTime() - daysAgo * 86_400_000);
  return { windowEnd, deliveredAt: new Date(windowEnd.getTime() + minutesAfterWindowEnd * 60_000) };
};

describe("isDeliveredOnTime", () => {
  it("early and exactly at the window end are on time", () => {
    expect(isDeliveredOnTime(at(-30))).toBe(true);
    expect(isDeliveredOnTime(at(0))).toBe(true);
  });
  it("15 minutes late is still on time, 16 is not", () => {
    expect(isDeliveredOnTime(at(15))).toBe(true);
    expect(isDeliveredOnTime(at(16))).toBe(false);
  });
});

describe("onTimePercent", () => {
  it("null below the minimum sample, but reports the count", () => {
    expect(onTimePercent([at(0), at(0), at(0), at(0)], now)).toEqual({ pct: null, count: 4 });
  });
  it("rounds to a whole percent", () => {
    const s = [at(0), at(0), at(0), at(0), at(0), at(60), at(60)]; // 5 of 7
    expect(onTimePercent(s, now).pct).toBe(71);
  });
  it("ignores deliveries older than 90 days", () => {
    const s = [at(0), at(0), at(0), at(0), at(0), at(120, 91), at(120, 200)];
    expect(onTimePercent(s, now)).toEqual({ pct: 100, count: 5 });
  });
  it("old deliveries can't rescue a bad recent record either way", () => {
    const s = [at(90), at(90), at(90), at(90), at(90), at(0, 120), at(0, 130)];
    expect(onTimePercent(s, now).pct).toBe(0);
  });
});
