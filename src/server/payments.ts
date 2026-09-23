import { z } from "zod";
import { Prisma, type DisputeCategory, type Order, type PaymentStatus, type Role, type Supplier, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import {
  CONFIRM_ADMIN_REVIEW_HOURS, CONFIRM_REMINDER_HOURS, DELIVERY_DISPUTE_OUTCOMES, DISPUTE_CATEGORIES,
  MAX_DELIVERY_ATTEMPTS, PAYMENT_DISPUTE_OUTCOMES, PAYMENT_REMINDER_BEFORE_HOURS,
  PAYMENT_REMINDER_FOLLOWUP_DAYS, REVIEW_WINDOW_DAYS,
} from "@/lib/fulfilment";
import { generateSlots } from "./delivery";
import { formatSar } from "@/lib/money";
import { amountOwedFor, dueAtFrom, isOnTime, isValidAdjustment } from "@/lib/payments";
import { checkCeilingAndPause, createFeeAccrual } from "./fees";
import { checkRateLimit } from "@/lib/rateLimit";
import { notifyCancelled } from "./orders";
import { notifySupplier, notifyUserId, type Bilingual } from "./notify";
import { deleteUpload, saveReceipt } from "./storage";

type Actor = { id: string; roles: Role[] };
const TX = { timeout: 20_000, maxWait: 10_000 };
const lock = (tx: Prisma.TransactionClient, orderId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"order:" + orderId}))`;
const HOUR = 3_600_000;
const DAY = 86_400_000;

async function nextPaymentNo(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('sabeel_payment_no_seq') AS n`;
  return `SBL-PAY-${new Date().getUTCFullYear()}-${String(rows[0].n).padStart(6, "0")}`;
}

// ───────────────────────── T12/T14/T16: confirm delivery, open a PaymentRecord ─────────────────────────

/**
 * The one place a PaymentRecord is created — buyer confirmation, admin-after-silence, or a dismissed/adjusted
 * dispute. It is also the one place a FeeAccrual is created, from the order's own delivered-quantity proof
 * (FR-FEE-11) — the caller still needs to run checkCeilingAndPause() once the outer transaction commits.
 */
async function settleConfirmation(
  tx: Prisma.TransactionClient,
  order: Pick<Order, "id" | "orderNo" | "buyerId" | "supplierId" | "totalHalalas" | "adjustedTotalHalalas" | "feePerPacketHalalas">,
  opts: { method: "BUYER" | "ADMIN_SILENCE" | "ADMIN_DISPUTE"; actorId: string; now: Date },
) {
  const amount = amountOwedFor(order.totalHalalas, order.adjustedTotalHalalas);
  const dueAt = dueAtFrom(opts.now);
  const transactionNo = await nextPaymentNo(tx);
  await tx.order.update({ where: { id: order.id }, data: { status: "CONFIRMED_BY_BOTH", confirmedAt: opts.now, confirmedById: opts.actorId, confirmMethod: opts.method } });
  await tx.paymentRecord.create({ data: { orderId: order.id, transactionNo, status: "DUE", amountHalalas: amount, dueAt } });
  await tx.orderEvent.create({ data: { orderId: order.id, type: "CONFIRMED", actorId: opts.method === "BUYER" ? opts.actorId : null, note: opts.method } });

  const proof = await tx.proofOfDelivery.findFirst({ where: { delivery: { orderId: order.id } }, orderBy: { attempt: "desc" } });
  if (proof) await createFeeAccrual(tx, order, proof); // should always exist by this point; defensive, not fatal, if not

  return { transactionNo, amount, dueAt };
}

const paymentDueNotice = (orderNo: string, amountHalalas: number, txNo: string): Bilingual => ({
  ar: `سبيل: تأكّد تسليم طلبك ${orderNo}. الدفع مستحق للمورّد مباشرة: ${formatSar(amountHalalas, "ar")}. رقم العملية ${txNo} للإشارة إليه في التحويل. افتح التطبيق لبيانات الحساب.`,
  en: `Sabeel: order ${orderNo} is confirmed delivered. ${formatSar(amountHalalas, "en")} is due directly to the supplier. Use transaction ${txNo} as your transfer reference. Open the app for the bank details.`,
});

