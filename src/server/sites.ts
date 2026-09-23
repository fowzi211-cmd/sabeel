import { z } from "zod";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { normalizeSaudiMobile } from "@/lib/validate";

import { MAKKAH_BOUNDS } from "@/lib/geo";

const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const siteSchema = z.object({
  label: z.string().trim().min(1).max(80),
  districtId: z.string().min(1),
  lat: z.number().min(MAKKAH_BOUNDS.latMin).max(MAKKAH_BOUNDS.latMax),
  lng: z.number().min(MAKKAH_BOUNDS.lngMin).max(MAKKAH_BOUNDS.lngMax),
  /** Saudi National Address short code: 4 letters + 4 digits (e.g. RRRD2929). */
  nationalAddress: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}\d{4}$/, "National Address short code is 4 letters + 4 digits")
    .nullish()
    .or(z.literal("").transform(() => null)),
  landmark: optText(160),
  accessNotes: optText(300),
  recipientName: optText(80),
  recipientMobile: z.string().trim().nullish().or(z.literal("").transform(() => null)),
});
export type SiteInput = z.infer<typeof siteSchema>;

function normalizeMobile(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = normalizeSaudiMobile(v);
  if (!m) throw new AppError("MOBILE_INVALID", { field: "recipientMobile" });
  return m;
}

export const listSites = (userId: string) =>
  db.site.findMany({ where: { userId, deletedAt: null }, include: { district: true }, orderBy: { createdAt: "desc" } });

export async function createSite(user: User, input: SiteInput, meta: RequestMeta) {
  const district = await db.district.findUnique({ where: { id: input.districtId } });
  if (!district || !district.active) throw new AppError("NOT_FOUND", { field: "districtId" });
  if (district.restricted) throw new AppError("RESTRICTED_ZONE", { field: "districtId" });

  const site = await db.site.create({
    data: {
      userId: user.id,
      label: input.label,
      districtId: district.id,
      lat: input.lat,
      lng: input.lng,
      nationalAddress: input.nationalAddress ?? null,
      landmark: input.landmark,
      accessNotes: input.accessNotes,
      recipientName: input.recipientName,
      recipientMobile: normalizeMobile(input.recipientMobile),
    },
    include: { district: true },
  });
  await audit({ actor: user, action: "site.created", entity: "Site", entityId: site.id, after: { district: district.slug }, meta });
  return site;
}

export async function deleteSite(user: User, id: string, meta: RequestMeta) {
  const site = await db.site.findFirst({ where: { id, userId: user.id, deletedAt: null } });
  if (!site) throw new AppError("NOT_FOUND");
  // Soft delete: orders carry their own snapshot, but history keeps a pointer to the site.
  await db.site.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit({ actor: user, action: "site.deleted", entity: "Site", entityId: id, meta });
}
