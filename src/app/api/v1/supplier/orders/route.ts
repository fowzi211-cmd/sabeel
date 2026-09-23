import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { listSupplierOrders, supplierOrderView } from "@/server/orders";

const status = z.enum(["AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED_DRIVER_CONFIRMED", "CONFIRMED_BY_BOTH", "PAID", "CLOSED", "CANCELLED"]).optional();

export const GET = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, current }) => {
  const supplier = await db.supplier.findFirst({ where: { members: { some: { userId: current.user.id, role: "OWNER" } } } });
  if (!supplier) throw new AppError("NOT_FOUND");
  const s = status.parse(req.nextUrl.searchParams.get("status") ?? undefined);
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const { items, nextCursor } = await listSupplierOrders(supplier.id, s, { cursor });
  return { orders: items.map(supplierOrderView), nextCursor };
});