/** T12: the buyer confirms receipt. Reveals the supplier's bank details and starts the 3-day payment clock. */
export async function confirmReceipt(user: User, orderId: string, meta: RequestMeta, now: Date = new Date()) {
  const order = await db.order.findFirst({ where: { id: orderId, buyerId: user.id } });
  if (!order) throw new AppError("NOT_FOUND");
  if (!["DELIVERED_DRIVER_CONFIRMED", "ADMIN_REVIEW"].includes(order.status)) throw new AppError("INVALID_STATE");

  const result = await db.$transaction(async (tx) => {
    await lock(tx, orderId);
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (!["DELIVERED_DRIVER_CONFIRMED", "ADMIN_REVIEW"].includes(fresh.status)) throw new AppError("INVALID_STATE");
    const settled = await settleConfirmation(tx, fresh, { method: "BUYER", actorId: user.id, now });
    await audit({ actor: { id: user.id, roles: user.roles }, action: "order.confirmed", entity: "Order", entityId: orderId, after: { method: "BUYER", ...settled }, meta }, tx);
    return settled;
  }, TX);
  await notifyUserId(user.id, "payment.due", paymentDueNotice(order.orderNo, result.amount, result.transactionNo), { orderId });
  await checkCeilingAndPause(order.supplierId, now);
}

/** T14: nobody heard from the buyer for 72 h — an admin confirms on the delivery evidence. */
export async function adminConfirmSilence(admin: Actor, orderId: string, note: string, meta: RequestMeta, now: Date = new Date()) {
  if (!note.trim()) throw new AppError("VALIDATION", { field: "note" });
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("NOT_FOUND");
  if (order.status !== "ADMIN_REVIEW") throw new AppError("INVALID_STATE");

  const result = await db.$transaction(async (tx) => {
    await lock(tx, orderId);
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (fresh.status !== "ADMIN_REVIEW") throw new AppError("INVALID_STATE");
    const settled = await settleConfirmation(tx, fresh, { method: "ADMIN_SILENCE", actorId: admin.id, now });
    await audit({ actor: admin, action: "order.admin_confirmed", entity: "Order", entityId: orderId, after: { method: "ADMIN_SILENCE", ...settled }, note, meta }, tx);
    return settled;
  }, TX);
  await notifyUserId(order.buyerId, "payment.due", paymentDueNotice(order.orderNo, result.amount, result.transactionNo), { orderId });
  await checkCeilingAndPause(order.supplierId, now);
}

// ───────────────────────── T15/T16: disputes ─────────────────────────

export const reportProblemSchema = z.object({ category: z.enum(DISPUTE_CATEGORIES), note: z.string().trim().min(2).max(500) });

/** T15: the buyer reports a problem with the delivery itself — pauses confirmation and, later, payment. */
export async function openDeliveryDispute(user: User, orderId: string, input: z.infer<typeof reportProblemSchema>, meta: RequestMeta) {
  checkRateLimit(`dispute.open:${user.id}`, 10, 60 * 60_000);
  const order = await db.order.findFirst({ where: { id: orderId, buyerId: user.id } });
  if (!order) throw new AppError("NOT_FOUND");
  // Checked before the status guard: once a dispute is open the order is DISPUTED anyway, but
  // "a dispute is already open" is the more useful thing to tell a buyer trying to report a second one.
  if (await db.dispute.findFirst({ where: { orderId, status: "OPEN" } })) throw new AppError("DISPUTE_OPEN");
  if (!["DELIVERED_DRIVER_CONFIRMED", "ADMIN_REVIEW"].includes(order.status)) throw new AppError("INVALID_STATE");

  const dispute = await db.$transaction(async (tx) => {
    await lock(tx, orderId);
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const open = await tx.dispute.findFirst({ where: { orderId, status: "OPEN" } });
    if (open) throw new AppError("DISPUTE_OPEN");
    if (!["DELIVERED_DRIVER_CONFIRMED", "ADMIN_REVIEW"].includes(fresh.status)) throw new AppError("INVALID_STATE");
    const created = await tx.dispute.create({ data: { orderId, category: input.category, openedBy: "BUYER", openedById: user.id, note: input.note } });
    await tx.order.update({ where: { id: orderId }, data: { status: "DISPUTED" } });
    await tx.orderEvent.create({ data: { orderId, type: "DISPUTED", actorId: user.id, note: input.category } });
    await audit({ actor: { id: user.id, roles: user.roles }, action: "dispute.opened", entity: "Dispute", entityId: created.id, after: { category: input.category }, note: input.note, meta }, tx);
    return created;
  }, TX);

  await notifySupplier(order.supplierId, "dispute.opened", {
    ar: `سبيل: أبلغ المشتري عن مشكلة في الطلب ${order.orderNo}. سيراجعها فريق سبيل ويتواصل معك.`,
    en: `Sabeel: the buyer reported a problem with order ${order.orderNo}. Our team will review it and get in touch.`,
  }, { orderId, disputeId: dispute.id });
  return dispute;
}

export const nonPaymentSchema = z.object({ note: z.string().trim().min(2).max(500) });

