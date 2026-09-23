import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { coverageOverview, requireLiveSupplier, upsertZone, zoneSchema } from "@/server/catalogue";

export const GET = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ current }) => {
  const supplier = await db.supplier.findFirst({ where: { members: { some: { userId: current.user.id, role: "OWNER" } } } });
  if (!supplier) throw new AppError("NOT_FOUND");
  const overview = await coverageOverview(supplier.id);
  return {
    districts: overview.map(({ district, zone }) => ({
      id: district.id, slug: district.slug, nameAr: district.nameAr, nameEn: district.nameEn,
      restricted: district.restricted, restrictedReason: district.restricted ? district.restrictedReason : null, restrictedReasonEn: district.restricted ? district.restrictedReasonEn : null,
      zone: zone && { deliveryFeeHalalas: zone.deliveryFeeHalalas, leadTimeHours: zone.leadTimeHours, active: zone.active },
    })),
  };
});

/** Save (create or update) one district's coverage. Restricted districts cannot be served. */
export const PUT = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, current, meta }) => {
  const input = await parseJson(req, zoneSchema);
  const supplier = await requireLiveSupplier(current.user.id);
  return { zone: await upsertZone(current.user, supplier, input, meta) };
});
