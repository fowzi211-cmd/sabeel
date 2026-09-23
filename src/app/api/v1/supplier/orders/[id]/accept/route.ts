import { route } from "@/lib/http";
import { acceptOrder, ownedSupplier } from "@/server/fulfilment";
import { AppError } from "@/lib/errors";
import { getSupplierOrder, supplierOrderView } from "@/server/orders";

/** T02: the supplier takes the order. Recipient details are revealed from this moment. */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ params, current, meta }) => {
  const supplier = await ownedSupplier(current.user.id);
  await acceptOrder(current.user, supplier, params.id, meta);
  const order = await getSupplierOrder(supplier.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: supplierOrderView(order) };
});