/** The supplier says the buyer has not paid. Pauses only the PaymentRecord — the order itself stays as it is. */
export async function openNonPaymentDispute(user: Actor, supplier: Supplier, orderId: string, input: z.infer<typeof nonPaymentSchema>, meta: RequestMeta) {
  checkRateLimit(`dispute.open:${supplier.id}`, 10, 60 * 60_000);
  const order = await db.order.findFirst({ where: { id: orderId, supplierId: supplier.id }, include: { payment: true } });
  if (!order) throw new AppError("NOT_FOUND");
  if (!order.payment || !["DUE", "OVERDUE"].includes(order.payment.status)) throw new AppError("INVALID_STATE");

  const dispute = await db.$transaction(async (tx) => {
    await lock(tx, orderId);
    const payment = await tx.paymentRecord.findUniqueOrThrow({ where: { orderId } });
    if (!["DUE", "OVERDUE"].includes(payment.status)) throw new AppError("INVALID_STATE");
    if (await tx.dispute.findFirst({ where: { orderId, status: "OPEN" } })) throw new AppError("DISPUTE_OPEN");
    const created = await tx.dispute.create({ data: { orderId, category: "NON_PAYMENT", openedBy: "SUPPLIER", openedById: user.id, note: input.note } });
    await tx.paymentRecord.update({ where: { orderId }, data: { status: "DISPUTED" } });
    await tx.orderEvent.create({ data: { orderId, type: "PAYMENT_DISPUTED", actorId: user.id } });
    await audit({ actor: user, action: "dispute.opened", entity: "Dispute", entityId: created.id, after: { category: "NON_PAYMENT" }, note: input.note, meta }, tx);
    return created;
  }, TX);

  await notifyUserId(order.buyerId, "dispute.opened", {
    ar: `سبيل: أبلغ المورّد أنه لم يستلم دفعة الطلب ${order.orderNo}. سيراجع فريق سبيل الأمر.`,
    en: `Sabeel: the supplier reported that payment for order ${order.orderNo} was not received. Our team will review it.`,
  }, { orderId, disputeId: dispute.id });
  return dispute;
}

export const resolveDisputeSchema = z.object({
  outcome: z.enum([...DELIVERY_DISPUTE_OUTCOMES, ...PAYMENT_DISPUTE_OUTCOMES]),
  resolutionNote: z.string().trim().min(2).max(1000),
  adjustedTotalHalalas: z.number().int().min(1).optional(),
  windowStart: z.coerce.date().optional(),
  driverId: z.string().min(1).optional(),
});
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;

async function settlePaymentReceived(tx: Prisma.TransactionClient, order: Order, payment: { id: string; markedPaidAt: Date | null; dueAt: Date }, actorId: string, now: Date) {
  await tx.paymentRecord.update({ where: { id: payment.id }, data: { status: "RECEIVED", receivedById: actorId, receivedAt: now } });
  await tx.order.update({ where: { id: order.id }, data: { status: "PAID" } });
  const onTime = isOnTime(payment.markedPaidAt, payment.dueAt);
  await tx.user.update({ where: { id: order.buyerId }, data: { paidOrdersCount: { increment: 1 }, ...(onTime ? { paidOnTimeCount: { increment: 1 } } : {}) } });
  await tx.orderEvent.create({ data: { orderId: order.id, type: "PAID", actorId } });
}

