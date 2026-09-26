import { db } from "@/lib/db";
import { DEFAULT_PAGE_SIZE, paginate } from "@/lib/pagination";
import { supplierOnTimeSummaries } from "./ontime";
import { supplierCategoryAverages, supplierRatingSummary } from "./reviews";
import { supplierRates } from "./supplierStats";

const firstName = (full: string | null) => (full ?? "").trim().split(/\s+/)[0] || null;

/**
 * What a buyer may see about a supplier (design pack S05): trust figures and published reviews, nothing private.
 * Only ACTIVE suppliers have a profile — a paused, suspended or unapproved one is simply not found.
 */
export async function getPublicSupplierProfile(supplierId: string, now: Date = new Date()) {
  const s = await db.supplier.findFirst({
    where: { id: supplierId, status: "ACTIVE" },
    select: { id: true, type: true, tradeName: true, legalNameAr: true, legalNameEn: true, createdAt: true },
  });
  if (!s) return null;
  const [rating, categories, onTime, rates] = await Promise.all([
    supplierRatingSummary(s.id, now),
    supplierCategoryAverages(s.id, now),
    supplierOnTimeSummaries([s.id], now),
    supplierRates([s.id], now),
  ]);
  const ot = onTime.get(s.id);
  const rt = rates.get(s.id);
  return {
    id: s.id,
    nameAr: s.tradeName || s.legalNameAr,
    nameEn: s.legalNameEn || s.tradeName || s.legalNameAr,
    independent: s.type === "INDEPENDENT",
    memberSince: s.createdAt,
    rating: rating.rating,
    reviewCount: rating.reviewCount,
    categories,
    onTimePct: ot?.pct ?? null,
    onTimeCount: ot?.count ?? 0,
    acceptancePct: rt?.acceptancePct ?? null,
    acceptanceCount: rt?.acceptanceCount ?? 0,
    disputePct: rt?.disputePct ?? null,
    disputeCount: rt?.disputeCount ?? 0,
  };
}

/** Published reviews only, newest first. The buyer appears by first name — or not at all if the order was anonymous. */
export async function listPublicSupplierReviews(supplierId: string, opts: { cursor?: string; limit?: number } = {}) {
  const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
  const rows = await db.review.findMany({
    where: { supplierId, removedAt: null, supplier: { status: "ACTIVE" } },
    select: {
      id: true, stars: true, comment: true, createdAt: true,
      buyer: { select: { name: true } }, order: { select: { anonymous: true } },
      reply: { select: { text: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const page = paginate(rows, limit);
  return {
    items: page.items.map((r) => ({
      id: r.id, stars: r.stars, comment: r.comment, createdAt: r.createdAt,
      buyerFirstName: r.order.anonymous ? null : firstName(r.buyer.name),
      reply: r.reply ? { text: r.reply.text, createdAt: r.reply.createdAt } : null,
    })),
    nextCursor: page.nextCursor,
  };
}
