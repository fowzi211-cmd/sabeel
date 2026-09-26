import { describe, expect, it } from "vitest";
import { responseState } from "./dispute";

const now = new Date("2026-09-26T12:00:00Z");
const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

describe("responseState", () => {
  it("no response step → NONE", () => expect(responseState({ responseDueAt: null, supplierRespondedAt: null }, now)).toBe("NONE"));
  it("inside the window and unanswered → AWAITING", () => expect(responseState({ responseDueAt: at(10), supplierRespondedAt: null }, now)).toBe("AWAITING"));
  it("exactly at the deadline is still AWAITING", () => expect(responseState({ responseDueAt: now, supplierRespondedAt: null }, now)).toBe("AWAITING"));
  it("past the deadline and unanswered → MISSED", () => expect(responseState({ responseDueAt: at(-1), supplierRespondedAt: null }, now)).toBe("MISSED"));
  it("answered → RESPONDED, before or after the deadline", () => {
    expect(responseState({ responseDueAt: at(10), supplierRespondedAt: at(-5) }, now)).toBe("RESPONDED");
    expect(responseState({ responseDueAt: at(-10), supplierRespondedAt: at(-11) }, now)).toBe("RESPONDED");
  });
});