/** T16: admin decides a dispute. A delivery dispute resolves the order; a non-payment dispute resolves the payment only. */
export async function resolveDispute(admin: Actor, disputeId: string, input: ResolveDisputeInput, meta: RequestMeta, now: Date = new Date()) {
  const dispute = await db.dispute.findUnique({ where: { id: disputeId }, include: { order: { include: { payment: true, delivery: true } } } });
  if (!dispute) throw new AppError("NOT_FOUND");
  if (dispute.status !== "OPEN") throw new AppError("INVALID_STATE");
  const order = dispute.order;

  if (dispute.category === "NON_PAYMENT") {
    if (!(PAYMENT_DISPUTE_OUTCOMES as readonly string[]).includes(input.outcome)) throw new AppError("VALIDATION", { field: "outcome" });
    const outcome = await db.$transaction(async (tx) => {
      await lock(tx, order.id);
      const payment = await tx.paymentRecord.findUnique({ where: { orderId: order.id } });
      if (!payment || payment.status !== "DISPUTED") throw new AppError("INVALID_STATE");
      if (input.outcome === "PAYMENT_RECEIVED") {
        await settlePaymentReceived(tx, order, payment, admin.id, now);
      } else if (input.outcome === "PAYMENT_STILL_DUE") {
        await tx.paymentRecord.update({ where: { id: payment.id }, data: { status: payment.dueAt < now ? "OVERDUE" : "DUE" } });
      } else {
        await tx.paymentRecord.update({ where: { id: payment.id }, data: { status: "VOID" } });
      }
      await tx.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED", outcome: input.outcome, resolvedById: admin.id, resolvedAt: now, resolutionNote: input.resolutionNote } });
      await tx.orderEvent.create({ data: { orderId: order.id, type: "DISPUTE_RESOLVED", actorId: admin.id, note: input.outcome } });
      await audit({ actor: admin, action: "dispute.resolved", entity: "Dispute", entityId: disputeId, after: { outcome: input.outcome }, note: input.resolutionNote, meta }, tx);
      return input.outcome;
    }, TX);

    const tellBuyer: Bilingual =
      outcome === "PAYMENT_RECEIVED" ? { ar: `سبيل: أكّدت الإدارة استلام دفعة طلبك ${order.orderNo}.`, en: `Sabeel: Sabeel confirmed payment was received for order ${order.orderNo}.` }
      : outcome === "PAYMENT_STILL_DUE" ? { ar: `سبيل: الدفعة عن طلبك ${order.orderNo} ما زالت مستحقة. يرجى السداد فوراً.`, en: `Sabeel: payment for order ${order.orderNo} is still due. Please pay right away.` }
      : { ar: `سبيل: أُسقطت مطالبة الدفع عن طلبك ${order.orderNo}.`, en: `Sabeel: the payment claim on order ${order.orderNo} was written off.` };
    await notifyUserId(order.buyerId, "dispute.resolved", tellBuyer, { orderId: order.id, disputeId });
    await notifySupplier(order.supplierId, "dispute.resolved", { ar: `سبيل: أُغلق نزاع عدم الدفع على الطلب ${order.orderNo}.`, en: `Sabeel: the non-payment dispute on order ${order.orderNo} was closed.` }, { orderId: order.id, disputeId });
    return;
  }

  // Delivery dispute.
  if (!(DELIVERY_DISPUTE_OUTCOMES as readonly string[]).includes(input.outcome)) throw new AppError("VALIDATION", { field: "outcome" });
  if (order.status !== "DISPUTED") throw new AppError("INVALID_STATE");

  if (input.outcome === "CANCEL") {
    await db.$transaction(async (tx) => {
      await lock(tx, order.id);
      const changed = await tx.order.updateMany({ where: { id: order.id, status: "DISPUTED" }, data: { status: "CANCELLED", cancelReason: input.resolutionNote, cancelledAt: now } });
      if (changed.count === 0) throw new AppError("INVALID_STATE");
      await tx.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED", outcome: "CANCEL", resolvedById: admin.id, resolvedAt: now, resolutionNote: input.resolutionNote } });
      await tx.orderEvent.create({ data: { orderId: order.id, type: "DISPUTE_RESOLVED", actorId: admin.id, note: "CANCEL" } });
      await audit({ actor: admin, action: "dispute.resolved", entity: "Dispute", entityId: disputeId, after: { outcome: "CANCEL" }, note: input.resolutionNote, meta }, tx);
    }, TX);
    await notifyCancelled({ id: order.id, orderNo: order.orderNo, supplierId: order.supplierId }, "admin");
    await notifyUserId(order.buyerId, "dispute.resolved", { ar: `سبيل: أُلغي طلبك ${order.orderNo} بعد مراجعة النزاع. لا مبلغ مستحق عليك.`, en: `Sabeel: your order ${order.orderNo} was cancelled after review. Nothing is owed.` }, { orderId: order.id, disputeId });
    return;
  }

  if (input.outcome === "DISMISS" || input.outcome === "PRICE_ADJUSTMENT") {
    if (input.outcome === "PRICE_ADJUSTMENT" && (input.adjustedTotalHalalas === undefined || !isValidAdjustment(input.adjustedTotalHalalas, order.totalHalalas))) {
      throw new AppError("VALIDATION", { field: "adjustedTotalHalalas" });
    }
    const settled = await db.$transaction(async (tx) => {
      await lock(tx, order.id);
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (fresh.status !== "DISPUTED") throw new AppError("INVALID_STATE");
      if (input.outcome === "PRICE_ADJUSTMENT") await tx.order.update({ where: { id: order.id }, data: { adjustedTotalHalalas: input.adjustedTotalHalalas } });
      const forConfirm = { ...fresh, adjustedTotalHalalas: input.outcome === "PRICE_ADJUSTMENT" ? input.adjustedTotalHalalas! : fresh.adjustedTotalHalalas };
      const result = await settleConfirmation(tx, forConfirm, { method: "ADMIN_DISPUTE", actorId: admin.id, now });
      await tx.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED", outcome: input.outcome, resolvedById: admin.id, resolvedAt: now, resolutionNote: input.resolutionNote } });
      await tx.orderEvent.create({ data: { orderId: order.id, type: "DISPUTE_RESOLVED", actorId: admin.id, note: input.outcome } });
      await audit({ actor: admin, action: "dispute.resolved", entity: "Dispute", entityId: disputeId, after: { outcome: input.outcome, ...result }, note: input.resolutionNote, meta }, tx);
      return result;
    }, TX);
    await notifyUserId(order.buyerId, "payment.due", paymentDueNotice(order.orderNo, settled.amount, settled.transactionNo), { orderId: order.id, disputeId });
    await notifySupplier(order.supplierId, "dispute.resolved", { ar: `سبيل: حُسم نزاع الطلب ${order.orderNo}: ${input.outcome === "PRICE_ADJUSTMENT" ? "بتعديل السعر" : "لصالحك"}.`, en: `Sabeel: the dispute on order ${order.orderNo} was resolved ${input.outcome === "PRICE_ADJUSTMENT" ? "with a price adjustment" : "in your favour"}.` }, { orderId: order.id, disputeId });
    await checkCeilingAndPause(order.supplierId, now);
    return;
  }

  // REDELIVER: a fresh attempt on the same delivery. Reuses the existing driver flow (attempt-scoped proof).
  if (!order.delivery) throw new AppError("INVALID_STATE");
  if (order.delivery.attempts >= MAX_DELIVERY_ATTEMPTS) throw new AppError("MAX_ATTEMPTS");
  if (!input.windowStart) throw new AppError("VALIDATION", { field: "windowStart" });

  const district = await db.district.findUnique({ where: { id: order.districtId } });
  const zone = await db.coverageZone.findFirst({ where: { supplierId: order.supplierId, districtId: order.districtId, active: true } });
  if (!district || !district.active || district.restricted || !zone) throw new AppError("NOT_SERVED");
  const slot = generateSlots({ now, rules: district, leadHours: zone.leadTimeHours }).find((s) => s.start.getTime() === input.windowStart!.getTime());
  if (!slot) throw new AppError("SLOT_INVALID");

  let driverId = order.delivery.driverId;
  if (input.driverId && input.driverId !== driverId) {
    const d = await db.driver.findFirst({ where: { id: input.driverId, supplierId: order.supplierId, active: true } });
    if (!d) throw new AppError("DRIVER_INVALID");
    driverId = d.id;
  }

  await db.$transaction(async (tx) => {
    await lock(tx, order.id);
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    if (fresh.status !== "DISPUTED") throw new AppError("INVALID_STATE");
    await tx.delivery.update({ where: { orderId: order.id }, data: { status: "ASSIGNED", driverId, assignedAt: now, deliveredAt: null, startedAt: null, arrivedAt: null, otpSentAt: null, otpVerifiedAt: null } });
    await tx.order.update({ where: { id: order.id }, data: { status: "ASSIGNED", windowStart: slot.start, windowEnd: slot.end } });
    await tx.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED", outcome: "REDELIVER", resolvedById: admin.id, resolvedAt: now, resolutionNote: input.resolutionNote } });
    await tx.orderEvent.create({ data: { orderId: order.id, type: "DISPUTE_RESOLVED", actorId: admin.id, note: "REDELIVER" } });
    await audit({ actor: admin, action: "dispute.resolved", entity: "Dispute", entityId: disputeId, after: { outcome: "REDELIVER", windowStart: slot.start, driverId }, note: input.resolutionNote, meta }, tx);
  }, TX);

  await notifyUserId(order.buyerId, "dispute.resolved", { ar: `سبيل: سيُعاد توصيل طلبك ${order.orderNo} في موعد جديد.`, en: `Sabeel: order ${order.orderNo} will be redelivered at a new time.` }, { orderId: order.id, disputeId });
  await notifySupplier(order.supplierId, "dispute.resolved", { ar: `سبيل: قررت الإدارة إعادة توصيل الطلب ${order.orderNo}.`, en: `Sabeel: Sabeel decided to redeliver order ${order.orderNo}.` }, { orderId: order.id, disputeId });
  const driver = await db.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
  if (driver) await notifyUserId(driver.userId, "delivery.assigned", { ar: `سبيل: أُعيد إسناد الطلب ${order.orderNo} إليك بعد مراجعة نزاع.`, en: `Sabeel: order ${order.orderNo} was reassigned to you after a dispute review.` }, { orderId: order.id });
}

