import { describe, expect, it } from "vitest";
import { paginate } from "./pagination";

describe("paginate", () => {
  it("returns everything with no next cursor when there is exactly one page", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(paginate(rows, 3)).toEqual({ items: rows, nextCursor: null });
  });

  it("returns everything with no next cursor when there is less than a full page", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    expect(paginate(rows, 5)).toEqual({ items: rows, nextCursor: null });
  });

  it("trims the lookahead row and points the cursor at the last real item", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }]; // limit+1 = 3, limit = 2
    expect(paginate(rows, 2)).toEqual({ items: [{ id: "a" }, { id: "b" }], nextCursor: "b" });
  });

  it("handles an empty page", () => {
    expect(paginate([], 50)).toEqual({ items: [], nextCursor: null });
  });
});
