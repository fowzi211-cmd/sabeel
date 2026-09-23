import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { getSupplierOrder, supplierOrderView } from "@/server/orders";
import { markNotReceived, notReceivedSchema } from "@/server/payments";

/** The buyer said "I have paid" but the supplier has not actually received it — sends the payment back to DUE/OVERDUE. */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, notReceivedSchema);
  const supplier = await ownedSupplier(current.user.id);
  await markNotReceived(current.user, supplier, params.id, input, meta);
  const order = await getSupplierOrder(supplier.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: supplierOrderView(order) };
});
