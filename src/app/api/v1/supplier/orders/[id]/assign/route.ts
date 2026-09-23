import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { assignDriver, assignSchema, ownedSupplier } from "@/server/fulfilment";
import { getSupplierOrder, supplierOrderView } from "@/server/orders";

/** T07: give an accepted order to one of the supplier's own active drivers (or change the driver before the trip starts). */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const { driverId } = await parseJson(req, assignSchema);
  const supplier = await ownedSupplier(current.user.id);
  await assignDriver(current.user, supplier, params.id, driverId, meta);
  const order = await getSupplierOrder(supplier.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: supplierOrderView(order) };
});
