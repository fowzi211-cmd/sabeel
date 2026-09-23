import { describe, expect, it } from "vitest";
import { distanceMetres } from "./geo";
import { deliveredTotals, evaluateProof, reviewReasons, type ProofInput } from "./proof";

const now = new Date("2026-09-22T09:00:00Z");
const started = new Date("2026-09-22T08:30:00Z");
const photo = (kind: "BRAND_LABEL" | "DELIVERED_GOODS" | "SITE" | "FAILURE", extra: Partial<{ source: string; capturedAt: Date; flags: string[] }> = {}) => ({
  kind, source: "CAMERA", capturedAt: new Date("2026-09-22T08:55:00Z"), ...extra,
});

const good = (over: Partial<ProofInput> = {}): ProofInput => ({
  photos: [photo("BRAND_LABEL"), photo("DELIVERED_GOODS")],
  distanceM: 40, radiusM: 100, recipientOtpVerified: true,
  confirmedAtDevice: new Date("2026-09-22T08:58:00Z"), serverNow: now, tripStartedAt: started,
  ...over,
});

describe("distanceMetres", () => {
  it("is 0 for the same point and roughly right for a known offset", () => {
    expect(distanceMetres({ lat: 21.39, lng: 39.86 }, { lat: 21.39, lng: 39.86 })).toBe(0);
    // 0.001° of latitude ≈ 111 m
    const d = distanceMetres({ lat: 21.39, lng: 39.86 }, { lat: 21.391, lng: 39.86 });
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(118);
  });
});

describe("evaluateProof (T09 guard)", () => {
  it("accepts complete proof with no flags", () => {
    const v = evaluateProof(good());
    expect(v.errors).toEqual([]);
    expect(v.flags).toEqual([]);
    expect(v.radiusOk).toBe(true);
    expect(v.brandPhotoOk).toBe(true);
  });

  it("needs at least two photos and one showing the brand label", () => {
    expect(evaluateProof(good({ photos: [photo("BRAND_LABEL")] })).errors).toContainEqual({ field: "photos", code: "TOO_FEW_PHOTOS" });
    const noBrand = evaluateProof(good({ photos: [photo("DELIVERED_GOODS"), photo("SITE")] }));
    expect(noBrand.errors).toContainEqual({ field: "photos", code: "NO_BRAND_PHOTO" });
    // A failure photo never counts as delivery proof.
    expect(evaluateProof(good({ photos: [photo("BRAND_LABEL"), photo("FAILURE")] })).errors).toContainEqual({ field: "photos", code: "TOO_FEW_PHOTOS" });
  });

  it("outside the radius needs a reason and is flagged either way", () => {
    const blocked = evaluateProof(good({ distanceM: 400 }));
    expect(blocked.errors).toContainEqual({ field: "outsideReason", code: "OUTSIDE_RADIUS_REASON_REQUIRED" });
    const allowed = evaluateProof(good({ distanceM: 400, outsideReason: "Gate is on the next street" }));
    expect(allowed.errors).toEqual([]);
    expect(allowed.flags).toContain("OUTSIDE_RADIUS");
    expect(allowed.radiusOk).toBe(false);
  });

  it("no usable GPS also needs a reason", () => {
    const v = evaluateProof(good({ distanceM: null }));
    expect(v.errors).toContainEqual({ field: "outsideReason", code: "NO_GPS_REASON_REQUIRED" });
    expect(evaluateProof(good({ distanceM: null, outsideReason: "GPS off in the building" })).flags).toContain("NO_GPS");
  });

  it("a missing recipient code needs a recorded reason and is flagged", () => {
    expect(evaluateProof(good({ recipientOtpVerified: false })).errors).toContainEqual({ field: "otpBypassReason", code: "RECIPIENT_CODE_REQUIRED" });
    const ok = evaluateProof(good({ recipientOtpVerified: false, otpBypassReason: "No signal for the SMS" }));
    expect(ok.errors).toEqual([]);
    expect(ok.flags).toContain("NO_RECIPIENT_CODE");
  });

  it("flags file-picker photos, duplicates, future clocks and photos from before the trip", () => {
    const v = evaluateProof(good({
      photos: [photo("BRAND_LABEL", { source: "FILE" }), photo("DELIVERED_GOODS", { flags: ["DUPLICATE_PHOTO"] }), photo("SITE", { capturedAt: new Date("2026-09-22T06:00:00Z") })],
      confirmedAtDevice: new Date("2026-09-22T12:00:00Z"),
    }));
    expect(v.errors).toEqual([]);
    expect(v.flags).toEqual(expect.arrayContaining(["PHOTO_FROM_FILE", "DUPLICATE_PHOTO", "PHOTO_BEFORE_TRIP", "CLOCK_AHEAD"]));
  });
});