export async function listOpenDisputes(category?: DisputeCategory) {
  return db.dispute.findMany({
    where: { status: "OPEN", ...(category ? { category } : {}) },
    include: { order: { select: { id: true, orderNo: true, status: true, totalHalalas: true, supplier: { select: { tradeName: true, legalNameAr: true } } } } },
    orderBy: { createdAt: "asc" },
  });
}

// ───────────────────────── buyer payment actions ─────────────────────────

export const markPaidSchema = z.object({ paymentDate: z.coerce.date(), bankReference: z.string().trim().min(1).max(60) });

/** The buyer paid outside the platform (bank transfer) and tells us so — an optional receipt is just evidence. */
export async function markPaid(user: User, orderId: string, input: z.infer<typeof markPaidSchema>, file: File | null, meta: RequestMeta, now: Date = new Date()) {
  const order = await db.order.findFirst({ where: { id: orderId, buyerId: user.id }, include: { payment: true } });
  if (!order) throw new AppError("NOT_FOUND");
  if (!order.payment || !["DUE", "OVERDUE"].includes(order.payment.status)) throw new AppError("INVALID_STATE");
  if (input.paymentDate.getTime() > now.getTime() + DAY) throw new AppError("VALIDATION", { field: "paymentDate" });

  const receipt = file ? await saveReceipt(orderId, file) : null;
  try {
    await db.$transaction(async (tx) => {
      await lock(tx, orderId);
      const payment = await tx.paymentRecord.findUniqueOrThrow({ where: { orderId } });
      if (!["DUE", "OVERDUE"].includes(payment.status)) throw new AppError("INVALID_STATE");
      await tx.paymentRecord.update({
        where: { id: payment.id },
        data: { status: "BUYER_MARKED_PAID", paymentDate: input.paymentDate, bankReference: input.bankReference.trim(), markedPaidAt: now, ...(receipt ? { receiptFileKey: receipt.fileKey, receiptMime: receipt.mime } : {}) },
      });
      await tx.orderEvent.create({ data: { orderId, type: "PAYMENT_MARKED_PAID", actorId: user.id } });
      await audit({ actor: { id: user.id, roles: user.roles }, action: "payment.marked_paid", entity: "PaymentRecord", entityId: payment.id, after: { bankReference: input.bankReference }, meta }, tx);
    }, TX);
  } catch (e) {
    if (receipt) await deleteUpload(receipt.fileKey);
    throw e;
  }

  await notifySupplier(order.supplierId, "payment.marked_paid", { ar: `سبيل: أفاد المشتري بدفع الطلب ${order.orderNo}. راجع بياناته وأكّد الاستلام.`, en: `Sabeel: the buyer says they paid order ${order.orderNo}. Check the details and confirm receipt.` }, { orderId });
}

