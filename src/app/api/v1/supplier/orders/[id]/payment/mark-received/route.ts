import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { getSupplierOrder, supplierOrderView } from "@/server/orders";
import { markReceived } from "@/server/payments";

/** T17: the supplier confirms the buyer's payment arrived. The order closes to PAID and the buyer's paid count grows. */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ params, current, meta }) => {
  const supplier = await ownedSupplier(current.user.id);
  await markReceived(current.user, supplier, params.id, meta);
  const order = await getSupplierOrder(supplier.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: supplierOrderView(order) };
});
