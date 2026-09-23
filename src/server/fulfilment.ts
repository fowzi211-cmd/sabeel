import { z } from "zod";
import { Prisma, type OrderStatus, type Role, type Supplier } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { ACCEPT_SLA_HOURS, DECLINE_REASONS, MAX_DELIVERY_ATTEMPTS } from "@/lib/fulfilment";
import { vatIncluded } from "@/lib/money";
import { generateSlots } from "./delivery";
import { notifyCancelled } from "./orders";
import { notifySupplier, notifyUserId } from "./notify";
import { rankScores } from "./ranking";
import { suppliersWithExpiredDocs } from "./compliance";
import { hasAcceptedCurrent } from "./terms";

type Actor = { id: string; roles: Role[] };
type Client = Prisma.TransactionClient | typeof db;

const TX = { timeout: 20_000, maxWait: 10_000 };
const lock = (tx: Prisma.TransactionClient, orderId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"order:" + orderId}))`;

/** The supplier account this signed-in owner runs. */
export async function ownedSupplier(userId: string): Promise<Supplier> {
  const supplier = await db.supplier.findFirst({ where: { members: { some: { userId, role: "OWNER" } } } });
  if (!supplier) throw new AppError("NOT_FOUND");
  return supplier;
}

// ───────────────────────── may this supplier take orders right now? (T02 guard) ─────────────────────────

const agreementTypeFor = (s: Pick<Supplier, "type">): "INDEPENDENT_AGREEMENT" | "SUPPLIER_AGREEMENT" => (s.type === "INDEPENDENT" ? "INDEPENDENT_AGREEMENT" : "SUPPLIER_AGREEMENT");

export async function assertSupplierCanServe(supplier: Pick<Supplier, "id" | "type" | "status">, now: Date = new Date()) {
  if (supplier.status !== "ACTIVE") throw new AppError("SUPPLIER_NOT_ACTIVE");
  const terms = await hasAcceptedCurrent({ userId: "", supplierId: supplier.id, type: agreementTypeFor(supplier) });
  if (terms.doc && !terms.accepted) throw new AppError("AGREEMENT_REQUIRED");
  if ((await suppliersWithExpiredDocs([supplier.id], now)).size > 0) throw new AppError("DOCS_EXPIRED");
}

// ───────────────────────── finding the next supplier (design pack R10) ─────────────────────────

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true; delivery: true } }>;

export interface Candidate {
  supplierId: string;
  supplierName: string;
  goodsHalalas: number;
  deliveryHalalas: number;
  totalHalalas: number;
  leadHours: number;
  score: number;
  lines: { itemId: string; offerId: string; unitPriceHalalas: number; packetEqMilli: number; lineTotalHalalas: number }[];
}

/**
 * Suppliers that can take over the order on the same terms: they serve the destination, are active with a
 * valid agreement and documents, stock exactly the same products, can still meet the buyer's chosen window,
 * and cost the buyer the same or less. Best-ranked first.
 */
export async function findCandidates(client: Client, order: OrderWithItems, excludeSupplierIds: string[], now: Date): Promise<Candidate[]> {
  const district = await client.district.findUnique({ where: { id: order.districtId } });
  if (!district || !district.active || district.restricted) return [];
  // The ceiling is what the buyer originally agreed to pay (first offer), not the total of an intermediate supplier.
  const first = await client.orderAllocation.findFirst({ where: { orderId: order.id }, orderBy: { seq: "asc" }, select: { totalHalalas: true } });
  const ceiling = Math.max(order.totalHalalas, first?.totalHalalas ?? 0);

  const offers = await client.offer.findMany({
    where: {
      supplierId: { notIn: excludeSupplierIds },
      active: true,
      stock: { not: "OUT" },
      brand: { status: "ACTIVE" },
      supplier: { status: "ACTIVE", zones: { some: { districtId: order.districtId, active: true } } },
      AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: now } }] }, { OR: [{ validTo: null }, { validTo: { gt: now } }] }],
      OR: order.items.map((i) => ({ brandId: i.brandId, bottleMl: i.bottleMl, bottlesPerPack: i.bottlesPerPack, minQtyPacks: { lte: i.qtyPacks } })),
    },
    include: { supplier: { select: { id: true, type: true, status: true, legalNameAr: true, tradeName: true, zones: { where: { districtId: order.districtId, active: true } } } } },
    take: 400,
  });

  const bySupplier = new Map<string, typeof offers>();
  for (const o of offers) bySupplier.set(o.supplierId, [...(bySupplier.get(o.supplierId) ?? []), o]);
  const expired = await suppliersWithExpiredDocs([...bySupplier.keys()], now);

  const out: Candidate[] = [];
  for (const [supplierId, list] of bySupplier) {
    const zone = list[0].supplier.zones[0];
    if (!zone || expired.has(supplierId)) continue;

    const lines: Candidate["lines"] = [];
    let complete = true;
    for (const item of order.items) {
      const match = list.find((o) => o.brandId === item.brandId && o.bottleMl === item.bottleMl && o.bottlesPerPack === item.bottlesPerPack);
      if (!match) { complete = false; break; }
      lines.push({ itemId: item.id, offerId: match.id, unitPriceHalalas: match.priceHalalas, packetEqMilli: match.packetEqMilli, lineTotalHalalas: match.priceHalalas * item.qtyPacks });
    }
    if (!complete) continue;

    const goods = lines.reduce((s, l) => s + l.lineTotalHalalas, 0);
    const total = goods + zone.deliveryFeeHalalas;
    if (total > ceiling) continue; // never charge the buyer more than they originally agreed to

    const slots = generateSlots({ now, rules: district, leadHours: zone.leadTimeHours });
    if (!slots.some((s) => s.start.getTime() === order.windowStart.getTime())) continue; // cannot meet the chosen window

    const terms = await hasAcceptedCurrent({ userId: "", supplierId, type: agreementTypeFor(list[0].supplier) });
    if (terms.doc && !terms.accepted) continue;

    out.push({
      supplierId, supplierName: list[0].supplier.tradeName || list[0].supplier.legalNameAr,
      goodsHalalas: goods, deliveryHalalas: zone.deliveryFeeHalalas, totalHalalas: total, leadHours: zone.leadTimeHours, score: 0, lines,
    });
  }

  const scores = rankScores(out.map((c) => ({ totalHalalas: c.totalHalalas, leadHours: c.leadHours, rating: null, onTimePct: null })));
  out.forEach((c, i) => (c.score = scores[i]));
  return out.sort((a, b) => b.score - a.score || a.totalHalalas - b.totalHalalas);
}

/** Rewrites the order's supplier and price snapshots for the new supplier, keeping the audit trail of what it was. */
async function applyCandidate(tx: Prisma.TransactionClient, order: OrderWithItems, c: Candidate, actor: Actor | null, now: Date, meta?: RequestMeta) {
  const last = await tx.orderAllocation.findFirst({ where: { orderId: order.id }, orderBy: { seq: "desc" }, select: { seq: true } });
  for (const l of c.lines) {
    await tx.orderItem.update({ where: { id: l.itemId }, data: { offerId: l.offerId, unitPriceHalalas: l.unitPriceHalalas, packetEqMilli: l.packetEqMilli, lineTotalHalalas: l.lineTotalHalalas } });
  }
  const eq = order.items.reduce((s, i) => s + (c.lines.find((l) => l.itemId === i.id)!.packetEqMilli * i.qtyPacks), 0);
  const acceptBy = new Date(now.getTime() + ACCEPT_SLA_HOURS * 3_600_000);
  await tx.order.update({
    where: { id: order.id },
    data: {
      supplierId: c.supplierId, status: "AWAITING_SUPPLIER", acceptBy,
      goodsHalalas: c.goodsHalalas, deliveryHalalas: c.deliveryHalalas, totalHalalas: c.totalHalalas, vatHalalas: vatIncluded(c.totalHalalas), packetEqMilliTotal: eq,
    },
  });
  await tx.orderAllocation.create({ data: { orderId: order.id, supplierId: c.supplierId, seq: (last?.seq ?? 0) + 1, totalHalalas: c.totalHalalas, acceptBy } });
  await tx.orderEvent.create({ data: { orderId: order.id, type: "REALLOCATED", actorId: actor?.id ?? null } });
  await audit({
    actor, action: "order.reallocated", entity: "Order", entityId: order.id,
    before: { supplierId: order.supplierId, totalHalalas: order.totalHalalas }, after: { supplierId: c.supplierId, totalHalalas: c.totalHalalas }, meta,
  }, tx);
}

const orderPlaced = (orderNo: string) => ({
  ar: `سبيل: طلب جديد ${orderNo}. افتح بوابة المورّد للاطلاع والقبول.`,
  en: `Sabeel: new order ${orderNo}. Open the supplier portal to review and accept.`,
});

type MoveKind = "DECLINED" | "EXPIRED" | "WITHDRAWN";

/**
 * The supplier said no (or did not answer, or walked away): record it, then offer the order to the next
 * eligible supplier, or escalate to the admin queue — never stuck silently (FR-FUL-06).
 */
async function moveOn(input: { orderId: string; kind: MoveKind; supplierId: string; actor: Actor | null; reason?: string; note?: string; meta?: RequestMeta; now: Date }) {
  const { orderId, kind, supplierId, actor, now } = input;
  const result = await db.$transaction(async (tx) => {
    await lock(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true, delivery: true } });
    if (!order || order.supplierId !== supplierId) throw new AppError("INVALID_STATE");
    const from: OrderStatus[] = kind === "WITHDRAWN" ? ["ACCEPTED", "ASSIGNED"] : ["AWAITING_SUPPLIER"];
    if (!from.includes(order.status)) throw new AppError("INVALID_STATE");
    if (kind === "EXPIRED" && order.acceptBy > now) throw new AppError("INVALID_STATE");
    // Once a trip has been attempted the delivery history is evidence and cannot be discarded.
    if (order.delivery && order.delivery.attempts > 0) throw new AppError("INVALID_STATE");

    await tx.orderAllocation.updateMany({
      where: { orderId, supplierId, status: { in: ["OFFERED", "ACCEPTED"] } },
      data: { status: kind, respondedAt: now, respondedById: actor?.id ?? null, declineReason: input.reason ?? null, declineNote: input.note?.trim() || null },
    });
    await tx.orderEvent.create({ data: { orderId, type: kind, actorId: actor?.id ?? null } });

    // A driver assigned by the previous supplier belongs to that supplier, not to this order any more.
    let droppedDriverUserId: string | null = null;
    if (order.delivery) {
      const d = await tx.delivery.findUnique({ where: { id: order.delivery.id }, include: { driver: { select: { userId: true } } } });
      droppedDriverUserId = d?.driver.userId ?? null;
      await tx.delivery.delete({ where: { id: order.delivery.id } });
    }

    const allocations = await tx.orderAllocation.findMany({ where: { orderId }, select: { supplierId: true } });
    const [best] = await findCandidates(tx, order, allocations.map((a) => a.supplierId), now);
    if (best) {
      await applyCandidate(tx, order, best, actor, now, input.meta);
      return { outcome: "REALLOCATED" as const, order, to: best.supplierId, droppedDriverUserId };
    }
    await tx.order.update({ where: { id: orderId }, data: { status: "ESCALATED" } });
    await tx.orderEvent.create({ data: { orderId, type: "ESCALATED" } });
    await audit({ actor, action: `order.${kind.toLowerCase()}`, entity: "Order", entityId: orderId, before: { supplierId }, after: { status: "ESCALATED", reason: input.reason }, note: input.note, meta: input.meta }, tx);
    return { outcome: "ESCALATED" as const, order, to: null, droppedDriverUserId };
  }, TX);

  await audit({ actor, action: `order.${kind.toLowerCase()}`, entity: "Order", entityId: orderId, after: { supplierId, outcome: result.outcome, reason: input.reason ?? null }, note: input.note, meta: input.meta });

  const { order } = result;
  if (result.to) await notifySupplier(result.to, "order.placed", orderPlaced(order.orderNo), { orderId, orderNo: order.orderNo });
  await notifyUserId(order.buyerId, "order.reallocated", result.outcome === "REALLOCATED"
    ? { ar: `سبيل: تعذّر على المورّد تنفيذ طلبك ${order.orderNo}، فأرسلناه تلقائياً إلى مورّد آخر بسعر مماثل أو أقل.`, en: `Sabeel: the supplier could not take your order ${order.orderNo}, so we sent it to another supplier at the same price or less.` }
    : { ar: `سبيل: نبحث لك عن مورّد للطلب ${order.orderNo}. سنبقيك على اطّلاع، ويمكنك إلغاؤه في أي وقت.`, en: `Sabeel: we are finding a supplier for order ${order.orderNo}. We will keep you posted, and you can cancel at any time.` }, { orderId });
  if (kind === "EXPIRED") {
    await notifySupplier(supplierId, "order.expired", { ar: `سبيل: انتهت مهلة قبول الطلب ${order.orderNo} وأُرسل إلى مورّد آخر. الرد السريع يرفع تقييمك.`, en: `Sabeel: the time to accept order ${order.orderNo} ran out and it went to another supplier. Fast replies improve your standing.` }, { orderId }, { sms: false });
  }
  if (result.droppedDriverUserId) {
    await notifyUserId(result.droppedDriverUserId, "delivery.cancelled", { ar: `سبيل: أُلغي إسناد الطلب ${order.orderNo}. لا داعي للتوصيل.`, en: `Sabeel: order ${order.orderNo} was taken off you. No delivery needed.` }, { orderId });
  }
  return result.outcome;
}

// ───────────────────────── supplier: accept / decline / release ─────────────────────────

export async function acceptOrder(user: Actor, supplier: Supplier, orderId: string, meta: RequestMeta, now: Date = new Date()) {
  await assertSupplierCanServe(supplier, now);
  const order = await db.order.findFirst({ where: { id: orderId, supplierId: supplier.id } });
  if (!order) throw new AppError("NOT_FOUND");
  if (order.status !== "AWAITING_SUPPLIER") throw new AppError("INVALID_STATE");
  if (order.acceptBy <= now || order.windowEnd <= now) {
    await moveOn({ orderId, kind: "EXPIRED", supplierId: supplier.id, actor: null, now: new Date(Math.max(now.getTime(), order.acceptBy.getTime())), meta }).catch((e) => { if (!(e instanceof AppError)) throw e; });
    throw new AppError("OFFER_EXPIRED");
  }

  await db.$transaction(async (tx) => {
    await lock(tx, orderId);
    const changed = await tx.order.updateMany({ where: { id: orderId, supplierId: supplier.id, status: "AWAITING_SUPPLIER", acceptBy: { gt: now } }, data: { status: "ACCEPTED" } });
    if (changed.count === 0) throw new AppError("INVALID_STATE");
    await tx.orderAllocation.updateMany({ where: { orderId, supplierId: supplier.id, status: "OFFERED" }, data: { status: "ACCEPTED", respondedAt: now, respondedById: user.id } });
    await tx.orderEvent.create({ data: { orderId, type: "ACCEPTED", actorId: user.id } });
    await audit({ actor: user, action: "order.accepted", entity: "Order", entityId: orderId, before: { status: "AWAITING_SUPPLIER" }, after: { status: "ACCEPTED" }, meta }, tx);
  }, TX);

  await notifyUserId(order.buyerId, "order.accepted", {
    ar: `سبيل: قبل المورّد طلبك ${order.orderNo}. سنُعلمك عند إسناده لسائق.`,
    en: `Sabeel: the supplier accepted your order ${order.orderNo}. We will tell you when a driver is assigned.`,
  }, { orderId });
}

export const declineSchema = z.object({ reason: z.enum(DECLINE_REASONS), note: z.string().trim().max(300).optional() });

export async function declineOrder(user: Actor, supplier: Supplier, orderId: string, input: z.infer<typeof declineSchema>, meta: RequestMeta, now: Date = new Date()) {
  if (input.reason === "OTHER" && !input.note?.trim()) throw new AppError("VALIDATION", { field: "note" });
  const order = await db.order.findFirst({ where: { id: orderId, supplierId: supplier.id }, select: { id: true } });
  if (!order) throw new AppError("NOT_FOUND");
  return moveOn({ orderId, kind: "DECLINED", supplierId: supplier.id, actor: user, reason: input.reason, note: input.note, meta, now });
}

/** After accepting, a supplier that cannot deliver hands the order back so the buyer is not left waiting (T05). */
export async function releaseOrder(user: Actor, supplier: Supplier, orderId: string, input: z.infer<typeof declineSchema>, meta: RequestMeta, now: Date = new Date()) {
  if (input.reason === "OTHER" && !input.note?.trim()) throw new AppError("VALIDATION", { field: "note" });
  const order = await db.order.findFirst({ where: { id: orderId, supplierId: supplier.id }, select: { id: true } });
  if (!order) throw new AppError("NOT_FOUND");
  return moveOn({ orderId, kind: "WITHDRAWN", supplierId: supplier.id, actor: user, reason: input.reason, note: input.note, meta, now });
}

// ───────────────────────── supplier: drivers on orders ─────────────────────────

export const assignSchema = z.object({ driverId: z.string().min(1) });

export async function assignDriver(user: Actor, supplier: Supplier, orderId: string, driverId: string, meta: RequestMeta, now: Date = new Date()) {
  if (supplier.status !== "ACTIVE") throw new AppError("SUPPLIER_NOT_ACTIVE");
  const driver = await db.driver.findFirst({ where: { id: driverId, supplierId: supplier.id, active: true }, include: { user: { select: { id: true, name: true } } } });
  if (!driver) throw new AppError("DRIVER_INVALID");

  const result = await db.$transaction(async (tx) => {
    await lock(tx, orderId);
    const order = await tx.order.findFirst({ where: { id: orderId, supplierId: supplier.id }, include: { delivery: true } });
    if (!order) throw new AppError("NOT_FOUND");
    if (order.status !== "ACCEPTED" && order.status !== "ASSIGNED") throw new AppError("INVALID_STATE");
    if (order.delivery && order.delivery.status !== "ASSIGNED") throw new AppError("INVALID_STATE"); // trip already started

    const changedDriver = !!order.delivery && order.delivery.driverId !== driverId;
    if (order.delivery) {
      if (changedDriver) await tx.delivery.update({ where: { id: order.delivery.id }, data: { driverId, assignedAt: now } });
    } else {
      await tx.delivery.create({ data: { orderId, driverId, assignedAt: now } });
    }
    const first = order.status === "ACCEPTED";
    if (first) await tx.order.update({ where: { id: orderId }, data: { status: "ASSIGNED" } });
    if (first || changedDriver) await tx.orderEvent.create({ data: { orderId, type: first ? "ASSIGNED" : "DRIVER_CHANGED", actorId: user.id } });
    await audit({ actor: user, action: "order.driver_assigned", entity: "Order", entityId: orderId, before: { driverId: order.delivery?.driverId ?? null }, after: { driverId }, meta }, tx);
    return { order, changed: first || changedDriver, previousDriverId: order.delivery?.driverId ?? null };
  }, TX);

  if (result.changed) {
    const o = result.order;
    await notifyUserId(driver.userId, "delivery.assigned", {
      ar: `سبيل: أُسند إليك توصيل الطلب ${o.orderNo}. افتح تطبيق السائق.`,
      en: `Sabeel: you were assigned order ${o.orderNo}. Open the driver app.`,
    }, { orderId });
    await notifyUserId(o.buyerId, "order.assigned", {
      ar: `سبيل: أُسند طلبك ${o.orderNo} للسائق ${(driver.user.name ?? "").split(/\s+/)[0]}.`,
      en: `Sabeel: order ${o.orderNo} was assigned to driver ${(driver.user.name ?? "").split(/\s+/)[0]}.`,
    }, { orderId });
    if (result.previousDriverId) {
      const prev = await db.driver.findUnique({ where: { id: result.previousDriverId }, select: { userId: true } });
      if (prev) await notifyUserId(prev.userId, "delivery.cancelled", { ar: `سبيل: أُلغي إسناد الطلب ${o.orderNo} إليك.`, en: `Sabeel: order ${o.orderNo} was taken off you.` }, { orderId });
    }
  }
}

export const rescheduleSchema = z.object({ windowStart: z.coerce.date(), driverId: z.string().min(1).optional() });

/** After a failed trip the supplier picks a new window (and optionally another driver). Limited attempts (T11). */
export async function rescheduleOrder(user: Actor, supplier: Supplier, orderId: string, input: z.infer<typeof rescheduleSchema>, meta: RequestMeta, now: Date = new Date()) {
  if (supplier.status !== "ACTIVE") throw new AppError("SUPPLIER_NOT_ACTIVE");
  const result = await db.$transaction(async (tx) => {
    await lock(tx, orderId);
    const order = await tx.order.findFirst({ where: { id: orderId, supplierId: supplier.id }, include: { delivery: true } });
    if (!order) throw new AppError("NOT_FOUND");
    if (order.status !== "FAILED_ATTEMPT" || !order.delivery) throw new AppError("INVALID_STATE");
    if (order.delivery.attempts >= MAX_DELIVERY_ATTEMPTS) throw new AppError("MAX_ATTEMPTS");

    const zone = await tx.coverageZone.findFirst({ where: { supplierId: supplier.id, districtId: order.districtId, active: true } });
    const district = await tx.district.findUnique({ where: { id: order.districtId } });
    if (!zone || !district || !district.active || district.restricted) throw new AppError("NOT_SERVED");
    const slot = generateSlots({ now, rules: district, leadHours: zone.leadTimeHours }).find((s) => s.start.getTime() === input.windowStart.getTime());
    if (!slot) throw new AppError("SLOT_INVALID");

    let driverId = order.delivery.driverId;
    if (input.driverId && input.driverId !== driverId) {
      const d = await tx.driver.findFirst({ where: { id: input.driverId, supplierId: supplier.id, active: true } });
      if (!d) throw new AppError("DRIVER_INVALID");
      driverId = d.id;
    }
    await tx.delivery.update({ where: { id: order.delivery.id }, data: { status: "ASSIGNED", driverId, assignedAt: now, startedAt: null, arrivedAt: null, otpSentAt: null, otpVerifiedAt: null } });
    await tx.order.update({ where: { id: orderId }, data: { status: "ASSIGNED", windowStart: slot.start, windowEnd: slot.end } });
    await tx.orderEvent.create({ data: { orderId, type: "RESCHEDULED", actorId: user.id } });
    await audit({ actor: user, action: "order.rescheduled", entity: "Order", entityId: orderId, before: { windowStart: order.windowStart }, after: { windowStart: slot.start, driverId }, meta }, tx);
    return { order, driverId };
  }, TX);

  const driver = await db.driver.findUnique({ where: { id: result.driverId }, select: { userId: true } });
  if (driver) await notifyUserId(driver.userId, "delivery.assigned", { ar: `سبيل: أُعيدت جدولة الطلب ${result.order.orderNo}. راجع تطبيق السائق.`, en: `Sabeel: order ${result.order.orderNo} was rescheduled. Check the driver app.` }, { orderId });
  await notifyUserId(result.order.buyerId, "order.rescheduled", { ar: `سبيل: أُعيدت جدولة توصيل طلبك ${result.order.orderNo} بموعد جديد.`, en: `Sabeel: delivery of order ${result.order.orderNo} was rescheduled to a new window.` }, { orderId });
}

/** A supplier that cannot complete a failed delivery cancels it (with a reason); the buyer is told. */
export async function supplierCancelFailed(user: Actor, supplier: Supplier, orderId: string, reason: string, meta: RequestMeta) {
  if (!reason.trim()) throw new AppError("VALIDATION", { field: "reason" });
  const order = await db.order.findFirst({ where: { id: orderId, supplierId: supplier.id } });
  if (!order) throw new AppError("NOT_FOUND");
  const changed = await db.order.updateMany({ where: { id: orderId, status: "FAILED_ATTEMPT" }, data: { status: "CANCELLED", cancelReason: reason.trim(), cancelledAt: new Date() } });
  if (changed.count === 0) throw new AppError("INVALID_STATE");
  await db.orderAllocation.updateMany({ where: { orderId, status: { in: ["OFFERED", "ACCEPTED"] } }, data: { status: "WITHDRAWN", respondedAt: new Date() } });
  await db.orderEvent.create({ data: { orderId, type: "CANCELLED", actorId: user.id, note: reason.trim() } });
  await audit({ actor: user, action: "order.cancelled_by_supplier", entity: "Order", entityId: orderId, before: { status: "FAILED_ATTEMPT" }, after: { status: "CANCELLED" }, note: reason, meta });
  await notifyUserId(order.buyerId, "order.cancelled", { ar: `سبيل: تعذّر توصيل طلبك ${order.orderNo} وأُلغي. لا مبلغ مستحق عليك.`, en: `Sabeel: order ${order.orderNo} could not be delivered and was cancelled. Nothing is owed.` }, { orderId });
}

// ───────────────────────── expiry job & escalation retries ─────────────────────────

/** Orders nobody answered within the SLA go to the next supplier (T04/T05/T06). Safe to run from several places at once. */
export async function expireOverdueOrders(now: Date = new Date(), limit = 50) {
  const due = await db.order.findMany({ where: { status: "AWAITING_SUPPLIER", acceptBy: { lte: now } }, select: { id: true, supplierId: true }, orderBy: { acceptBy: "asc" }, take: limit });
  const stats = { checked: due.length, reallocated: 0, escalated: 0, skipped: 0 };
  for (const o of due) {
    try {
      const outcome = await moveOn({ orderId: o.id, kind: "EXPIRED", supplierId: o.supplierId, actor: null, now });
      if (outcome === "REALLOCATED") stats.reallocated++;
      else stats.escalated++;
    } catch (e) {
      if (e instanceof AppError && e.code === "INVALID_STATE") { stats.skipped++; continue; } // answered or cancelled meanwhile
      console.error("[jobs] expire failed", o.id, e);
      stats.skipped++;
    }
  }
  return stats;
}

/** Escalated orders are retried now and then: a supplier may have added stock or coverage since. */
export async function retryEscalatedOrders(now: Date = new Date(), limit = 20, minAgeMs = 10 * 60_000) {
  const stuck = await db.order.findMany({ where: { status: "ESCALATED", windowEnd: { gt: now }, updatedAt: { lt: new Date(now.getTime() - minAgeMs) } }, select: { id: true }, take: limit });
  let placed = 0;
  for (const o of stuck) {
    try {
      if (await reallocateEscalated(o.id, null, {}, now)) placed++;
    } catch (e) {
      console.error("[jobs] retry failed", o.id, e);
    }
  }
  return { checked: stuck.length, placed };
}

/** Admin (or the retry job) offers an escalated order to an eligible supplier — optionally a chosen one. */
export async function reallocateEscalated(orderId: string, admin: Actor | null, opts: { supplierId?: string; meta?: RequestMeta }, now: Date = new Date()): Promise<Candidate | null> {
  const picked = await db.$transaction(async (tx) => {
    await lock(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true, delivery: true } });
    if (!order) throw new AppError("NOT_FOUND");
    if (order.status !== "ESCALATED") throw new AppError("INVALID_STATE");
    const past = await tx.orderAllocation.findMany({ where: { orderId }, select: { supplierId: true } });
    const candidates = await findCandidates(tx, order, past.map((a) => a.supplierId), now);
    const chosen = opts.supplierId ? candidates.find((c) => c.supplierId === opts.supplierId) : candidates[0];
    if (!chosen) return null;
    await applyCandidate(tx, order, chosen, admin, now, opts.meta);
    return { chosen, order };
  }, TX);
  if (!picked) {
    if (admin) throw new AppError("NO_ELIGIBLE");
    return null;
  }
  await notifySupplier(picked.chosen.supplierId, "order.placed", orderPlaced(picked.order.orderNo), { orderId });
  await notifyUserId(picked.order.buyerId, "order.reallocated", {
    ar: `سبيل: وجدنا مورّداً لطلبك ${picked.order.orderNo} وأرسلناه إليه.`,
    en: `Sabeel: we found a supplier for your order ${picked.order.orderNo} and sent it over.`,
  }, { orderId });
  return picked.chosen;
}

/** The suppliers an admin could hand an escalated order to right now (same rules as automatic reallocation). */
export async function listCandidatesForOrder(orderId: string, now: Date = new Date()) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true, delivery: true } });
  if (!order) throw new AppError("NOT_FOUND");
  const past = await db.orderAllocation.findMany({ where: { orderId }, select: { supplierId: true } });
  return findCandidates(db, order, past.map((a) => a.supplierId), now);
}

// ───────────────────────── admin: cancel & proof review ─────────────────────────

export async function adminCancelOrder(admin: Actor, orderId: string, reason: string, meta: RequestMeta) {
  if (!reason.trim()) throw new AppError("VALIDATION", { field: "reason" });
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("NOT_FOUND");
  const cancellable: OrderStatus[] = ["AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED", "ESCALATED", "FAILED_ATTEMPT"];
  const changed = await db.order.updateMany({ where: { id: orderId, status: { in: cancellable } }, data: { status: "CANCELLED", cancelReason: reason.trim(), cancelledAt: new Date() } });
  if (changed.count === 0) throw new AppError("INVALID_STATE");
  await db.orderAllocation.updateMany({ where: { orderId, status: { in: ["OFFERED", "ACCEPTED"] } }, data: { status: "WITHDRAWN", respondedAt: new Date() } });
  await db.orderEvent.create({ data: { orderId, type: "CANCELLED", actorId: admin.id, note: reason.trim() } });
  await audit({ actor: admin, action: "order.cancelled_by_admin", entity: "Order", entityId: orderId, before: { status: order.status }, after: { status: "CANCELLED" }, note: reason, meta });
  await notifyCancelled(order, "admin");
  await notifyUserId(order.buyerId, "order.cancelled", { ar: `سبيل: أُلغي طلبك ${order.orderNo} من قبل إدارة سبيل. لا مبلغ مستحق عليك.`, en: `Sabeel: your order ${order.orderNo} was cancelled by Sabeel. Nothing is owed.` }, { orderId });
}

export const reviewSchema = z.object({ outcome: z.enum(["OK", "SUSPICIOUS"]), note: z.string().trim().max(500).optional() });

/** Pilot rule: an admin looks at each delivery's evidence and records the verdict (R11). Usually one attempt per delivery; a REDELIVER dispute outcome can add a second, reviewed separately. */
export async function reviewProof(admin: Actor, orderId: string, input: z.infer<typeof reviewSchema>, meta: RequestMeta) {
  if (input.outcome === "SUSPICIOUS" && !input.note?.trim()) throw new AppError("VALIDATION", { field: "note" });
  const proof = await db.proofOfDelivery.findFirst({ where: { delivery: { orderId } }, orderBy: { attempt: "desc" } });
  if (!proof) throw new AppError("NOT_FOUND");
  if (proof.reviewedAt) throw new AppError("INVALID_STATE");
  const updated = await db.proofOfDelivery.update({
    where: { id: proof.id },
    data: { reviewedById: admin.id, reviewedAt: new Date(), reviewOutcome: input.outcome, reviewNote: input.note?.trim() || null },
  });
  await db.orderEvent.create({ data: { orderId, type: "PROOF_REVIEWED", actorId: admin.id, note: input.outcome } });
  await audit({ actor: admin, action: "proof.reviewed", entity: "ProofOfDelivery", entityId: proof.id, after: { outcome: input.outcome }, note: input.note, meta });
  return updated;
}
