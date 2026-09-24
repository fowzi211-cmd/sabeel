import { db } from "@/lib/db";
import { ON_TIME_WINDOW_DAYS, onTimePercent, type DeliverySample } from "@/lib/ontime";

/** One query for every supplier on the offer list; suppliers with too few recent deliveries map to pct: null. */
export async function supplierOnTimeSummaries(supplierIds: string[], now: Date = new Date()): Promise<Map<string, { pct: number | null; count: number }>> {
  const out = new Map<string, { pct: number | null; count: number }>();
  if (supplierIds.length === 0) return out;
  const rows = await db.delivery.findMany({
    where: {
      status: "DELIVERED",
      deliveredAt: { gte: new Date(now.getTime() - ON_TIME_WINDOW_DAYS * 86_400_000), lte: now },
      order: { supplierId: { in: supplierIds } },
    },
    select: { deliveredAt: true, order: { select: { supplierId: true, windowEnd: true } } },
  });
  const by = new Map<string, DeliverySample[]>();
  for (const r of rows) {
    if (!r.deliveredAt) continue;
    const list = by.get(r.order.supplierId) ?? [];
    list.push({ deliveredAt: r.deliveredAt, windowEnd: r.order.windowEnd });
    by.set(r.order.supplierId, list);
  }
  for (const id of supplierIds) out.set(id, onTimePercent(by.get(id) ?? [], now));
  return out;
}
