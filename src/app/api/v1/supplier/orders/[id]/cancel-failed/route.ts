import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { ownedSupplier, supplierCancelFailed } from "@/server/fulfilment";
import { getSupplierOrder, supplierOrderView } from "@/server/orders";

const schema = z.object({ reason: z.string().trim().min(2).max(300) });

export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const { reason } = await parseJson(req, schema);
  const supplier = await ownedSupplier(current.user.id);
  await supplierCancelFailed(current.user, supplier, params.id, reason, meta);
  const order = await getSupplierOrder(supplier.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: supplierOrderView(order) };
});