// ───────────────────────── supplier payment actions ─────────────────────────

export async function markReceived(user: Actor, supplier: Supplier, orderId: string, meta: RequestMeta, now: Date = new Date()) {
  const order = await db.order.findFirst({ where: { id: orderId, supplierId: supplier.id }, include: { payment: true } });
  if (!order) throw new AppError("NOT_FOUND");
  if (!order.payment || order.payment.status !== "BUYER_MARKED_PAID") throw new AppError("INVALID_STATE");

  await db.$transaction(async (tx) => {
    await lock(tx, orderId);
    const payment = await tx.paymentRecord.findUniqueOrThrow({ where: { orderId } });
    if (payment.status !== "BUYER_MARKED_PAID") throw new AppError("INVALID_STATE");
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    await settlePaymentReceived(tx, fresh, payment, user.id, now);
    await audit({ actor: user, action: "payment.received", entity: "PaymentRecord", entityId: payment.id, meta }, tx);
  }, TX);

  await notifyUserId(order.buyerId, "payment.received", { ar: `سبيل: أكّد المورّد استلام دفعة طلبك ${order.orderNo}. شكراً لك.`, en: `Sabeel: the supplier confirmed receipt of your payment for order ${order.orderNo}. Thank you.` }, { orderId });
}

export const notReceivedSchema = z.object({ note: z.string().trim().min(2).max(300) });

