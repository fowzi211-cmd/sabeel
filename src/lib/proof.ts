// Pure rules for proof of delivery (design pack T09, R11). No database here so they are easy to test.

import { feeHalalas, vatIncluded } from "./money";
import { MAX_CLOCK_SKEW_MS, MAX_GPS_ACCURACY_M, MIN_PROOF_PHOTOS } from "./fulfilment";

export type PhotoKindLite = "BRAND_LABEL" | "DELIVERED_GOODS" | "SITE" | "FAILURE";

export interface ProofPhotoLite {
  kind: PhotoKindLite;
  source: string;
  capturedAt: Date;
  flags?: string[];
}

export interface ProofInput {
  photos: ProofPhotoLite[];
  /** Distance from the order pin to the driver's GPS fix, or null when there was no usable fix. */
  distanceM: number | null;
  radiusM: number;
  outsideReason?: string | null;
  recipientOtpVerified: boolean;
  otpBypassReason?: string | null;
  confirmedAtDevice: Date;
  serverNow: Date;
  /** Earliest moment a delivery can have happened (when the trip started). */
  tripStartedAt: Date | null;
}

export interface ProofVerdict {
  /** Blocking problems: the driver must fix these before the delivery can be confirmed. */
  errors: { field: string; code: string }[];
  /** Non-blocking anomalies recorded on the proof for the reviewer. */
  flags: string[];
  radiusOk: boolean;
  brandPhotoOk: boolean;
}

/**
 * T09 guard. Blocking: fewer than two photos, no brand-label photo, outside the radius (or no GPS)
 * without a reason, no recipient code without a reason. Everything else is recorded as a flag.
 */
export function evaluateProof(i: ProofInput): ProofVerdict {
  const errors: ProofVerdict["errors"] = [];
  const flags: string[] = [];

  const goods = i.photos.filter((p) => p.kind !== "FAILURE");
  if (goods.length < MIN_PROOF_PHOTOS) errors.push({ field: "photos", code: "TOO_FEW_PHOTOS" });
  const brandPhotoOk = goods.some((p) => p.kind === "BRAND_LABEL");
  if (!brandPhotoOk) errors.push({ field: "photos", code: "NO_BRAND_PHOTO" });

  const radiusOk = i.distanceM !== null && i.distanceM <= i.radiusM;
  if (!radiusOk) {
    if (!i.outsideReason?.trim()) errors.push({ field: "outsideReason", code: i.distanceM === null ? "NO_GPS_REASON_REQUIRED" : "OUTSIDE_RADIUS_REASON_REQUIRED" });
    flags.push(i.distanceM === null ? "NO_GPS" : "OUTSIDE_RADIUS");
  }

  if (!i.recipientOtpVerified) {
    if (!i.otpBypassReason?.trim()) errors.push({ field: "otpBypassReason", code: "RECIPIENT_CODE_REQUIRED" });
    flags.push("NO_RECIPIENT_CODE");
  }

  if (i.photos.some((p) => p.source !== "CAMERA")) flags.push("PHOTO_FROM_FILE");
  if (i.photos.some((p) => p.flags?.includes("DUPLICATE_PHOTO"))) flags.push("DUPLICATE_PHOTO");
  if (i.photos.some((p) => p.flags?.includes("LOW_ACCURACY"))) flags.push("LOW_GPS_ACCURACY");

  // Device clocks: photos must be taken after the trip began and not in the future.
  const skew = MAX_CLOCK_SKEW_MS;
  const future = (d: Date) => d.getTime() > i.serverNow.getTime() + skew;
  const beforeTrip = (d: Date) => i.tripStartedAt !== null && d.getTime() < i.tripStartedAt.getTime() - skew;
  if (i.photos.some((p) => future(p.capturedAt)) || future(i.confirmedAtDevice)) flags.push("CLOCK_AHEAD");
  if (i.photos.some((p) => beforeTrip(p.capturedAt))) flags.push("PHOTO_BEFORE_TRIP");

  return { errors, flags: [...new Set(flags)], radiusOk, brandPhotoOk };
}

export const isUsableFix = (accuracyM: number | null | undefined) => accuracyM === null || accuracyM === undefined || accuracyM <= MAX_GPS_ACCURACY_M;

export interface DeliveredLine {
  unitPriceHalalas: number;
  packetEqMilli: number;
  qtyPacks: number;
  deliveredQtyPacks: number;
}

export interface DeliveredTotals {
  partial: boolean;
  anyDelivered: boolean;
  goodsHalalas: number;
  totalHalalas: number;
  vatHalalas: number;
  packetEqMilli: number;
  feeHalalas: number;
}

/** Amounts and fee follow what was really delivered (lean prompt §E). The delivery charge applies if anything arrived. */
export function deliveredTotals(lines: DeliveredLine[], deliveryHalalas: number, feePerPacketHalalas: number): DeliveredTotals {
  const goods = lines.reduce((s, l) => s + l.unitPriceHalalas * l.deliveredQtyPacks, 0);
  const eq = lines.reduce((s, l) => s + l.packetEqMilli * l.deliveredQtyPacks, 0);
  const anyDelivered = lines.some((l) => l.deliveredQtyPacks > 0);
  const total = goods + (anyDelivered ? deliveryHalalas : 0);
  return {
    partial: lines.some((l) => l.deliveredQtyPacks < l.qtyPacks),
    anyDelivered,
    goodsHalalas: goods,
    totalHalalas: total,
    vatHalalas: vatIncluded(total),
    packetEqMilli: eq,
    feeHalalas: feeHalalas(eq, 1, feePerPacketHalalas),
  };
}

export interface ReviewInput {
  flags: string[];
  supplierIsIndependent: boolean;
  supplierDeliveriesSoFar: number;
  pilotReviewAll: boolean;
  sampleRate: number;
  probationDeliveries: number;
  /** Injected so tests are deterministic. */
  random: number;
  partial: boolean;
  submittedOffline: boolean;
}

/** R11: what decides whether an admin has to look at a delivery. Empty result = no review needed. */
export function reviewReasons(i: ReviewInput): string[] {
  const r: string[] = [];
  if (i.flags.length > 0) r.push("FLAGGED");
  if (i.supplierIsIndependent && i.supplierDeliveriesSoFar < i.probationDeliveries) r.push("PROBATION");
  if (i.partial) r.push("PARTIAL");
  if (i.pilotReviewAll) r.push("PILOT");
  else if (i.random < i.sampleRate) r.push("SAMPLE");
  if (i.submittedOffline && i.flags.length > 0) r.push("OFFLINE_FLAGGED");
  return r;
}
