import { describe, expect, it } from "vitest";
import {
  accrualAmounts, ceilingBand, ceilingFor, earnsEstablishedStatus, invoiceDueAt, invoicePauseAt, invoiceSuspendAt,
  isInvoiceOnTime, periodFor,
} from "./fees";

describe("accrualAmounts", () => {
  it("keeps the fee itself and adds 15% VAT on top, rounded", () => {
    expect(accrualAmounts(50)).toEqual({ amountHalalas: 50, vatHalalas: 8 }); // 7.5 rounds to 8
  });
  it("handles zero", () => {
    expect(accrualAmounts(0)).toEqual({ amountHalalas: 0, vatHalalas: 0 });
  });
});

describe("periodFor", () => {
  it("MONTHLY: the Riyadh calendar month, expressed in UTC instants", () => {
    // 2026-09-22T10:00 UTC is 2026-09-22 13:00 Riyadh, mid-September.
    const { start, end } = periodFor("MONTHLY", new Date("2026-09-22T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-08-31T21:00:00.000Z"); // 2026-09-01 00:00 Riyadh
    expect(end.toISOString()).toBe("2026-09-30T21:00:00.000Z"); // 2026-10-01 00:00 Riyadh
  });

  it("WEEKLY: Saturday 00:00 Riyadh through the following Saturday", () => {
    // 2026-09-22 is a Tuesday in Riyadh.
    const { start, end } = periodFor("WEEKLY", new Date("2026-09-22T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-09-18T21:00:00.000Z"); // Saturday 2026-09-19 00:00 Riyadh
    expect(end.getTime() - start.getTime()).toBe(7 * 86_400_000);
  });

  it("WEEKLY: a Saturday itself is the start of its own period", () => {
    const { start } = periodFor("WEEKLY", new Date("2026-09-19T00:30:00Z")); // just after Riyadh midnight Saturday
    expect(start.toISOString()).toBe("2026-09-18T21:00:00.000Z");
  });
});

describe("invoice due/pause/suspend clock", () => {
  const issued = new Date("2026-09-22T10:00:00Z");
  it("due 7 days after issue", () => {
    expect(invoiceDueAt(issued).toISOString()).toBe("2026-09-29T10:00:00.000Z");
  });
  it("pause 7 days after due (14 days after issue)", () => {
    const due = invoiceDueAt(issued);
    expect(invoicePauseAt(due).toISOString()).toBe("2026-10-06T10:00:00.000Z");
  });
  it("suspend 14 days after due (21 days after issue)", () => {
    const due = invoiceDueAt(issued);
    expect(invoiceSuspendAt(due).toISOString()).toBe("2026-10-13T10:00:00.000Z");
  });
});

describe("isInvoiceOnTime", () => {
  const due = new Date("2026-09-29T10:00:00Z");
  it("true at or before the due date", () => {
    expect(isInvoiceOnTime(new Date("2026-09-28T00:00:00Z"), due)).toBe(true);
    expect(isInvoiceOnTime(new Date(due), due)).toBe(true);
  });
  it("false after the due date, or with no payment date", () => {
    expect(isInvoiceOnTime(new Date("2026-09-29T10:00:01Z"), due)).toBe(false);
    expect(isInvoiceOnTime(null, due)).toBe(false);
  });
});

describe("ceilingBand", () => {
  it("ok below 70%", () => expect(ceilingBand(10_000, 25_000)).toBe("ok"));
  it("warn70 at or above 70%", () => expect(ceilingBand(17_500, 25_000)).toBe("warn70"));
  it("warn90 at or above 90%", () => expect(ceilingBand(22_500, 25_000)).toBe("warn90"));
  it("over at or above 100%", () => expect(ceilingBand(25_000, 25_000)).toBe("over"));
  it("over when the ceiling is zero or negative", () => expect(ceilingBand(0, 0)).toBe("over"));
});

describe("earnsEstablishedStatus / ceilingFor", () => {
  it("earns established status at ONTIME_INVOICES_FOR_ESTABLISHED (4) on-time invoices", () => {
    expect(earnsEstablishedStatus(3)).toBe(false);
    expect(earnsEstablishedStatus(4)).toBe(true);
  });
  it("ceilingFor picks the new or established amount", () => {
    expect(ceilingFor(false)).toBe(25_000);
    expect(ceilingFor(true)).toBe(100_000);
  });
});