export async function markNotReceived(user: Actor, supplier: Supplier, orderId: string, input: z.infer<typeof notReceivedSchema>, meta: RequestMeta, now: Date = new Date()) {
  const order = await db.order.findFirst({ where: { id: orderId, supplierId: supplier.id }, include: { payment: true } });
  if (!order) throw new AppError("NOT_FOUND");
  if (!order.payment || order.payment.status !== "BUYER_MARKED_PAID") throw new AppError("INVALID_STATE");

  await db.$transaction(async (tx) => {
    await lock(tx, orderId);
    const payment = await tx.paymentRecord.findUniqueOrThrow({ where: { orderId } });
    if (payment.status !== "BUYER_MARKED_PAID") throw new AppError("INVALID_STATE");
    await tx.paymentRecord.update({ where: { id: payment.id }, data: { status: payment.dueAt < now ? "OVERDUE" : "DUE", notReceivedNote: input.note.trim(), notReceivedAt: now } });
    await tx.orderEvent.create({ data: { orderId, type: "PAYMENT_NOT_RECEIVED", actorId: user.id, note: input.note.trim() } });
    await audit({ actor: user, action: "payment.not_received", entity: "PaymentRecord", entityId: payment.id, note: input.note, meta }, tx);
  }, TX);

  await notifyUserId(order.buyerId, "payment.not_received", { ar: `سبيل: أفاد المورّد بعدم استلام دفعة الطلب ${order.orderNo}. راجع بيانات التحويل وأعد المحاولة.`, en: `Sabeel: the supplier says payment for order ${order.orderNo} was not received. Please check the details and try again.` }, { orderId });
}

export interface PaymentListFilter { status?: PaymentStatus; brandId?: string; from?: Date; to?: Date; q?: string }

