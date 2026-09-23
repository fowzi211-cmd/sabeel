import { z } from "zod";
import { Prisma, type Role, type Supplier, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { averageStars, canStillReview, isRatedSupplier } from "@/lib/reviews";
import { REVIEW_CATEGORIES, REVIEW_REMINDER_HOURS } from "@/lib/fulfilment";
import { checkRateLimit } from "@/lib/rateLimit";
import { deleteUpload, saveReviewPhoto } from "./storage";
import { notifySupplier, notifyUserId } from "./notify";

type Actor = { id: string; roles: Role[] };
const HOUR = 3_600_000;
const REVIEWABLE_STATUSES = ["CONFIRMED_BY_BOTH", "PAID", "CLOSED"];

export const submitReviewSchema = z.object({
  stars: z.number().int().min(1).max(5),
  timeliness: z.number().int().min(1).max(5).optional(),
  asOrdered: z.number().int().min(1).max(5).optional(),
  packaging: z.number().int().min(1).max(5).optional(),
  driverConduct: z.number().int().min(1).max(5).optional(),
  value: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(1000).optional(),
});
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;

/** One review per order, from its buyer, once delivery is confirmed and inside the submission window. */
export async function submitReview(user: User, orderId: string, input: SubmitReviewInput, file: File | null, meta: RequestMeta, now: Date = new Date()) {
  checkRateLimit(`review.submit:${user.id}`, 10, 60 * 60_000);
  const order = await db.order.findFirst({ where: { id: orderId, buyerId: user.id } });
  if (!order) throw new AppError("NOT_FOUND");
  if (!REVIEWABLE_STATUSES.includes(order.status)) throw new AppError("INVALID_STATE");
  if (!order.confirmedAt) throw new AppError("INVALID_STATE");
  if (!canStillReview(order.confirmedAt, now)) throw new AppError("REVIEW_WINDOW_CLOSED");
  if (await db.review.findUnique({ where: { orderId } })) throw new AppError("ALREADY_REVIEWED");

  const photo = file ? await saveReviewPhoto(orderId, file) : null;
  try {
    const review = await db.review.create({
      data: {
        orderId, buyerId: user.id, supplierId: order.supplierId, language: user.language,
        stars: input.stars, timeliness: input.timeliness, asOrdered: input.asOrdered, packaging: input.packaging,
        driverConduct: input.driverConduct, value: input.value, comment: input.comment?.trim() || null,
        ...(photo ? { photoFileKey: photo.fileKey, photoMime: photo.mime } : {}),
      },
    });
    await audit({ actor: { id: user.id, roles: user.roles }, action: "review.submitted", entity: "Review", entityId: review.id, after: { stars: input.stars, supplierId: order.supplierId }, meta });
    await notifySupplier(order.supplierId, "review.submitted", { ar: `سبيل: تقييم جديد (${input.stars}★) على الطلب ${order.orderNo}.`, en: `Sabeel: a new review (${input.stars}★) on order ${order.orderNo}.` }, { orderId, reviewId: review.id }, { sms: false });
    return review;
  } catch (e) {
    if (photo) await deleteUpload(photo.fileKey);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("ALREADY_REVIEWED");
    throw e;
  }
}

export const replyToReviewSchema = z.object({ text: z.string().trim().min(2).max(500) });

/** The supplier's one and only reply — cannot be edited or deleted afterwards. */
export async function replyToReview(user: User, supplier: Supplier, reviewId: string, input: z.infer<typeof replyToReviewSchema>, meta: RequestMeta) {
  checkRateLimit(`review.reply:${supplier.id}`, 20, 60 * 60_000);
  const review = await db.review.findFirst({ where: { id: reviewId, supplierId: supplier.id } });
  if (!review) throw new AppError("NOT_FOUND");
  if (review.removedAt) throw new AppError("INVALID_STATE");
  if (await db.reviewReply.findUnique({ where: { reviewId } })) throw new AppError("ALREADY_REPLIED");

  try {
    const reply = await db.reviewReply.create({ data: { reviewId, supplierUserId: user.id, text: input.text.trim() } });
    await audit({ actor: { id: user.id, roles: user.roles }, action: "review.replied", entity: "ReviewReply", entityId: reply.id, meta });
    await notifyUserId(review.buyerId, "review.replied", { ar: "سبيل: ردّ المورّد على تقييمك.", en: "Sabeel: the supplier replied to your review." }, { reviewId }, { sms: false });
    return reply;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("ALREADY_REPLIED");
    throw e;
  }
}

export const removeReviewSchema = z.object({ reason: z.string().trim().min(2).max(300) });

/** Admin-only takedown (abuse, off-topic, policy violation) — the review row is kept, only hidden. */
export async function removeReview(admin: Actor, reviewId: string, input: z.infer<typeof removeReviewSchema>, meta: RequestMeta, now: Date = new Date()) {
  const review = await db.review.findUnique({ where: { id: reviewId } });
  if (!review) throw new AppError("NOT_FOUND");
  if (review.removedAt) throw new AppError("INVALID_STATE");
  await db.review.update({ where: { id: reviewId }, data: { removedById: admin.id, removedAt: now, removeReason: input.reason.trim() } });
  await audit({ actor: admin, action: "review.removed", entity: "Review", entityId: reviewId, note: input.reason, meta });
}

export interface ReviewListFilter { q?: string }

export const listSupplierReviews = (supplierId: string) =>
  db.review.findMany({
    where: { supplierId, removedAt: null },
    include: { reply: true, order: { select: { orderNo: true } }, buyer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

export const listAdminReviews = (filter: ReviewListFilter = {}) =>
  db.review.findMany({
    where: filter.q ? { OR: [{ order: { orderNo: { contains: filter.q, mode: "insensitive" } } }, { supplier: { tradeName: { contains: filter.q, mode: "insensitive" } } }] } : {},
    include: { reply: true, order: { select: { orderNo: true } }, supplier: { select: { tradeName: true, legalNameAr: true } }, buyer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

/** Feeds the offer comparison list (search.ts): "New" until REVIEWS_UNTIL_RATED reviews are in. */
export async function supplierRatingSummary(supplierId: string): Promise<{ rating: number | null; reviewCount: number }> {
  const rows = await db.review.findMany({ where: { supplierId, removedAt: null }, select: { stars: true } });
  if (!isRatedSupplier(rows.length)) return { rating: null, reviewCount: rows.length };
  return { rating: averageStars(rows.map((r) => r.stars)), reviewCount: rows.length };
}

/** Batched version of supplierRatingSummary for the offer list, one query for every supplier shown. */
export async function supplierRatingSummaries(supplierIds: string[]): Promise<Map<string, { rating: number | null; reviewCount: number }>> {
  const rows = await db.review.groupBy({ by: ["supplierId"], where: { supplierId: { in: supplierIds }, removedAt: null }, _avg: { stars: true }, _count: { stars: true } });
  const map = new Map<string, { rating: number | null; reviewCount: number }>();
  for (const r of rows) {
    const count = r._count.stars;
    map.set(r.supplierId, isRatedSupplier(count) ? { rating: Math.round((r._avg.stars ?? 0) * 10) / 10, reviewCount: count } : { rating: null, reviewCount: count });
  }
  return map;
}

export { REVIEW_CATEGORIES };

// ───────────────────────── background job: review-prompt reminders ─────────────────────────

const alreadyNotified = (event: string, orderId: string) => db.notification.findFirst({ where: { event, payload: { path: ["orderId"], equals: orderId } } }).then((n) => !!n);

/** Nudges a buyer who has not reviewed yet, at N15's reminder hours after delivery was confirmed. */
export async function sendReviewPromptReminders(now: Date = new Date(), limit = 200) {
  const stats = { reminded: 0 };
  for (const hours of REVIEW_REMINDER_HOURS) {
    const due = await db.order.findMany({
      where: { status: { in: REVIEWABLE_STATUSES as never }, confirmedAt: { lte: new Date(now.getTime() - hours * HOUR) }, review: null },
      select: { id: true, orderNo: true, buyerId: true, confirmedAt: true },
      take: limit,
    });
    const event = `review.prompt_${hours}h`;
    for (const o of due) {
      if (!o.confirmedAt || !canStillReview(o.confirmedAt, now)) continue;
      if (await alreadyNotified(event, o.id)) continue;
      await notifyUserId(o.buyerId, event, {
        ar: `سبيل: كيف كانت تجربتك مع طلبك ${o.orderNo}؟ شارك تقييمك ليستفيد غيرك.`,
        en: `Sabeel: how was your experience with order ${o.orderNo}? Share a review to help others.`,
      }, { orderId: o.id }, { sms: false });
      stats.reminded++;
    }
  }
  return stats;
}
