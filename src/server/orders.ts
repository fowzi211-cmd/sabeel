import { z } from "zod";
import { Prisma, type OrderStatus, type Role, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { feeHalalas, supplierKeeps, vatIncluded } from "@/lib/money";
import { canStillReview } from "@/lib/reviews";
import { checkRateLimit } from "@/lib/rateLimit";
import { capForPaidCount, tierFor } from "@/lib/trust";
import { currentFeePerPacket } from "./catalogue";
import { generateSlots } from "./delivery";
import { ACCEPT_SLA_HOURS } from "@/lib/fulfilment";
import { suppliersWithExpiredDocs } from "./compliance";
import { notifySupplier, notifyUserId } from "./notify";
import { notifyOwner } from "./suppliers";
import { hasAcceptedCurrent } from "./terms";

export { ACCEPT_SLA_HOURS };

/**
 * Cancellation is free until the goods are on the road (design pack T19). An escalated order (no supplier
 * found) or a failed delivery can also be cancelled by the buyer.
 */
export const CANCELLABLE: OrderStatus[] = ["DRAFT", "AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED", "ESCALATED", "FAILED_ATTEMPT"];
/** Statuses that no longer count against the buyer's spending limit. */
const CLOSED_FOR_EXPOSURE: OrderStatus[] = ["DRAFT", "CANCELLED", "DECLINED", "EXPIRED", "PAID", "CLOSED"];
/** Recipient name/mobile and the exact pin are shown to the supplier only once it has accepted (R12). */
const RECIPIENT_REVEALED: OrderStatus[] = [
  "ACCEPTED", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED_DRIVER_CONFIRMED", "ADMIN_REVIEW",
  "CONFIRMED_BY_BOTH", "PAID", "DISPUTED", "FAILED_ATTEMPT", "CLOSED",
];

export const placeSchema = z.object({
  siteId: z.string().min(1),
  type: z.enum(["DONATION", "SELF_USE"]),
  anonymous: z.boolean().default(false),
  windowStart: z.coerce.date(),
  lines: z.array(z.object({ offerId: z.string().min(1), qtyPacks: z.number().int().min(1).max(500) })).min(1).max(5),
  note: z.string().trim().max(300).optional(),
});
export type PlaceInput = z.infer<typeof placeSchema>;

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full.trim();

export const orderInclude = {
  items: true,
  events: { orderBy: { createdAt: "asc" as const } },
  supplier: {
    select: {
      id: true, type: true, legalNameAr: true, legalNameEn: true, tradeName: true,
      bankAccounts: { where: { status: "ACTIVE" }, take: 1 },
    },
  },
  buyer: { select: { id: true, name: true } },
  allocations: {
    orderBy: { seq: "asc" as const },
    include: { supplier: { select: { id: true, legalNameAr: true, legalNameEn: true, tradeName: true } } },
  },
  delivery: {
    include: {
      driver: { include: { user: { select: { id: true, name: true, mobile: true } } } },
      photos: { orderBy: { capturedAt: "asc" as const } },
      // Usually one row; a REDELIVER dispute outcome can add a second. Latest attempt first.
      proofs: { orderBy: { attempt: "desc" as const } },
      attemptLog: { orderBy: { n: "asc" as const } },
    },
  },
  payment: true,
  disputes: { orderBy: { createdAt: "desc" as const } },
  review: { include: { reply: true } },
} satisfies Prisma.OrderInclude;
export type OrderFull = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

async function nextOrderNo(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('sabeel_order_no_seq') AS n`;
  return `SBL-${new Date().getUTCFullYear()}-${String(rows[0].n).padStart(6, "0")}`;
}

// ───────────────────────── place ─────────────────────────
export async function placeOrder(user: User, input: PlaceInput, meta: RequestMeta, idempotencyKey?: string | null, now: Date = new Date()) {
  checkRateLimit(`order.place:${user.id}`, 30, 10 * 60_000);
  if (!user.name?.trim()) throw new AppError("PROFILE_INCOMPLETE");
  if (user.restrictedUntil && user.restrictedUntil > now) throw new AppError("ACCOUNT_RESTRICTED");
  if (await db.paymentRecord.findFirst({ where: { status: "OVERDUE", order: { buyerId: user.id } } })) throw new AppError("PAYMENT_OVERDUE");
  const terms = await hasAcceptedCurrent({ userId: user.id, supplierId: null, type: "BUYER_TERMS" });
  if (terms.doc && !terms.accepted) throw new AppError("TERMS_REQUIRED");

  // A retried request (double tap, flaky network) returns the same order instead of creating a second one.
  if (idempotencyKey) {
    const existing = await db.order.findUnique({ where: { buyerId_idempotencyKey: { buyerId: user.id, idempotencyKey } }, include: orderInclude });
    if (existing) return { order: existing, replay: true };
  }

  const site = await db.site.findFirst({ where: { id: input.siteId, userId: user.id, deletedAt: null }, include: { district: true } });
  if (!site) throw new AppError("NOT_FOUND", { field: "siteId" });
  const district = site.district;
  if (!district.active || district.restricted) throw new AppError("RESTRICTED_ZONE", { field: "siteId" });

  let recipientName = site.recipientName;
  let recipientMobile = site.recipientMobile;
  if (input.type === "DONATION") {
    if (!recipientName || !recipientMobile) {
      throw new AppError("VALIDATION", { field: "recipient", message: "A donation needs the on-site recipient's name and mobile" });
    }
  } else {
    recipientName = recipientName ?? user.name;
    recipientMobile = recipientMobile ?? user.mobile; // the buyer is the recipient
  }

  // Merge duplicate lines, then load every offer with what we must re-check.
  const qtyByOffer = new Map<string, number>();
  for (const l of input.lines) qtyByOffer.set(l.offerId, (qtyByOffer.get(l.offerId) ?? 0) + l.qtyPacks);
  const offers = await db.offer.findMany({
    where: { id: { in: [...qtyByOffer.keys()] } },
    include: { brand: true, supplier: { include: { zones: { where: { districtId: district.id } } } } },
  });
  if (offers.length !== qtyByOffer.size) throw new AppError("OFFER_UNAVAILABLE");

  const supplier = offers[0].supplier;
  if (offers.some((o) => o.supplierId !== supplier.id)) {
    throw new AppError("VALIDATION", { field: "lines", message: "One order can contain products from a single supplier" });
  }
  if (supplier.status !== "ACTIVE") throw new AppError("OFFER_UNAVAILABLE");
  if ((await suppliersWithExpiredDocs([supplier.id], now)).size > 0) throw new AppError("OFFER_UNAVAILABLE");
  const zone = supplier.zones.find((z) => z.active);
  if (!zone) throw new AppError("NOT_SERVED");

  let goods = 0;
  let eqTotal = 0;
  const items: Prisma.OrderItemCreateWithoutOrderInput[] = [];
  for (const o of offers) {
    const qty = qtyByOffer.get(o.id)!;
    const live =
      o.active && o.stock !== "OUT" && o.brand.status === "ACTIVE" && qty >= o.minQtyPacks &&
      (!o.validFrom || o.validFrom <= now) && (!o.validTo || o.validTo > now);
    if (!live) throw new AppError("OFFER_UNAVAILABLE");
    const line = o.priceHalalas * qty;
    goods += line;
    eqTotal += o.packetEqMilli * qty;
    items.push({
      offerId: o.id, brandId: o.brandId, brandNameAr: o.brand.nameAr, brandNameEn: o.brand.nameEn,
      bottleMl: o.bottleMl, bottlesPerPack: o.bottlesPerPack, packetEqMilli: o.packetEqMilli,
      unitPriceHalalas: o.priceHalalas, qtyPacks: qty, lineTotalHalalas: line,
    });
  }
  const delivery = zone.deliveryFeeHalalas;
  const total = goods + delivery;

  // The window must be one of the slots this supplier can really offer for this district right now.
  const slots = generateSlots({ now, rules: district, leadHours: zone.leadTimeHours });
  const slot = slots.find((s) => s.start.getTime() === input.windowStart.getTime());
  if (!slot) throw new AppError("SLOT_INVALID");

  // Buyer limit: the supplier delivers before being paid, so total spend in flight is capped by trust tier.
  const cap = capForPaidCount(user.paidOrdersCount);
  const feeRate = await currentFeePerPacket(now);

  try {
    const order = await db.$transaction(async (tx) => {
      // Serialise this buyer's orders so two simultaneous requests cannot both slip under the limit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
      const open = await tx.order.aggregate({ where: { buyerId: user.id, status: { notIn: CLOSED_FOR_EXPOSURE } }, _sum: { totalHalalas: true } });
      const exposure = open._sum.totalHalalas ?? 0;
      if (total > cap || exposure + total > cap) {
        throw new AppError("ORDER_LIMIT", { details: { capHalalas: cap, exposureHalalas: exposure, totalHalalas: total } });
      }
      const orderNo = await nextOrderNo(tx);
      const created = await tx.order.create({
        data: {
          orderNo, buyerId: user.id, supplierId: supplier.id, type: input.type, status: "AWAITING_SUPPLIER",
          anonymous: input.anonymous, buyerFirstName: firstName(user.name!), buyerTier: tierFor(user.paidOrdersCount),
          siteId: site.id, districtId: district.id, lat: site.lat, lng: site.lng,
          nationalAddress: site.nationalAddress, landmark: site.landmark, accessNotes: site.accessNotes,
          recipientName, recipientMobile,
          windowStart: slot.start, windowEnd: slot.end, acceptBy: new Date(now.getTime() + ACCEPT_SLA_HOURS * 3_600_000),
          goodsHalalas: goods, deliveryHalalas: delivery, totalHalalas: total, vatHalalas: vatIncluded(total),
          feePerPacketHalalas: feeRate, packetEqMilliTotal: eqTotal,
          note: input.note, idempotencyKey: idempotencyKey ?? null,
          items: { create: items },
          events: { create: { type: "PLACED", actorId: user.id } },
          allocations: { create: { supplierId: supplier.id, seq: 1, totalHalalas: total, acceptBy: new Date(now.getTime() + ACCEPT_SLA_HOURS * 3_600_000) } },
        },
        include: orderInclude,
      });
      await audit({ actor: { id: user.id, roles: user.roles }, action: "order.placed", entity: "Order", entityId: created.id, after: { orderNo, total, supplierId: supplier.id, type: input.type }, meta }, tx);
      return created;
    });

    // Tell the supplier. Never fail the order because a notification failed.
    await notifyOwner(
      supplier.id, "order.placed",
      `سبيل: طلب جديد ${order.orderNo}. افتح بوابة المورّد للاطلاع والقبول.`,
      { orderId: order.id, orderNo: order.orderNo },
    ).catch((e) => console.error("[order] notify failed", e));

    return { order, replay: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && idempotencyKey) {
      const existing = await db.order.findUnique({ where: { buyerId_idempotencyKey: { buyerId: user.id, idempotencyKey } }, include: orderInclude });
      if (existing) return { order: existing, replay: true }; // lost a race with our own retry
    }
    throw e;
  }
}

// ───────────────────────── cancel ─────────────────────────
export async function cancelOrder(user: User, id: string, reason: string | undefined, meta: RequestMeta) {
  const order = await db.order.findFirst({ where: { id, buyerId: user.id } });
  if (!order) throw new AppError("NOT_FOUND");
  if (!CANCELLABLE.includes(order.status)) throw new AppError("NOT_EDITABLE");

  // Conditional update: two racing cancels (or a supplier action) cannot both win.
  const changed = await db.order.updateMany({
    where: { id, status: { in: CANCELLABLE } },
    data: { status: "CANCELLED", cancelReason: reason?.trim() || null, cancelledAt: new Date() },
  });
  if (changed.count === 0) throw new AppError("NOT_EDITABLE");
  await db.orderAllocation.updateMany({ where: { orderId: id, status: { in: ["OFFERED", "ACCEPTED"] } }, data: { status: "WITHDRAWN", respondedAt: new Date() } });
  await db.orderEvent.create({ data: { orderId: id, type: "CANCELLED", actorId: user.id, note: reason?.trim() || null } });
  await audit({ actor: { id: user.id, roles: user.roles as Role[] }, action: "order.cancelled", entity: "Order", entityId: id, before: { status: order.status }, after: { status: "CANCELLED" }, note: reason, meta });
  await notifyCancelled(order, "buyer");
}

/** Tell the supplier — and the driver, if one was already assigned — that the order is off. */
export async function notifyCancelled(order: { id: string; orderNo: string; supplierId: string }, by: "buyer" | "admin" | "supplier") {
  const who = { ar: by === "buyer" ? "المشتري" : by === "admin" ? "إدارة سبيل" : "المورّد", en: by === "buyer" ? "the buyer" : by === "admin" ? "Sabeel" : "the supplier" };
  if (by !== "supplier") {
    await notifySupplier(order.supplierId, "order.cancelled", { ar: `سبيل: أُلغي الطلب ${order.orderNo} من قبل ${who.ar}.`, en: `Sabeel: order ${order.orderNo} was cancelled by ${who.en}.` }, { orderId: order.id, orderNo: order.orderNo });
  }
  const delivery = await db.delivery.findUnique({ where: { orderId: order.id }, include: { driver: { select: { userId: true } } } });
  if (delivery) {
    await notifyUserId(delivery.driver.userId, "delivery.cancelled", { ar: `سبيل: أُلغي الطلب ${order.orderNo}. لا داعي للتوصيل.`, en: `Sabeel: order ${order.orderNo} was cancelled. No delivery needed.` }, { orderId: order.id });
  }
}

// ───────────────────────── views ─────────────────────────
const supplierDisplay = (s: OrderFull["supplier"]) => ({
  id: s.id,
  nameAr: s.tradeName || s.legalNameAr,
  nameEn: s.legalNameEn || s.tradeName || s.legalNameAr,
  independent: s.type === "INDEPENDENT",
});

const itemView = (i: OrderFull["items"][number]) => ({
  id: i.id, brandNameAr: i.brandNameAr, brandNameEn: i.brandNameEn, bottleMl: i.bottleMl, bottlesPerPack: i.bottlesPerPack,
  unitPriceHalalas: i.unitPriceHalalas, qtyPacks: i.qtyPacks, lineTotalHalalas: i.lineTotalHalalas,
  deliveredQtyPacks: i.deliveredQtyPacks,
});

const moneyView = (o: OrderFull) => ({
  goodsHalalas: o.goodsHalalas, deliveryHalalas: o.deliveryHalalas, totalHalalas: o.totalHalalas, vatHalalas: o.vatHalalas,
});

/** Timeline entries the buyer must not see (internal reviews). */
const INTERNAL_EVENTS = new Set(["PROOF_REVIEWED", "ADMIN_NOTE"]);

const photoUrl = (id: string) => `/api/v1/proof-photos/${id}`;
const receiptUrl = (orderId: string) => `/api/v1/orders/${orderId}/payment/receipt`;
const reviewPhotoUrl = (orderId: string) => `/api/v1/orders/${orderId}/review/photo`;
const REVIEWABLE_STATUSES: OrderStatus[] = ["CONFIRMED_BY_BOTH", "PAID", "CLOSED"];

/** The buyer's own review of this order, if any — the supplier's reply is public once it exists. */
function reviewView(o: OrderFull) {
  const r = o.review;
  if (!r) return null;
  return {
    stars: r.stars, timeliness: r.timeliness, asOrdered: r.asOrdered, packaging: r.packaging, driverConduct: r.driverConduct, value: r.value,
    comment: r.comment, createdAt: r.createdAt, photoUrl: r.photoFileKey ? reviewPhotoUrl(o.id) : null,
    removed: !!r.removedAt, reply: r.reply ? { text: r.reply.text, createdAt: r.reply.createdAt } : null,
  };
}

/** Bank details are shown to the buyer only once payment has actually unlocked — never before, never after it is written off. */
const PAYMENT_UNLOCKED: string[] = ["DUE", "OVERDUE", "BUYER_MARKED_PAID", "RECEIVED", "DISPUTED"];

const bankView = (s: OrderFull["supplier"]) => {
  const b = s.bankAccounts[0];
  return b ? { iban: b.iban, holderName: b.holderName, bankName: b.bankName } : null;
};

/** What the amount actually due is: a dispute may have lowered it before payment became due. */
const amountOwed = (o: OrderFull) => o.adjustedTotalHalalas ?? o.totalHalalas;

function paymentView(o: OrderFull, opts: { withBank: boolean }) {
  const p = o.payment;
  if (!p || !PAYMENT_UNLOCKED.includes(p.status)) return null;
  return {
    status: p.status, transactionNo: p.transactionNo, amountHalalas: p.amountHalalas, dueAt: p.dueAt,
    paymentDate: p.paymentDate, bankReference: p.bankReference, hasReceipt: !!p.receiptFileKey,
    receiptUrl: p.receiptFileKey ? receiptUrl(o.id) : null,
    markedPaidAt: p.markedPaidAt, receivedAt: p.receivedAt, notReceivedNote: p.notReceivedNote, notReceivedAt: p.notReceivedAt,
    bank: opts.withBank ? bankView(o.supplier) : null,
  };
}

const disputeView = (d: OrderFull["disputes"][number]) => ({
  id: d.id, category: d.category, openedBy: d.openedBy, status: d.status, note: d.note,
  outcome: d.outcome, resolutionNote: d.resolutionNote, resolvedAt: d.resolvedAt, createdAt: d.createdAt,
});

/** What proof looks like to the buyer: the Delivery Report (design pack S08), without reviewer internals. */
function reportView(o: OrderFull) {
  const d = o.delivery;
  const p = d?.proofs[0]; // proofs are ordered latest-attempt-first — that is the one that matters now
  if (!d || !p) return null;
  return {
    deliveredAt: d.deliveredAt,
    partial: p.partial,
    items: o.items.map((i) => ({ id: i.id, brandNameAr: i.brandNameAr, brandNameEn: i.brandNameEn, bottleMl: i.bottleMl, bottlesPerPack: i.bottlesPerPack, orderedQtyPacks: i.qtyPacks, deliveredQtyPacks: i.deliveredQtyPacks ?? 0 })),
    deliveredGoodsHalalas: p.deliveredGoodsHalalas, deliveredTotalHalalas: p.deliveredTotalHalalas, deliveredVatHalalas: p.deliveredVatHalalas,
    atLocation: p.radiusOk, recipientCodeVerified: p.recipientOtpOk, brandPhotoOk: p.brandPhotoOk, batchNote: p.batchNote,
    // Only this attempt's photos — an earlier, superseded attempt's photos would only confuse the buyer.
    photos: d.photos.filter((x) => x.kind !== "FAILURE" && x.attempt === p.attempt).map((x) => ({ id: x.id, kind: x.kind, capturedAt: x.capturedAt, url: photoUrl(x.id) })),
  };
}

/** What the buyer sees: everything about their own order — never any bank details until payment unlocks (slice 4). */
export function buyerOrderView(o: OrderFull, now: Date = new Date()) {
  const d = o.delivery;
  const showDriver = !!d && o.status !== "CANCELLED" && o.status !== "AWAITING_SUPPLIER" && o.status !== "ESCALATED";
  return {
    id: o.id, orderNo: o.orderNo, type: o.type, status: o.status, anonymous: o.anonymous,
    supplier: supplierDisplay(o.supplier),
    items: o.items.map(itemView), ...moneyView(o),
    window: { start: o.windowStart, end: o.windowEnd },
    destination: {
      districtId: o.districtId, lat: o.lat, lng: o.lng, nationalAddress: o.nationalAddress, landmark: o.landmark,
      accessNotes: o.accessNotes, recipientName: o.recipientName, recipientMobile: o.recipientMobile,
    },
    note: o.note, cancelReason: o.cancelReason, placedAt: o.placedAt, acceptBy: o.acceptBy,
    cancellable: CANCELLABLE.includes(o.status),
    // Driver: first name and plate only. The driver's mobile stays private; the recipient is reached by the driver.
    driver: showDriver && d ? { firstName: firstName(d.driver.user.name ?? ""), vehiclePlate: d.driver.vehiclePlate } : null,
    delivery: d ? { status: d.status, attempts: d.attempts, startedAt: d.startedAt, arrivedAt: d.arrivedAt, deliveredAt: d.deliveredAt } : null,
    report: reportView(o),
    confirmedAt: o.confirmedAt, confirmMethod: o.confirmMethod,
    confirmable: ["DELIVERED_DRIVER_CONFIRMED", "ADMIN_REVIEW"].includes(o.status),
    amountOwed: amountOwed(o),
    payment: paymentView(o, { withBank: true }),
    disputes: o.disputes.map(disputeView),
    events: o.events.filter((e) => !INTERNAL_EVENTS.has(e.type)).map((e) => ({ type: e.type, at: e.createdAt, note: e.note })),
    review: reviewView(o),
    reviewable: !o.review && !!o.confirmedAt && REVIEWABLE_STATUSES.includes(o.status) && canStillReview(o.confirmedAt, now),
  };
}

const proofAdminView = (o: OrderFull) => {
  const d = o.delivery;
  const p = d?.proofs[0]; // latest attempt — the one that matters now
  if (!d || !p) return null;
  return {
    attempt: p.attempt, lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, distanceM: p.distanceM, radiusM: p.radiusM, radiusOk: p.radiusOk,
    outsideReason: p.outsideReason, brandPhotoOk: p.brandPhotoOk, recipientOtpOk: p.recipientOtpOk, otpBypassReason: p.otpBypassReason,
    batchNote: p.batchNote, notes: p.notes, partial: p.partial, submittedOffline: p.submittedOffline, submittedAt: p.submittedAt, confirmedAtDevice: p.confirmedAtDevice,
    deliveredGoodsHalalas: p.deliveredGoodsHalalas, deliveredTotalHalalas: p.deliveredTotalHalalas, deliveredFeeHalalas: p.deliveredFeeHalalas,
    flags: p.flags, reviewRequired: p.reviewRequired, reviewReasons: p.reviewReasons,
    reviewedAt: p.reviewedAt, reviewOutcome: p.reviewOutcome, reviewNote: p.reviewNote,
    // Every attempt's photos, so admin can see what happened each time (e.g. before and after a redelivery).
    photos: d.photos.map((x) => ({ id: x.id, kind: x.kind, attempt: x.attempt, capturedAt: x.capturedAt, source: x.source, flags: x.flags, lat: x.lat, lng: x.lng, url: photoUrl(x.id) })),
    // Earlier attempts' proof, kept for the record (a REDELIVER dispute outcome is the only way this is ever more than one).
    priorAttempts: d.proofs.slice(1).map((x) => ({ attempt: x.attempt, submittedAt: x.submittedAt, partial: x.partial, flags: x.flags, reviewOutcome: x.reviewOutcome })),
  };
};

const attemptsView = (o: OrderFull) =>
  (o.delivery?.attemptLog ?? []).map((a) => ({ n: a.n, startedAt: a.startedAt, arrivedAt: a.arrivedAt, endedAt: a.endedAt, outcome: a.outcome, failReason: a.failReason, failNote: a.failNote }));

/**
 * What a supplier sees. Donor: first name only (or "anonymous"), never the mobile or full name.
 * Recipient name/mobile and the exact pin stay hidden until the supplier accepts (design pack R12).
 * The fee and net-after-fee are shown up front (FR-FEE-06).
 */
export function supplierOrderView(o: OrderFull) {
  const reveal = RECIPIENT_REVEALED.includes(o.status);
  const fee = feeHalalas(o.packetEqMilliTotal, 1, o.feePerPacketHalalas);
  const d = o.delivery;
  const proof = proofAdminView(o);
  return {
    id: o.id, orderNo: o.orderNo, type: o.type, status: o.status,
    donor: o.type === "DONATION" ? (o.anonymous ? null : o.buyerFirstName) : o.buyerFirstName,
    anonymous: o.type === "DONATION" && o.anonymous,
    buyerTier: o.buyerTier,
    items: o.items.map(itemView), ...moneyView(o),
    window: { start: o.windowStart, end: o.windowEnd },
    districtId: o.districtId,
    destination: reveal
      ? { lat: o.lat, lng: o.lng, nationalAddress: o.nationalAddress, landmark: o.landmark, accessNotes: o.accessNotes, recipientName: o.recipientName, recipientMobile: o.recipientMobile }
      : null,
    note: o.note, placedAt: o.placedAt, acceptBy: o.acceptBy, cancelReason: o.cancelReason,
    feePreview: { feePerPacketHalalas: o.feePerPacketHalalas, ...supplierKeeps(o.totalHalalas, fee) },
    delivery: d ? { status: d.status, attempts: d.attempts, startedAt: d.startedAt, arrivedAt: d.arrivedAt, deliveredAt: d.deliveredAt, driver: { id: d.driverId, name: d.driver.user.name, mobile: d.driver.user.mobile, vehiclePlate: d.driver.vehiclePlate } } : null,
    attempts: attemptsView(o),
    // Reviewer internals (who reviewed, outcome) are useful to the supplier too: it explains a held payment later.
    proof,
    allocationCount: o.allocations.length,
    confirmedAt: o.confirmedAt,
    amountOwed: amountOwed(o),
    payment: paymentView(o, { withBank: false }),
    disputes: o.disputes.map(disputeView),
  };
}

export const listBuyerOrders = (userId: string) =>
  db.order.findMany({ where: { buyerId: userId }, include: orderInclude, orderBy: { placedAt: "desc" }, take: 100 });

export const getBuyerOrder = (userId: string, id: string) =>
  db.order.findFirst({ where: { buyerId: userId, OR: [{ id }, { orderNo: id }] }, include: orderInclude });

export const listSupplierOrders = (supplierId: string, status?: OrderStatus) =>
  db.order.findMany({ where: { supplierId, ...(status ? { status } : {}) }, include: orderInclude, orderBy: { placedAt: "desc" }, take: 100 });

export const getSupplierOrder = (supplierId: string, id: string) =>
  db.order.findFirst({ where: { supplierId, OR: [{ id }, { orderNo: id }] }, include: orderInclude });

export type AdminOrderFilter = { status?: OrderStatus; attention?: boolean };

/**
 * Orders that need a human: nobody took them, a delivery failed, the promised window has passed
 * unserved, the buyer went silent (admin review), a dispute is open, or a payment is overdue or disputed.
 */
export function attentionWhere(now: Date = new Date()): Prisma.OrderWhereInput {
  return {
    OR: [
      { status: { in: ["ESCALATED", "FAILED_ATTEMPT", "ADMIN_REVIEW", "DISPUTED"] } },
      { status: { in: ["AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED"] }, windowEnd: { lt: now } },
      { status: { in: ["OUT_FOR_DELIVERY"] }, windowEnd: { lt: new Date(now.getTime() - 3 * 3_600_000) } },
      { delivery: { proofs: { some: { reviewRequired: true, reviewedAt: null } } } },
      { payment: { status: { in: ["OVERDUE", "DISPUTED"] } } },
    ],
  };
}

export const listAllOrders = (filter: AdminOrderFilter = {}) =>
  db.order.findMany({
    where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.attention ? attentionWhere() : {}) },
    include: orderInclude, orderBy: { placedAt: "desc" }, take: 200,
  });

export const getAnyOrder = (id: string) => db.order.findFirst({ where: { OR: [{ id }, { orderNo: id }] }, include: orderInclude });

/** Staff see everything, including the buyer's real name — needed for support and disputes. */
export function adminOrderView(o: OrderFull) {
  return {
    ...buyerOrderView(o),
    buyer: { id: o.buyer.id, name: o.buyer.name },
    buyerTier: o.buyerTier, feePerPacketHalalas: o.feePerPacketHalalas, packetEqMilliTotal: o.packetEqMilliTotal,
    events: o.events.map((e) => ({ type: e.type, at: e.createdAt, note: e.note })),
    driver: o.delivery ? { name: o.delivery.driver.user.name, mobile: o.delivery.driver.user.mobile, vehiclePlate: o.delivery.driver.vehiclePlate } : null,
    attempts: attemptsView(o),
    proof: proofAdminView(o),
    allocations: o.allocations.map((a) => ({
      seq: a.seq, status: a.status, supplierId: a.supplierId, supplierName: a.supplier.tradeName || a.supplier.legalNameAr,
      totalHalalas: a.totalHalalas, offeredAt: a.offeredAt, respondedAt: a.respondedAt, declineReason: a.declineReason, declineNote: a.declineNote,
    })),
    // Admin sees the full payment record (even VOID) and every dispute with who opened/resolved it — needed to act.
    payment: o.payment ? { ...o.payment, bank: bankView(o.supplier), receiptUrl: o.payment.receiptFileKey ? receiptUrl(o.id) : null } : null,
    disputes: o.disputes.map((d) => ({ ...d })),
  };
}


