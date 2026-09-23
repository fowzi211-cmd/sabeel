import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { vatIncluded } from "@/lib/money";
import { generateSlots } from "./delivery";
import { suppliersWithExpiredDocs } from "./compliance";
import { rankScores } from "./ranking";
import { supplierRatingSummaries } from "./reviews";

export const searchSchema = z.object({
  districtId: z.string().min(1),
  qtyPacks: z.number().int().min(1).max(500),
  brandId: z.string().min(1).optional(),
  bottleMl: z.number().int().min(100).max(25_000).optional(),
  includeIndependent: z.boolean().default(true),
  sort: z.enum(["best", "price", "fastest"]).default("best"),
});
export type SearchInput = z.infer<typeof searchSchema>;

export interface OfferResult {
  offerId: string;
  supplier: { id: string; nameAr: string; nameEn: string; independent: boolean };
  brand: { id: string; nameAr: string; nameEn: string };
  bottleMl: number;
  bottlesPerPack: number;
  stock: "IN_STOCK" | "LIMITED";
  qtyPacks: number;
  unitPriceHalalas: number;
  goodsHalalas: number;
  deliveryHalalas: number;
  totalHalalas: number;
  vatHalalas: number;
  leadTimeHours: number;
  earliestSlot: string; // ISO instant
  /** null until the supplier has REVIEWS_UNTIL_RATED reviews — shown as "New" until then. */
  rating: number | null;
  reviewCount: number;
  onTimePct: number | null;
  score: number;
}

/**
 * Buyers compare offers only for a destination the supplier actually serves: supplier live,
 * brand still in the registry, offer active and in stock, minimum quantity met, district not
 * restricted, and at least one bookable delivery window exists.
 */
export async function searchOffers(input: SearchInput, now: Date = new Date()): Promise<OfferResult[]> {
  const district = await db.district.findUnique({ where: { id: input.districtId } });
  if (!district || !district.active) throw new AppError("NOT_FOUND", { field: "districtId" });
  if (district.restricted) throw new AppError("RESTRICTED_ZONE", { field: "districtId" });

  const offers = await db.offer.findMany({
    where: {
      active: true,
      stock: { not: "OUT" },
      minQtyPacks: { lte: input.qtyPacks },
      ...(input.brandId ? { brandId: input.brandId } : {}),
      ...(input.bottleMl ? { bottleMl: input.bottleMl } : {}),
      brand: { status: "ACTIVE" },
      supplier: {
        status: "ACTIVE",
        ...(input.includeIndependent ? {} : { type: "BRAND_COMPANY" as const }),
        zones: { some: { districtId: input.districtId, active: true } },
      },
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gt: now } }] },
      ],
    },
    include: {
      brand: { select: { id: true, nameAr: true, nameEn: true } },
      supplier: {
        select: {
          id: true, type: true, legalNameAr: true, legalNameEn: true, tradeName: true,
          zones: { where: { districtId: input.districtId, active: true } },
        },
      },
    },
    take: 200,
  });

  // A supplier whose verified document has expired disappears from comparison automatically.
  const supplierIds = [...new Set(offers.map((o) => o.supplierId))];
  const expired = await suppliersWithExpiredDocs(supplierIds, now);
  const ratings = await supplierRatingSummaries(supplierIds);

  const rows = offers.flatMap((o) => {
    const zone = o.supplier.zones[0];
    if (!zone || expired.has(o.supplierId)) return [];
    const slots = generateSlots({ now, rules: district, leadHours: zone.leadTimeHours });
    if (slots.length === 0) return []; // nothing bookable ⇒ a dead-end offer, so do not show it
    const goods = o.priceHalalas * input.qtyPacks;
    const total = goods + zone.deliveryFeeHalalas;
    const rating = ratings.get(o.supplierId) ?? { rating: null, reviewCount: 0 };
    return [{
      offerId: o.id,
      supplier: {
        id: o.supplier.id,
        nameAr: o.supplier.tradeName || o.supplier.legalNameAr,
        nameEn: o.supplier.legalNameEn || o.supplier.tradeName || o.supplier.legalNameAr,
        independent: o.supplier.type === "INDEPENDENT",
      },
      brand: o.brand,
      bottleMl: o.bottleMl,
      bottlesPerPack: o.bottlesPerPack,
      stock: o.stock as "IN_STOCK" | "LIMITED",
      qtyPacks: input.qtyPacks,
      unitPriceHalalas: o.priceHalalas,
      goodsHalalas: goods,
      deliveryHalalas: zone.deliveryFeeHalalas,
      totalHalalas: total,
      vatHalalas: vatIncluded(total),
      leadTimeHours: zone.leadTimeHours,
      earliestSlot: slots[0].start.toISOString(),
      rating: rating.rating,
      reviewCount: rating.reviewCount,
      onTimePct: null, // delivery on-time % is a later-slice metric (design pack R08); reviews only for now
      score: 0,
    } satisfies OfferResult];
  });

  const scores = rankScores(rows.map((r) => ({ totalHalalas: r.totalHalalas, leadHours: r.leadTimeHours, rating: r.rating, onTimePct: r.onTimePct })));
  rows.forEach((r, i) => (r.score = Math.round(scores[i] * 1000) / 1000));

  const byPrice = (a: OfferResult, b: OfferResult) => a.totalHalalas - b.totalHalalas || b.score - a.score;
  const byFastest = (a: OfferResult, b: OfferResult) => a.leadTimeHours - b.leadTimeHours || a.totalHalalas - b.totalHalalas;
  const byBest = (a: OfferResult, b: OfferResult) => b.score - a.score || a.totalHalalas - b.totalHalalas;
  rows.sort(input.sort === "price" ? byPrice : input.sort === "fastest" ? byFastest : byBest);
  return rows.slice(0, 50);
}
