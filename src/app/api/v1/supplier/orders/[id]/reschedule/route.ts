import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { ownedSupplier, rescheduleOrder, rescheduleSchema } from "@/server/fulfilment";
import { getSupplierOrder, supplierOrderView } from "@/server/orders";

/** T11: after a failed trip, pick a new window (and maybe another driver). Limited attempts. */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, rescheduleSchema);
  const supplier = await ownedSupplier(current.user.id);
  await rescheduleOrder(current.user, supplier, params.id, input, meta);
  const order = await getSupplierOrder(supplier.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: supplierOrderView(order) };
});