describe("deliveredTotals (amounts follow what arrived)", () => {
  const lines = [
    { unitPriceHalalas: 900, packetEqMilli: 1000, qtyPacks: 10, deliveredQtyPacks: 10 },
    { unitPriceHalalas: 1000, packetEqMilli: 1200, qtyPacks: 5, deliveredQtyPacks: 5 },
  ];
  it("full delivery equals the order, fee from packet-equivalents", () => {
    const t = deliveredTotals(lines, 1500, 50);
    expect(t.partial).toBe(false);
    expect(t.goodsHalalas).toBe(9000 + 5000);
    expect(t.totalHalalas).toBe(14000 + 1500);
    expect(t.packetEqMilli).toBe(10_000 + 6_000);
    expect(t.feeHalalas).toBe(800); // 16 packet-equivalents × SAR 0.50
    expect(t.vatHalalas).toBe(Math.round((15500 * 15) / 115));
  });
  it("partial delivery reduces goods and fee, keeps the delivery charge", () => {
    const t = deliveredTotals([{ ...lines[0], deliveredQtyPacks: 6 }, { ...lines[1], deliveredQtyPacks: 0 }], 1500, 50);
    expect(t.partial).toBe(true);
    expect(t.goodsHalalas).toBe(5400);
    expect(t.totalHalalas).toBe(5400 + 1500);
    expect(t.feeHalalas).toBe(300);
  });
  it("nothing delivered means no delivery charge either", () => {
    const t = deliveredTotals(lines.map((l) => ({ ...l, deliveredQtyPacks: 0 })), 1500, 50);
    expect(t.anyDelivered).toBe(false);
    expect(t.totalHalalas).toBe(0);
    expect(t.feeHalalas).toBe(0);
  });
});

describe("reviewReasons (R11)", () => {
  const base = { flags: [], supplierIsIndependent: false, supplierDeliveriesSoFar: 50, pilotReviewAll: false, sampleRate: 0.05, probationDeliveries: 10, random: 0.9, partial: false, submittedOffline: false };
  it("no review for a clean delivery once the pilot rule is off", () => {
    expect(reviewReasons(base)).toEqual([]);
  });
  it("pilot reviews everything", () => {
    expect(reviewReasons({ ...base, pilotReviewAll: true })).toEqual(["PILOT"]);
  });
  it("flags, probation, partial and random sampling each trigger a review", () => {
    expect(reviewReasons({ ...base, flags: ["NO_GPS"] })).toContain("FLAGGED");
    expect(reviewReasons({ ...base, supplierIsIndependent: true, supplierDeliveriesSoFar: 3 })).toContain("PROBATION");
    expect(reviewReasons({ ...base, supplierIsIndependent: true, supplierDeliveriesSoFar: 10 })).toEqual([]);
    expect(reviewReasons({ ...base, partial: true })).toContain("PARTIAL");
    expect(reviewReasons({ ...base, random: 0.01 })).toContain("SAMPLE");
    expect(reviewReasons({ ...base, flags: ["NO_GPS"], submittedOffline: true })).toContain("OFFLINE_FLAGGED");
  });
});
