import { z } from "zod";
import { route } from "@/lib/http";
import { adminOrderView, listAllOrders } from "@/server/orders";

const statuses = ["AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED", "OUT_FOR_DELIVERY", "FAILED_ATTEMPT", "DELIVERED_DRIVER_CONFIRMED", "ADMIN_REVIEW", "CONFIRMED_BY_BOTH", "PAID", "CLOSED", "DECLINED", "EXPIRED", "ESCALATED", "DISPUTED", "CANCELLED"] as const;

/** `?status=` filters by status; `?attention=1` lists orders that need a human (escalated, failed, overdue, unreviewed proof). */
export const GET = route({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE"] }, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const status = z.enum(statuses).optional().parse(sp.get("status") ?? undefined);
  const attention = sp.get("attention") === "1";
  const cursor = sp.get("cursor") ?? undefined;
  const { items, nextCursor } = await listAllOrders({ status, attention }, { cursor });
  return { orders: items.map(adminOrderView), nextCursor };
});
