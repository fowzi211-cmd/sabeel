import { z } from "zod";
import { Prisma, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import {
  AUDIT_SAMPLE_RATE, FAIL_REASONS, MAX_GPS_ACCURACY_M, MAX_PROOF_PHOTOS, MAX_RECIPIENT_CODE_SENDS, PILOT_REVIEW_ALL, PROBATION_DELIVERIES,
} from "@/lib/fulfilment";
import { distanceMetres, insideMakkah } from "@/lib/geo";
import { requestOtp, verifyOtp } from "@/lib/otp";
import { deliveredTotals, evaluateProof, reviewReasons } from "@/lib/proof";
import { notifyUserId } from "./notify";
import { sendSms } from "@/lib/sms";
import { savePhoto, deleteUpload } from "./storage";
import { hasAcceptedCurrent } from "./terms";

const TX = { timeout: 20_000, maxWait: 10_000 };
const lock = (tx: Prisma.TransactionClient, orderId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"order:" + orderId}))`;
const MASK_AFTER_MS = 30 * 86_400_000; // recipient details are masked again 30 days after delivery (R12)
const firstName = (n?: string | null) => (n ?? "").trim().split(/\s+/)[0] ?? "";

// ───────────────────────── who is this driver? ─────────────────────────

/** The driver must have accepted the current driver acknowledgement (lean prompt §L) before working. */
export async function driverAckState(userId: string) {
  const terms = await hasAcceptedCurrent({ userId, supplierId: null, type: "DRIVER_ACK" });
  return { required: !!terms.doc && !terms.accepted, doc: terms.doc };
}

async function assertDriverReady(userId: string) {
  if ((await driverAckState(userId)).required) throw new AppError("DRIVER_ACK_REQUIRED");
}

const jobInclude = {
  driver: { include: { supplier: { select: { id: true, tradeName: true, legalNameAr: true, legalNameEn: true } } } },
  photos: { orderBy: { capturedAt: "asc" as const } },
  proofs: { select: { id: true, attempt: true } },
  attemptLog: { orderBy: { n: "asc" as const } },
  order: { include: { items: true, buyer: { select: { id: true, mobile: true, name: true } } } },
} satisfies Prisma.DeliveryInclude;
type JobRow = Prisma.DeliveryGetPayload<{ include: typeof jobInclude }>;

async function ownedJob(userId: string, deliveryOrOrderId: string): Promise<JobRow> {
  const job = await db.delivery.findFirst({
    where: { OR: [{ id: deliveryOrOrderId }, { orderId: deliveryOrOrderId }], driver: { userId, active: true } },
    include: jobInclude,
  });
  if (!job) throw new AppError("NOT_FOUND"); // also the answer for someone else's job
  return job;
}

// ───────────────────────── what the driver sees ─────────────────────────

/**
 * Drivers get what they need to deliver — never prices, never the donor's last name or mobile
 * (R12). Recipient details are visible from assignment and masked 30 days after delivery.
 */
function jobView(j: JobRow, districtName: { ar: string; en: string; radiusM: number }, now: Date) {
  const o = j.order;
  const maskedNow = j.deliveredAt !== null && now.getTime() - j.deliveredAt.getTime() > MASK_AFTER_MS;
  const attempt = j.attempts;
  const sends = 0; // computed by caller for the open job only
  return {
    id: j.id, orderId: o.id, orderNo: o.orderNo, orderStatus: o.status, deliveryStatus: j.status, attempts: j.attempts,
    supplier: { nameAr: j.driver.supplier.tradeName || j.driver.supplier.legalNameAr, nameEn: j.driver.supplier.legalNameEn || j.driver.supplier.tradeName || j.driver.supplier.legalNameAr },
    donor: o.type === "DONATION" ? (o.anonymous ? null : o.buyerFirstName) : null,
    anonymous: o.type === "DONATION" && o.anonymous,
    selfUse: o.type === "SELF_USE",
    window: { start: o.windowStart, end: o.windowEnd },
    district: { nameAr: districtName.ar, nameEn: districtName.en },
    radiusM: districtName.radiusM,
    destination: maskedNow
      ? { lat: o.lat, lng: o.lng, nationalAddress: null, landmark: null, accessNotes: null, recipientName: null, recipientMobile: null }
      : { lat: o.lat, lng: o.lng, nationalAddress: o.nationalAddress, landmark: o.landmark, accessNotes: o.accessNotes, recipientName: o.recipientName, recipientMobile: o.recipientMobile },
    proposedPin: j.pinLat !== null && j.pinLng !== null ? { lat: j.pinLat, lng: j.pinLng, note: j.pinNote } : null,
    items: o.items.map((i) => ({ id: i.id, brandNameAr: i.brandNameAr, brandNameEn: i.brandNameEn, bottleMl: i.bottleMl, bottlesPerPack: i.bottlesPerPack, qtyPacks: i.qtyPacks, deliveredQtyPacks: i.deliveredQtyPacks })),
    startedAt: j.startedAt, arrivedAt: j.arrivedAt, deliveredAt: j.deliveredAt,
    codeSent: !!j.otpSentAt, codeVerified: !!j.otpVerifiedAt, codeSendsLeft: Math.max(0, MAX_RECIPIENT_CODE_SENDS - sends),
    photos: j.photos.filter((p) => p.attempt === attempt).map((p) => ({ id: p.id, clientId: p.clientId, kind: p.kind })),
    lastFailure: [...j.attemptLog].reverse().find((a) => a.outcome === "FAILED")?.failReason ?? null,
    proofSubmitted: j.proofs.some((p) => p.attempt === attempt),
    note: o.note,
  };
}

async function districtInfo(districtId: string) {
  const d = await db.district.findUnique({ where: { id: districtId } });
  return { ar: d?.nameAr ?? "", en: d?.nameEn ?? "", radiusM: d?.gpsRadiusM ?? 100 };
}

/** Everything the driver app needs to work offline: full detail for every open job, brief history. */
export async function listJobs(user: Pick<User, "id" | "name">, now: Date = new Date()) {
  const ack = await driverAckState(user.id);
  if (ack.required) return { ackRequired: true as const, driverName: user.name, jobs: [], history: [] };

  const rows = await db.delivery.findMany({
    where: {
      driver: { userId: user.id, active: true },
      OR: [
        { order: { status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY", "FAILED_ATTEMPT"] } } },
        { deliveredAt: { gte: new Date(now.getTime() - 14 * 86_400_000) } },
      ],
    },
    include: jobInclude,
    orderBy: { order: { windowStart: "asc" } },
    take: 100,
  });
  const districts = new Map<string, Awaited<ReturnType<typeof districtInfo>>>();
  const jobs = [];
  const history = [];
  for (const r of rows) {
    if (!districts.has(r.order.districtId)) districts.set(r.order.districtId, await districtInfo(r.order.districtId));
    const v = jobView(r, districts.get(r.order.districtId)!, now);
    const sends = await db.otpChallenge.count({ where: { purpose: "DELIVERY", context: `delivery:${r.id}:${r.attempts}` } });
    v.codeSendsLeft = Math.max(0, MAX_RECIPIENT_CODE_SENDS - sends);
    if (["ASSIGNED", "OUT_FOR_DELIVERY", "FAILED_ATTEMPT"].includes(r.order.status)) jobs.push(v);
    else history.push(v);
  }
  return { ackRequired: false as const, driverName: user.name, jobs, history };
}

export async function getJob(user: Pick<User, "id" | "name">, id: string, now: Date = new Date()) {
  await assertDriverReady(user.id);
  const j = await ownedJob(user.id, id);
  const v = jobView(j, await districtInfo(j.order.districtId), now);
  const sends = await db.otpChallenge.count({ where: { purpose: "DELIVERY", context: `delivery:${j.id}:${j.attempts}` } });
  v.codeSendsLeft = Math.max(0, MAX_RECIPIENT_CODE_SENDS - sends);
  return v;
}

// ───────────────────────── trip steps ─────────────────────────

/** A time the phone reports is accepted only if plausible; otherwise the server's clock is used. */
function plausible(client: Date | undefined, now: Date, notBefore?: Date | null): Date {
  if (!client || Number.isNaN(client.getTime())) return now;
  if (client.getTime() > now.getTime() + 5 * 60_000) return now;
  if (notBefore && client.getTime() < notBefore.getTime()) return now;
  if (client.getTime() < now.getTime() - 3 * 86_400_000) return now;
  return client;
}

/** T08: the driver leaves. Idempotent, so an offline retry never starts a second attempt. */
export async function startTrip(user: User, id: string, input: { clientAt?: Date }, meta: RequestMeta, now: Date = new Date()) {
  await assertDriverReady(user.id);
  const j = await ownedJob(user.id, id);
  if (j.status === "EN_ROUTE" || j.status === "ARRIVED") return getJob(user, j.id, now);
  if (j.status !== "ASSIGNED" || j.order.status !== "ASSIGNED") throw new AppError("INVALID_STATE");

  const startedAt = plausible(input.clientAt, now, j.assignedAt);
  await db.$transaction(async (tx) => {
    await lock(tx, j.orderId);
    const changed = await tx.order.updateMany({ where: { id: j.orderId, status: "ASSIGNED" }, data: { status: "OUT_FOR_DELIVERY" } });
    if (changed.count === 0) throw new AppError("INVALID_STATE");
    const n = j.attempts + 1;
    await tx.delivery.update({ where: { id: j.id }, data: { status: "EN_ROUTE", startedAt, arrivedAt: null, attempts: n } });
    await tx.deliveryAttempt.create({ data: { deliveryId: j.id, n, driverId: j.driverId, startedAt } });
    await tx.orderEvent.create({ data: { orderId: j.orderId, type: "OUT_FOR_DELIVERY", actorId: user.id } });
    await audit({ actor: user, action: "delivery.started", entity: "Delivery", entityId: j.id, after: { attempt: n }, meta }, tx);
  }, TX);

  const o = j.order;
  await notifyUserId(o.buyerId, "delivery.started", {
    ar: `سبيل: طلبك ${o.orderNo} في الطريق مع السائق ${firstName(user.name)}.`,
    en: `Sabeel: order ${o.orderNo} is on its way with driver ${firstName(user.name)}.`,
  }, { orderId: o.id });
  // The person receiving the water hears about it too (N06) — only if that is someone other than the buyer.
  if (o.recipientMobile && o.recipientMobile !== o.buyer.mobile) {
    await sendSms({ to: o.recipientMobile, event: "delivery.started_recipient", text: "سبيل: مياه في الطريق إليكم. سيصلكم رمز استلام برسالة عند وصول السائق.", }).catch((e) => console.error("[sms] recipient notice failed", e));
  }
  return getJob(user, j.id, now);
}

export const arrivedSchema = z.object({
  clientAt: z.coerce.date().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export async function markArrived(user: User, id: string, input: z.infer<typeof arrivedSchema>, meta: RequestMeta, now: Date = new Date()) {
  await assertDriverReady(user.id);
  const j = await ownedJob(user.id, id);
  if (j.status === "ARRIVED") return getJob(user, j.id, now);
  if (j.status !== "EN_ROUTE" || j.order.status !== "OUT_FOR_DELIVERY") throw new AppError("INVALID_STATE");
  const arrivedAt = plausible(input.clientAt, now, j.startedAt);
  await db.$transaction(async (tx) => {
    await tx.delivery.update({ where: { id: j.id }, data: { status: "ARRIVED", arrivedAt } });
    await tx.deliveryAttempt.update({ where: { deliveryId_n: { deliveryId: j.id, n: j.attempts } }, data: { arrivedAt, lat: input.lat ?? null, lng: input.lng ?? null } });
    await audit({ actor: user, action: "delivery.arrived", entity: "Delivery", entityId: j.id, after: { attempt: j.attempts }, meta }, tx);
  });
  return getJob(user, j.id, now);
}

/** N29: text a one-time delivery code to the recipient. They read it out to the driver only when the water has arrived. */
export async function sendRecipientCode(user: User, id: string, meta: RequestMeta, now: Date = new Date()) {
  await assertDriverReady(user.id);
  const j = await ownedJob(user.id, id);
  if (j.status !== "ARRIVED") throw new AppError("INVALID_STATE");
  const mobile = j.order.recipientMobile;
  if (!mobile) throw new AppError("INVALID_STATE");
  const context = `delivery:${j.id}:${j.attempts}`;
  const sent = await db.otpChallenge.count({ where: { purpose: "DELIVERY", context } });
  if (sent >= MAX_RECIPIENT_CODE_SENDS) throw new AppError("RATE_LIMITED");

  const r = await requestOtp({ mobile, purpose: "DELIVERY", context, lang: "AR", ip: meta.ip });
  await db.delivery.update({ where: { id: j.id }, data: { otpSentAt: now } });
  return { sent: true, expiresAt: r.expiresAt, cooldownSeconds: r.cooldownSeconds, sendsLeft: MAX_RECIPIENT_CODE_SENDS - sent - 1, ...(r.devCode ? { devCode: r.devCode } : {}) };
}

export async function verifyRecipientCode(user: User, id: string, code: string, now: Date = new Date()) {
  await assertDriverReady(user.id);
  const j = await ownedJob(user.id, id);
  if (j.otpVerifiedAt) return { verified: true };
  if (j.status !== "ARRIVED" || !j.order.recipientMobile) throw new AppError("INVALID_STATE");
  await verifyOtp({ mobile: j.order.recipientMobile, purpose: "DELIVERY", code, context: `delivery:${j.id}:${j.attempts}` });
  await db.delivery.update({ where: { id: j.id }, data: { otpVerifiedAt: now } });
  return { verified: true };
}

export const pinSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), note: z.string().trim().max(200).optional() });

/** The driver proposes a corrected pin. It never overwrites the buyer's own pin; reviewers see both. */
export async function proposePin(user: User, id: string, input: z.infer<typeof pinSchema>, meta: RequestMeta, now: Date = new Date()) {
  await assertDriverReady(user.id);
  const j = await ownedJob(user.id, id);
  if (j.status !== "EN_ROUTE" && j.status !== "ARRIVED") throw new AppError("INVALID_STATE");
  if (!insideMakkah(input.lat, input.lng) || distanceMetres({ lat: j.order.lat, lng: j.order.lng }, input) > 3000) throw new AppError("VALIDATION", { field: "lat" });
  await db.delivery.update({ where: { id: j.id }, data: { pinLat: input.lat, pinLng: input.lng, pinNote: input.note ?? null, pinProposedAt: now } });
  await audit({ actor: user, action: "delivery.pin_proposed", entity: "Delivery", entityId: j.id, after: { lat: input.lat, lng: input.lng }, meta });
}

// ───────────────────────── photos ─────────────────────────

export const photoMetaSchema = z.object({
  clientId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(["BRAND_LABEL", "DELIVERED_GOODS", "SITE", "FAILURE"]),
  capturedAt: z.coerce.date(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  accuracyM: z.coerce.number().min(0).max(100_000).optional(),
  source: z.enum(["CAMERA", "FILE"]).default("CAMERA"),
});

/** One in-app photo. Retrying the same `clientId` (offline sync) returns the stored photo instead of a second copy. */
export async function addPhoto(user: User, id: string, meta: z.infer<typeof photoMetaSchema>, file: File, reqMeta: RequestMeta, now: Date = new Date()) {
  await assertDriverReady(user.id);
  const j = await ownedJob(user.id, id);
  const existing = j.photos.find((p) => p.clientId === meta.clientId);
  if (existing) return { photo: { id: existing.id, clientId: existing.clientId, kind: existing.kind }, replay: true };
  if ((j.status !== "EN_ROUTE" && j.status !== "ARRIVED") || j.order.status !== "OUT_FOR_DELIVERY") throw new AppError("INVALID_STATE");
  if (j.photos.filter((p) => p.attempt === j.attempts).length >= MAX_PROOF_PHOTOS) throw new AppError("VALIDATION", { field: "photos" });

  const stored = await savePhoto(j.id, file);
  const flags: string[] = [];
  const duplicate = await db.proofPhoto.findFirst({ where: { sha256: stored.sha256 }, select: { id: true } });
  if (duplicate) flags.push("DUPLICATE_PHOTO");
  if (meta.accuracyM !== undefined && meta.accuracyM > MAX_GPS_ACCURACY_M) flags.push("LOW_ACCURACY");
  if (meta.source !== "CAMERA") flags.push("NOT_LIVE_CAMERA");

  try {
    const photo = await db.proofPhoto.create({
      data: {
        deliveryId: j.id, attempt: j.attempts, clientId: meta.clientId, kind: meta.kind,
        fileKey: stored.fileKey, mime: stored.mime, size: stored.size, sha256: stored.sha256,
        lat: meta.lat ?? null, lng: meta.lng ?? null, accuracyM: meta.accuracyM ?? null,
        capturedAt: plausible(meta.capturedAt, now), source: meta.source, flags,
      },
    });
    await audit({ actor: user, action: "delivery.photo_added", entity: "ProofPhoto", entityId: photo.id, after: { kind: meta.kind, flags }, meta: reqMeta });
    return { photo: { id: photo.id, clientId: photo.clientId, kind: photo.kind }, replay: false };
  } catch (e) {
    await deleteUpload(stored.fileKey);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.proofPhoto.findFirst({ where: { deliveryId: j.id, clientId: meta.clientId } });
      if (again) return { photo: { id: again.id, clientId: again.clientId, kind: again.kind }, replay: true };
    }
    throw e;
  }
}

// ───────────────────────── confirm (T09) ─────────────────────────

export const confirmSchema = z.object({
  items: z.array(z.object({ itemId: z.string().min(1), deliveredQtyPacks: z.number().int().min(0).max(500) })).min(1).max(10),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().min(0).max(100_000).optional(),
  outsideReason: z.string().trim().max(300).optional(),
  otpBypassReason: z.string().trim().max(300).optional(),
  batchNote: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
  confirmedAt: z.coerce.date(),
  /** True when the phone had no connection when the driver tapped confirm. */
  offline: z.boolean().default(false),
});
export type ConfirmInput = z.infer<typeof confirmSchema>;

export async function confirmDelivery(user: User, id: string, input: ConfirmInput, meta: RequestMeta, now: Date = new Date()) {
  await assertDriverReady(user.id);
  const j = await ownedJob(user.id, id);
  if (j.status === "DELIVERED" && j.proofs.some((p) => p.attempt === j.attempts)) return { replay: true as const };
  if ((j.status !== "EN_ROUTE" && j.status !== "ARRIVED") || j.order.status !== "OUT_FOR_DELIVERY") throw new AppError("INVALID_STATE");

  const order = j.order;
  // Every ordered line must be reported, none more than ordered.
  const qtyByItem = new Map(input.items.map((i) => [i.itemId, i.deliveredQtyPacks]));
  if (qtyByItem.size !== input.items.length || order.items.some((i) => !qtyByItem.has(i.id)) || input.items.some((i) => !order.items.some((o) => o.id === i.itemId))) {
    throw new AppError("VALIDATION", { field: "items" });
  }
  for (const i of order.items) if ((qtyByItem.get(i.id) ?? 0) > i.qtyPacks) throw new AppError("VALIDATION", { field: "items" });
  if (![...qtyByItem.values()].some((q) => q > 0)) throw new AppError("VALIDATION", { field: "items", message: "Nothing was delivered — record a failed delivery instead" });

  const district = await db.district.findUnique({ where: { id: order.districtId } });
  const radiusM = district?.gpsRadiusM ?? 100;
  const hasFix = input.lat !== undefined && input.lng !== undefined && (input.accuracyM === undefined || input.accuracyM <= MAX_GPS_ACCURACY_M);
  let distanceM: number | null = null;
  const flagsExtra: string[] = [];
  if (hasFix) {
    const here = { lat: input.lat!, lng: input.lng! };
    distanceM = distanceMetres({ lat: order.lat, lng: order.lng }, here);
    if (j.pinLat !== null && j.pinLng !== null) {
      const viaPin = distanceMetres({ lat: j.pinLat, lng: j.pinLng }, here);
      if (viaPin < distanceM) { distanceM = viaPin; flagsExtra.push("PIN_CORRECTED"); }
    }
  } else if (input.lat !== undefined) {
    flagsExtra.push("LOW_GPS_ACCURACY");
  }

  const photos = j.photos.filter((p) => p.attempt === j.attempts);
  const verdict = evaluateProof({
    photos: photos.map((p) => ({ kind: p.kind, source: p.source, capturedAt: p.capturedAt, flags: p.flags })),
    distanceM, radiusM, outsideReason: input.outsideReason,
    recipientOtpVerified: !!j.otpVerifiedAt, otpBypassReason: input.otpBypassReason,
    confirmedAtDevice: input.confirmedAt, serverNow: now, tripStartedAt: j.startedAt,
  });
  if (verdict.errors.length > 0) throw new AppError("PROOF_INCOMPLETE", { details: { errors: verdict.errors } });

  // "Offline" is what the phone says OR simply how late the confirmation reached us: a delivery confirmed
  // minutes before it arrived was, in practice, submitted from a phone with no connection.
  const submittedOffline = input.offline || now.getTime() - input.confirmedAt.getTime() > 2 * 60_000;
  const lines = order.items.map((i) => ({ unitPriceHalalas: i.unitPriceHalalas, packetEqMilli: i.packetEqMilli, qtyPacks: i.qtyPacks, deliveredQtyPacks: qtyByItem.get(i.id)! }));
  const totals = deliveredTotals(lines, order.deliveryHalalas, order.feePerPacketHalalas);
  const flags = [...new Set([...verdict.flags, ...flagsExtra])];
  const done = await db.proofOfDelivery.count({ where: { delivery: { order: { supplierId: order.supplierId } } } });
  const supplier = await db.supplier.findUnique({ where: { id: order.supplierId }, select: { type: true } });
  const reasons = reviewReasons({
    flags, supplierIsIndependent: supplier?.type === "INDEPENDENT", supplierDeliveriesSoFar: done,
    pilotReviewAll: PILOT_REVIEW_ALL, sampleRate: AUDIT_SAMPLE_RATE, probationDeliveries: PROBATION_DELIVERIES,
    random: Math.random(), partial: totals.partial, submittedOffline,
  });

  try {
    await db.$transaction(async (tx) => {
      await lock(tx, order.id);
      const changed = await tx.order.updateMany({ where: { id: order.id, status: "OUT_FOR_DELIVERY" }, data: { status: "DELIVERED_DRIVER_CONFIRMED" } });
      if (changed.count === 0) throw new AppError("INVALID_STATE");
      for (const i of order.items) await tx.orderItem.update({ where: { id: i.id }, data: { deliveredQtyPacks: qtyByItem.get(i.id)! } });
      await tx.delivery.update({ where: { id: j.id }, data: { status: "DELIVERED", deliveredAt: now } });
      await tx.deliveryAttempt.update({ where: { deliveryId_n: { deliveryId: j.id, n: j.attempts } }, data: { outcome: "DELIVERED", endedAt: now, lat: input.lat ?? null, lng: input.lng ?? null } });
      await tx.proofOfDelivery.create({
        data: {
          deliveryId: j.id, attempt: j.attempts, lat: input.lat ?? null, lng: input.lng ?? null, accuracyM: input.accuracyM ?? null,
          distanceM, radiusM, radiusOk: verdict.radiusOk, outsideReason: input.outsideReason?.trim() || null,
          brandPhotoOk: verdict.brandPhotoOk, recipientOtpOk: !!j.otpVerifiedAt, otpBypassReason: input.otpBypassReason?.trim() || null,
          batchNote: input.batchNote || null, notes: input.notes || null, partial: totals.partial,
          deliveredGoodsHalalas: totals.goodsHalalas, deliveredTotalHalalas: totals.totalHalalas, deliveredVatHalalas: totals.vatHalalas,
          deliveredPacketEqMilli: totals.packetEqMilli, deliveredFeeHalalas: totals.feeHalalas,
          confirmedAtDevice: input.confirmedAt, submittedOffline,
          flags, reviewRequired: reasons.length > 0, reviewReasons: reasons,
        },
      });
      await tx.orderEvent.create({ data: { orderId: order.id, type: "DELIVERED", actorId: user.id } });
      await audit({ actor: user, action: "delivery.confirmed", entity: "Delivery", entityId: j.id, after: { partial: totals.partial, flags, offline: submittedOffline }, meta }, tx);
    }, TX);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { replay: true as const }; // proof already stored by an earlier attempt
    throw e;
  }

  await notifyUserId(order.buyerId, "delivery.delivered", {
    ar: `سبيل: تم توصيل طلبك ${order.orderNo}. راجع تقرير التسليم وأكّد الاستلام.`,
    en: `Sabeel: order ${order.orderNo} was delivered. Please review the delivery report and confirm receipt.`,
  }, { orderId: order.id });
  return { replay: false as const, flags, partial: totals.partial };
}

// ───────────────────────── failed delivery (T10) ─────────────────────────

export const failSchema = z.object({
  reason: z.enum(FAIL_REASONS),
  note: z.string().trim().max(300).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  clientAt: z.coerce.date().optional(),
});

export async function failDelivery(user: User, id: string, input: z.infer<typeof failSchema>, meta: RequestMeta, now: Date = new Date()) {
  await assertDriverReady(user.id);
  const j = await ownedJob(user.id, id);
  if (j.status === "FAILED") return { replay: true as const };
  if ((j.status !== "EN_ROUTE" && j.status !== "ARRIVED") || j.order.status !== "OUT_FOR_DELIVERY") throw new AppError("INVALID_STATE");
  if (input.reason === "OTHER" && !input.note?.trim()) throw new AppError("VALIDATION", { field: "note" });
  // "Reason + evidence": at least one photo taken at the door.
  if (!j.photos.some((p) => p.attempt === j.attempts && p.kind === "FAILURE")) throw new AppError("PROOF_INCOMPLETE", { details: { errors: [{ field: "photos", code: "NO_FAILURE_PHOTO" }] } });

  const endedAt = plausible(input.clientAt, now, j.startedAt);
  await db.$transaction(async (tx) => {
    await lock(tx, j.orderId);
    const changed = await tx.order.updateMany({ where: { id: j.orderId, status: "OUT_FOR_DELIVERY" }, data: { status: "FAILED_ATTEMPT" } });
    if (changed.count === 0) throw new AppError("INVALID_STATE");
    await tx.delivery.update({ where: { id: j.id }, data: { status: "FAILED" } });
    await tx.deliveryAttempt.update({ where: { deliveryId_n: { deliveryId: j.id, n: j.attempts } }, data: { outcome: "FAILED", endedAt, failReason: input.reason, failNote: input.note?.trim() || null, lat: input.lat ?? null, lng: input.lng ?? null } });
    await tx.orderEvent.create({ data: { orderId: j.orderId, type: "FAILED_ATTEMPT", actorId: user.id } });
    await audit({ actor: user, action: "delivery.failed", entity: "Delivery", entityId: j.id, after: { reason: input.reason, attempt: j.attempts }, note: input.note, meta }, tx);
  }, TX);

  const o = j.order;
  await notifyUserId(o.buyerId, "delivery.failed", {
    ar: `سبيل: تعذّر توصيل طلبك ${o.orderNo} في هذه المحاولة. سيتواصل المورّد لإعادة الجدولة، ويمكنك إلغاء الطلب.`,
    en: `Sabeel: delivery of order ${o.orderNo} did not succeed this time. The supplier will reschedule, or you can cancel.`,
  }, { orderId: o.id });
  const owners = await db.supplierMember.findMany({ where: { supplierId: o.supplierId, role: "OWNER" }, select: { userId: true } });
  for (const ow of owners) {
    await notifyUserId(ow.userId, "delivery.failed", {
      ar: `سبيل: فشلت محاولة توصيل الطلب ${o.orderNo}. افتح الطلب لإعادة الجدولة.`,
      en: `Sabeel: a delivery attempt for order ${o.orderNo} failed. Open the order to reschedule.`,
    }, { orderId: o.id });
  }
  return { replay: false as const };
}
