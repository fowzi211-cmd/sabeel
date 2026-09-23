import { z } from "zod";
import { Prisma, type Role, type Supplier, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { packetEqMilliFor } from "@/lib/money";

type Actor = { id: string; roles: Role[] };

// ───────────── platform fee in force (read-only until the fee module) ─────────────
/** SAR per packet in halalas, from the latest GLOBAL FIXED_PER_PACKET rule already in effect. */
export async function currentFeePerPacket(at: Date = new Date()): Promise<number> {
  const rule = await db.feeRule.findFirst({
    where: { scope: "GLOBAL", model: "FIXED_PER_PACKET", effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: "desc" },
  });
  return rule?.amountHalalas ?? 50;
}

// ───────────── the supplier must be live to change what buyers can see ─────────────
export async function requireLiveSupplier(userId: string): Promise<Supplier> {
  const supplier = await db.supplier.findFirst({ where: { members: { some: { userId, role: "OWNER" } } } });
  if (!supplier) throw new AppError("NOT_FOUND");
  if (supplier.status !== "ACTIVE") throw new AppError("SUPPLIER_NOT_ACTIVE");
  return supplier;
}

// ───────────── offers ─────────────
export const offerSchema = z.object({
  brandId: z.string().min(1),
  bottleMl: z.number().int().min(100).max(25_000),
  bottlesPerPack: z.number().int().min(1).max(96),
  priceHalalas: z.number().int().min(50).max(10_000_000),
  minQtyPacks: z.number().int().min(1).max(500).default(1),
  stock: z.enum(["IN_STOCK", "LIMITED", "OUT"]).default("IN_STOCK"),
  active: z.boolean().default(true),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().optional(),
});

export const offerPatchSchema = z.object({
  priceHalalas: z.number().int().min(50).max(10_000_000).optional(),
  minQtyPacks: z.number().int().min(1).max(500).optional(),
  stock: z.enum(["IN_STOCK", "LIMITED", "OUT"]).optional(),
  active: z.boolean().optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validTo: z.coerce.date().nullable().optional(),
});

export const listOffers = (supplierId: string) =>
  db.offer.findMany({
    where: { supplierId },
    include: { brand: { select: { id: true, nameAr: true, nameEn: true, status: true } } },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });

export async function createOffer(user: User, supplier: Supplier, input: z.infer<typeof offerSchema>, meta: RequestMeta) {
  const brand = await db.brand.findUnique({ where: { id: input.brandId } });
  if (!brand || brand.status !== "ACTIVE") throw new AppError("BRAND_NOT_ALLOWED", { field: "brandId" });
  if (input.validFrom && input.validTo && input.validTo <= input.validFrom) throw new AppError("VALIDATION", { field: "validTo" });

  try {
    const offer = await db.offer.create({
      data: {
        supplierId: supplier.id,
        brandId: brand.id,
        bottleMl: input.bottleMl,
        bottlesPerPack: input.bottlesPerPack,
        packetEqMilli: packetEqMilliFor(input.bottlesPerPack, input.bottleMl),
        priceHalalas: input.priceHalalas,
        minQtyPacks: input.minQtyPacks,
        stock: input.stock,
        active: input.active,
        validFrom: input.validFrom,
        validTo: input.validTo,
      },
    });
    await audit({ actor: user, action: "offer.created", entity: "Offer", entityId: offer.id, after: { brand: brand.nameEn, price: offer.priceHalalas, bottleMl: offer.bottleMl, packs: offer.bottlesPerPack }, meta });
    return offer;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("CONFLICT", { message: "You already list this brand and pack size — edit the existing offer." });
    }
    throw e;
  }
}

export async function updateOffer(user: User, supplier: Supplier, id: string, patch: z.infer<typeof offerPatchSchema>, meta: RequestMeta) {
  const before = await db.offer.findFirst({ where: { id, supplierId: supplier.id } });
  if (!before) throw new AppError("NOT_FOUND");
  const updated = await db.offer.update({ where: { id }, data: patch });
  await audit({
    actor: user, action: "offer.updated", entity: "Offer", entityId: id,
    before: { price: before.priceHalalas, stock: before.stock, active: before.active, minQty: before.minQtyPacks },
    after: { price: updated.priceHalalas, stock: updated.stock, active: updated.active, minQty: updated.minQtyPacks },
    meta,
  });
  return updated;
}

export async function deleteOffer(user: User, supplier: Supplier, id: string, meta: RequestMeta) {
  const offer = await db.offer.findFirst({ where: { id, supplierId: supplier.id } });
  if (!offer) throw new AppError("NOT_FOUND");
  // Orders keep their own price/brand snapshot, so deleting an offer never rewrites history.
  await db.offer.delete({ where: { id } });
  await audit({ actor: user, action: "offer.deleted", entity: "Offer", entityId: id, before: { price: offer.priceHalalas }, meta });
}

// ───────────── districts and coverage ─────────────
export const listDistricts = (opts: { includeInactive?: boolean } = {}) =>
  db.district.findMany({ where: opts.includeInactive ? {} : { active: true }, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }] });

export const zoneSchema = z.object({
  districtId: z.string().min(1),
  deliveryFeeHalalas: z.number().int().min(0).max(1_000_000),
  leadTimeHours: z.number().int().min(0).max(24 * 14),
  active: z.boolean().default(true),
});

