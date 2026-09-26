import { describe, expect, it } from "vitest";
import { acceptanceRate, countsAgainstSupplier, disputeRate, ratePercent } from "./rates";

describe("ratePercent", () => {
  it("null under the minimum sample, but reports the count", () => expect(ratePercent(4, 4)).toEqual({ pct: null, count: 4 }));
  it("rounds to a whole percent", () => expect(ratePercent(2, 3 + 4)).toEqual({ pct: 29, count: 7 }));
  it("0% and 100% are real figures", () => {
    expect(ratePercent(0, 5).pct).toBe(0);
    expect(ratePercent(5, 5).pct).toBe(100);
  });
});

describe("acceptanceRate", () => {
  it("accepted ÷ (accepted + declined + expired)", () => expect(acceptanceRate({ accepted: 6, declined: 2, expired: 2 }).pct).toBe(60));
  it("too few answered offers → no figure", () => expect(acceptanceRate({ accepted: 3, declined: 1, expired: 0 }).pct).toBeNull());
});

describe("disputeRate", () => {
  it("disputed ÷ delivered", () => expect(disputeRate(20, 3).pct).toBe(15));
  it("too few deliveries → no figure", () => expect(disputeRate(4, 4).pct).toBeNull());
});

describe("countsAgainstSupplier", () => {
  it("a delivery dispute counts, open or resolved against them", () => {
    expect(countsAgainstSupplier({ category: "SHORT", outcome: null })).toBe(true);
    expect(countsAgainstSupplier({ category: "LATE", outcome: "PRICE_ADJUSTMENT" })).toBe(true);
  });
  it("a dismissed dispute does not", () => expect(countsAgainstSupplier({ category: "DAMAGED", outcome: "DISMISS" })).toBe(false));
  it("a non-payment dispute does not", () => expect(countsAgainstSupplier({ category: "NON_PAYMENT", outcome: null })).toBe(false));
});
