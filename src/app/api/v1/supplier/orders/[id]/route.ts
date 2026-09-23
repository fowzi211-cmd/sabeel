import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { getSupplierOrder, supplierOrderView } from "@/server/orders";

export const GET = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ params, current }) => {
  const supplier = await db.supplier.findFirst({ where: { members: { some: { userId: current.user.id, role: "OWNER" } } } });
  if (!supplier) throw new AppError("NOT_FOUND");
  const order = await getSupplierOrder(supplier.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: supplierOrderView(order) };
});
