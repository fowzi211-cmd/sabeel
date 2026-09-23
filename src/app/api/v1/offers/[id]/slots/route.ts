import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { generateSlots } from "@/server/delivery";

/** Bookable delivery windows for one offer's supplier in one district (lead time + district rules applied). */
export const GET = route<{ id: string }>({}, async ({ req, params }) => {
  const districtId = req.nextUrl.searchParams.get("districtId");
  if (!districtId) throw new AppError("VALIDATION", { field: "districtId" });

  const [offer, district] = await Promise.all([
    db.offer.findUnique({ where: { id: params.id }, select: { supplierId: true, active: true } }),
    db.district.findUnique({ where: { id: districtId } }),
  ]);
  if (!offer || !offer.active || !district) throw new AppError("NOT_FOUND");
  if (district.restricted || !district.active) throw new AppError("RESTRICTED_ZONE");
  const zone = await db.coverageZone.findUnique({ where: { supplierId_districtId: { supplierId: offer.supplierId, districtId } } });
  if (!zone || !zone.active) throw new AppError("NOT_SERVED");

  const slots = generateSlots({ now: new Date(), rules: district, leadHours: zone.leadTimeHours });
  return { slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) };
});
