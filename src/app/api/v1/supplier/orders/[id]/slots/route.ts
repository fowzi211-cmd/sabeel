import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { generateSlots } from "@/server/delivery";
import { ownedSupplier } from "@/server/fulfilment";

/** Windows this supplier can offer for the order's district right now — used when rescheduling. */
export const GET = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ params, current }) => {
  const supplier = await ownedSupplier(current.user.id);
  const order = await db.order.findFirst({ where: { id: params.id, supplierId: supplier.id } });
  if (!order) throw new AppError("NOT_FOUND");
  const [zone, district] = await Promise.all([
    db.coverageZone.findFirst({ where: { supplierId: supplier.id, districtId: order.districtId, active: true } }),
    db.district.findUnique({ where: { id: order.districtId } }),
  ]);
  if (!zone || !district) return { slots: [] };
  const slots = generateSlots({ now: new Date(), rules: district, leadHours: zone.leadTimeHours });
  return { slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) };
});