/** The supplier's Payments page (design pack §"Supplier Payments page"). */
export async function listSupplierPayments(supplierId: string, filter: PaymentListFilter = {}) {
  return db.paymentRecord.findMany({
    where: {
      order: {
        supplierId,
        ...(filter.brandId ? { items: { some: { brandId: filter.brandId } } } : {}),
      },
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from || filter.to ? { createdAt: { gte: filter.from, lte: filter.to } } : {}),
      ...(filter.q ? { OR: [{ transactionNo: { contains: filter.q, mode: "insensitive" } }, { order: { orderNo: { contains: filter.q, mode: "insensitive" } } }] } : {}),
    },
    include: { order: { select: { id: true, orderNo: true, totalHalalas: true, feePerPacketHalalas: true, packetEqMilliTotal: true, placedAt: true, items: { select: { brandNameAr: true, brandNameEn: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

// ───────────────────────── background jobs ─────────────────────────

const alreadyNotified = (event: string, orderId: string) => db.notification.findFirst({ where: { event, payload: { path: ["orderId"], equals: orderId } } }).then((n) => !!n);

/** Reminders while the buyer is silent, then hand the order to admin after 72 h (T13). */
export async function sendConfirmReminders(now: Date = new Date(), limit = 200) {
  const stats = { reminded24: 0, reminded48: 0, sentToReview: 0 };
  for (const hours of CONFIRM_REMINDER_HOURS) {
    const due = await db.order.findMany({
      where: { status: "DELIVERED_DRIVER_CONFIRMED", delivery: { deliveredAt: { lte: new Date(now.getTime() - hours * HOUR) } } },
      select: { id: true, orderNo: true, buyerId: true }, take: limit,
    });
    const event = `order.confirm_reminder_${hours}h`;
    for (const o of due) {
      if (await alreadyNotified(event, o.id)) continue;
      await notifyUserId(o.buyerId, event, {
        ar: `سبيل: طلبك ${o.orderNo} بانتظار تأكيدك. افتح التطبيق لمراجعة تقرير التسليم والتأكيد.`,
        en: `Sabeel: order ${o.orderNo} is waiting for your confirmation. Open the app to review the delivery report.`,
      }, { orderId: o.id });
      if (hours === 24) stats.reminded24++;
      else stats.reminded48++;
    }
  }

  const overdue = await db.order.findMany({
    where: { status: "DELIVERED_DRIVER_CONFIRMED", delivery: { deliveredAt: { lte: new Date(now.getTime() - CONFIRM_ADMIN_REVIEW_HOURS * HOUR) } } },
    select: { id: true, orderNo: true, buyerId: true }, take: limit,
  });
  for (const o of overdue) {
    const changed = await db.order.updateMany({ where: { id: o.id, status: "DELIVERED_DRIVER_CONFIRMED" }, data: { status: "ADMIN_REVIEW" } });
    if (changed.count === 0) continue;
    await db.orderEvent.create({ data: { orderId: o.id, type: "ADMIN_REVIEW" } });
    await notifyUserId(o.buyerId, "order.admin_review", { ar: `سبيل: أُحيل طلبك ${o.orderNo} لمراجعة الإدارة لعدم ورود تأكيدك. يمكنك التأكيد أو الإبلاغ عن مشكلة في أي وقت.`, en: `Sabeel: order ${o.orderNo} was sent to Sabeel for review since we did not hear from you. You can still confirm or report a problem.` }, { orderId: o.id }, { sms: false });
    stats.sentToReview++;
  }
  return stats;
}

/** Payment reminders and the DUE → OVERDUE transition (design pack §6.2). */
export async function sendPaymentReminders(now: Date = new Date(), limit = 200) {
  const stats = { reminded24: 0, remindedDue: 0, wentOverdue: 0, followUp: 0 };

  const before = await db.paymentRecord.findMany({ where: { status: "DUE", dueAt: { gt: now, lte: new Date(now.getTime() + PAYMENT_REMINDER_BEFORE_HOURS * HOUR) } }, include: { order: { select: { id: true, orderNo: true, buyerId: true } } }, take: limit });
  for (const p of before) {
    if (await alreadyNotified("payment.reminder_before", p.orderId)) continue;
    await notifyUserId(p.order.buyerId, "payment.reminder_before", { ar: `سبيل: دفعة طلبك ${p.order.orderNo} (${formatSar(p.amountHalalas, "ar")}) مستحقة غداً.`, en: `Sabeel: payment for order ${p.order.orderNo} (${formatSar(p.amountHalalas, "en")}) is due tomorrow.` }, { orderId: p.orderId });
    stats.reminded24++;
  }

  const dueNow = await db.paymentRecord.findMany({ where: { status: "DUE", dueAt: { lte: now } }, include: { order: { select: { id: true, orderNo: true, buyerId: true, supplierId: true } } }, take: limit });
  for (const p of dueNow) {
    if (!(await alreadyNotified("payment.reminder_due", p.orderId))) {
      await notifyUserId(p.order.buyerId, "payment.reminder_due", { ar: `سبيل: دفعة طلبك ${p.order.orderNo} (${formatSar(p.amountHalalas, "ar")}) مستحقة اليوم.`, en: `Sabeel: payment for order ${p.order.orderNo} (${formatSar(p.amountHalalas, "en")}) is due today.` }, { orderId: p.orderId });
      stats.remindedDue++;
    }
    const changed = await db.paymentRecord.updateMany({ where: { id: p.id, status: "DUE" }, data: { status: "OVERDUE" } });
    if (changed.count === 0) continue;
    await db.orderEvent.create({ data: { orderId: p.orderId, type: "PAYMENT_OVERDUE" } });
    await notifyUserId(p.order.buyerId, "payment.overdue", { ar: `سبيل: تجاوزت دفعة الطلب ${p.order.orderNo} موعد الاستحقاق. لا يمكنك تقديم طلبات جديدة حتى تسويتها.`, en: `Sabeel: payment for order ${p.order.orderNo} is past due. You cannot place new orders until it is settled.` }, { orderId: p.orderId });
    await notifySupplier(p.order.supplierId, "payment.overdue", { ar: `سبيل: تجاوزت دفعة الطلب ${p.order.orderNo} موعد الاستحقاق.`, en: `Sabeel: payment for order ${p.order.orderNo} is past due.` }, { orderId: p.orderId }, { sms: false });
    stats.wentOverdue++;
  }

  const stale = await db.paymentRecord.findMany({ where: { status: "OVERDUE", dueAt: { lte: new Date(now.getTime() - PAYMENT_REMINDER_FOLLOWUP_DAYS * DAY) } }, include: { order: { select: { id: true, orderNo: true, buyerId: true } } }, take: limit });
  for (const p of stale) {
    if (await alreadyNotified("payment.reminder_followup", p.orderId)) continue;
    await notifyUserId(p.order.buyerId, "payment.reminder_followup", { ar: `سبيل: ما زالت دفعة الطلب ${p.order.orderNo} (${formatSar(p.amountHalalas, "ar")}) غير مسددة. يرجى السداد في أقرب وقت.`, en: `Sabeel: payment for order ${p.order.orderNo} (${formatSar(p.amountHalalas, "en")}) is still unpaid. Please settle it as soon as possible.` }, { orderId: p.orderId });
    stats.followUp++;
  }
  return stats;
}

/** T18: a paid order is closed 30 days after the supplier confirmed receipt. */
export async function closeReviewWindow(now: Date = new Date(), limit = 500) {
  const stale = await db.order.findMany({ where: { status: "PAID", payment: { receivedAt: { lte: new Date(now.getTime() - REVIEW_WINDOW_DAYS * DAY) } } }, select: { id: true }, take: limit });
  if (stale.length === 0) return { closed: 0 };
  const changed = await db.order.updateMany({ where: { id: { in: stale.map((s) => s.id) }, status: "PAID" }, data: { status: "CLOSED", closedAt: now } });
  return { closed: changed.count };
}
