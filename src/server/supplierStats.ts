import { db } from "@/lib/db";
import { RATE_WINDOW_DAYS, acceptanceRate, countsAgainstSupplier, disputeRate } from "@/lib/rates";

export interface SupplierRates {
  acceptancePct: number | null;
  acceptanceCount: number;
  disputePct: number | null;
  disputeCount: number; // delivered orders the dispute rate is over
}

/** Design pack R08 acceptance and dispute rates, last 90 days, batched for many suppliers in two queries. */
export async function supplierRates(supplierIds: string[], now: Date = new Date()): Promise<Map<string, SupplierRates>> {
  const out = new Map<string, SupplierRates>();
  if (supplierIds.length === 0) return out;
  const since = new Date(now.getTime() - RATE_WINDOW_DAYS * 86_400_000);

  const [allocations, deliveries] = await Promise.all([
    db.orderAllocation.findMany({
      where: { supplierId: { in: supplierIds }, offeredAt: { gte: since, lte: now }, status: { in: ["ACCEPTED", "DECLINED", "EXPIRED"] } },
      select: { supplierId: true, status: true },
    }),
    db.delivery.findMany({
      where: { status: "DELIVERED", deliveredAt: { gte: since, lte: now }, order: { supplierId: { in: supplierIds } } },
      select: { order: { select: { supplierId: true, disputes: { select: { category: true, outcome: true } } } } },
    }),
  ]);

  for (const id of supplierIds) {
    const a = { accepted: 0, declined: 0, expired: 0 };
    for (const r of allocations) {
      if (r.supplierId !== id) continue;
      if (r.status === "ACCEPTED") a.accepted++;
      else if (r.status === "DECLINED") a.declined++;
      else a.expired++;
    }
    const mine = deliveries.filter((d) => d.order.supplierId === id);
    const disputed = mine.filter((d) => d.order.disputes.some(countsAgainstSupplier)).length;
    const acc = acceptanceRate(a);
    const dis = disputeRate(mine.length, disputed);
    out.set(id, { acceptancePct: acc.pct, acceptanceCount: acc.count, disputePct: dis.pct, disputeCount: dis.count });
  }
  return out;
}