/** Every district with this supplier's zone settings (or null) — drives the coverage screen. */
export async function coverageOverview(supplierId: string) {
  const [districts, zones] = await Promise.all([listDistricts(), db.coverageZone.findMany({ where: { supplierId } })]);
  const byDistrict = new Map(zones.map((z) => [z.districtId, z]));
  return districts.map((d) => ({ district: d, zone: byDistrict.get(d.id) ?? null }));
}

export async function upsertZone(user: User, supplier: Supplier, input: z.infer<typeof zoneSchema>, meta: RequestMeta) {
  const district = await db.district.findUnique({ where: { id: input.districtId } });
  if (!district || !district.active) throw new AppError("NOT_FOUND", { field: "districtId" });
  if (district.restricted) throw new AppError("RESTRICTED_ZONE", { field: "districtId" });

  const zone = await db.coverageZone.upsert({
    where: { supplierId_districtId: { supplierId: supplier.id, districtId: district.id } },
    create: { supplierId: supplier.id, districtId: district.id, deliveryFeeHalalas: input.deliveryFeeHalalas, leadTimeHours: input.leadTimeHours, active: input.active },
    update: { deliveryFeeHalalas: input.deliveryFeeHalalas, leadTimeHours: input.leadTimeHours, active: input.active },
  });
  await audit({ actor: user, action: "zone.saved", entity: "CoverageZone", entityId: zone.id, after: { district: district.slug, fee: zone.deliveryFeeHalalas, lead: zone.leadTimeHours, active: zone.active }, meta });
  return zone;
}

// ───────────── admin: district rules (design pack R13) ─────────────
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const districtSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and dashes").max(40),
  nameAr: z.string().trim().min(2).max(60),
  nameEn: z.string().trim().min(2).max(60),
  restricted: z.boolean().default(false),
  restrictedReason: z.string().trim().max(200).nullish(), // Arabic (primary)
  restrictedReasonEn: z.string().trim().max(200).nullish(),
  gpsRadiusM: z.number().int().min(20).max(2000).default(100),
  deliveryStart: hhmm.default("08:00"),
  deliveryEnd: hhmm.default("22:00"),
  fridayBlackoutStart: hhmm.nullish(),
  fridayBlackoutEnd: hhmm.nullish(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(100),
});

function assertDistrictRules(v: { deliveryStart?: string; deliveryEnd?: string; fridayBlackoutStart?: string | null; fridayBlackoutEnd?: string | null; restricted?: boolean; restrictedReason?: string | null }) {
  if (v.deliveryStart && v.deliveryEnd && v.deliveryEnd <= v.deliveryStart) throw new AppError("VALIDATION", { field: "deliveryEnd" });
  if (!!v.fridayBlackoutStart !== !!v.fridayBlackoutEnd) throw new AppError("VALIDATION", { field: "fridayBlackoutEnd" });
  if (v.fridayBlackoutStart && v.fridayBlackoutEnd && v.fridayBlackoutEnd <= v.fridayBlackoutStart) throw new AppError("VALIDATION", { field: "fridayBlackoutEnd" });
  if (v.restricted && !v.restrictedReason?.trim()) throw new AppError("VALIDATION", { field: "restrictedReason" });
}

export async function createDistrict(admin: Actor, input: z.infer<typeof districtSchema>, meta: RequestMeta) {
  assertDistrictRules(input);
  try {
    const d = await db.district.create({ data: { ...input, restrictedReason: input.restrictedReason ?? null, restrictedReasonEn: input.restrictedReasonEn ?? null, fridayBlackoutStart: input.fridayBlackoutStart ?? null, fridayBlackoutEnd: input.fridayBlackoutEnd ?? null } });
    await audit({ actor: admin, action: "district.created", entity: "District", entityId: d.id, after: { slug: d.slug, restricted: d.restricted }, meta });
    return d;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("CONFLICT", { field: "slug" });
    throw e;
  }
}

export async function updateDistrict(admin: Actor, id: string, patch: Partial<z.infer<typeof districtSchema>>, meta: RequestMeta) {
  const before = await db.district.findUnique({ where: { id } });
  if (!before) throw new AppError("NOT_FOUND");
  const merged = { ...before, ...patch };
  assertDistrictRules(merged);
  const { slug: _slug, ...rest } = patch; // the slug is an identifier and never changes
  void _slug;
  const data: Prisma.DistrictUpdateInput = { ...rest, ...(merged.restricted ? {} : { restrictedReason: null, restrictedReasonEn: null }) };
  const d = await db.district.update({ where: { id }, data });
  await audit({
    actor: admin, action: "district.updated", entity: "District", entityId: id,
    before: { restricted: before.restricted, radius: before.gpsRadiusM, start: before.deliveryStart, end: before.deliveryEnd, active: before.active },
    after: { restricted: d.restricted, radius: d.gpsRadiusM, start: d.deliveryStart, end: d.deliveryEnd, active: d.active },
    meta,
  });
  // A district that becomes restricted stops being served: switch supplier zones off so search hides them at once.
  if (d.restricted && !before.restricted) await db.coverageZone.updateMany({ where: { districtId: id }, data: { active: false } });
  return d;
}
