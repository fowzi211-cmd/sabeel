import { z } from "zod";
import { Prisma, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { hasArabic } from "@/lib/validate";

type Actor = { id: string; roles: Role[] };

export const brandSchema = z.object({
  nameAr: z.string().trim().min(2).max(80).refine(hasArabic, "Arabic name is required"),
  nameEn: z.string().trim().min(2).max(80),
  // SFDA registration / listing reference — checked by an admin against the official record.
  sfdaRef: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9\-/ ]{2,39}$/, "Invalid SFDA reference"),
  notes: z.string().trim().max(500).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

export const listBrands = () => db.brand.findMany({ orderBy: [{ status: "asc" }, { nameEn: "asc" }] });

export async function createBrand(admin: Actor, input: z.infer<typeof brandSchema>, meta: RequestMeta) {
  try {
    const brand = await db.brand.create({
      data: { nameAr: input.nameAr, nameEn: input.nameEn, sfdaRef: input.sfdaRef.toUpperCase(), notes: input.notes, createdById: admin.id },
    });
    await audit({ actor: admin, action: "brand.created", entity: "Brand", entityId: brand.id, after: { nameEn: brand.nameEn, sfdaRef: brand.sfdaRef }, meta });
    return brand;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("CONFLICT", { field: "sfdaRef", message: "This SFDA reference is already registered" });
    }
    throw e;
  }
}

export async function updateBrand(admin: Actor, id: string, patch: Partial<z.infer<typeof brandSchema>>, meta: RequestMeta) {
  const before = await db.brand.findUnique({ where: { id } });
  if (!before) throw new AppError("NOT_FOUND");
  try {
    const updated = await db.brand.update({
      where: { id },
      data: {
        ...(patch.nameAr !== undefined ? { nameAr: patch.nameAr } : {}),
        ...(patch.nameEn !== undefined ? { nameEn: patch.nameEn } : {}),
        ...(patch.sfdaRef !== undefined ? { sfdaRef: patch.sfdaRef.toUpperCase() } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes || null } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      },
    });
    await audit({
      actor: admin,
      action: patch.status && patch.status !== before.status ? `brand.${patch.status === "SUSPENDED" ? "suspended" : "reactivated"}` : "brand.updated",
      entity: "Brand",
      entityId: id,
      before: { nameEn: before.nameEn, sfdaRef: before.sfdaRef, status: before.status },
      after: { nameEn: updated.nameEn, sfdaRef: updated.sfdaRef, status: updated.status },
      meta,
    });
    return updated;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("CONFLICT", { field: "sfdaRef", message: "This SFDA reference is already registered" });
    }
    throw e;
  }
}
