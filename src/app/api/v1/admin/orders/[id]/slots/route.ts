import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { generateSlots } from "@/server/delivery";

/** Windows the order's current supplier can still offer for its district — used when admin redelivers after a dispute. */
export const GET = route<{ id: string }>({ roles: ["ADMIN_OPS"] }, async ({ params }) => {
  const order = await db.order.findFirst({ where: { OR: [{ id: params.id }, { orderNo: params.id }] } });
  if (!order) throw new AppError("NOT_FOUND");
  const [zone, district] = await Promise.all([
    db.coverageZone.findFirst({ where: { supplierId: order.supplierId, districtId: order.districtId, active: true } }),
    db.district.findUnique({ where: { id: order.districtId } }),
  ]);
  if (!zone || !district) return { slots: [] };
  const slots = generateSlots({ now: new Date(), rules: district, leadHours: zone.leadTimeHours });
  return { slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) };
});
