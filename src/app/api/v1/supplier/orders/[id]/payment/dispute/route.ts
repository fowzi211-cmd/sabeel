import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { getSupplierOrder, supplierOrderView } from "@/server/orders";
import { nonPaymentSchema, openNonPaymentDispute } from "@/server/payments";

/** The supplier reports non-payment. This pauses only the PaymentRecord — the order stays as it is. */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, nonPaymentSchema);
  const supplier = await ownedSupplier(current.user.id);
  await openNonPaymentDispute(current.user, supplier, params.id, input, meta);
  const order = await getSupplierOrder(supplier.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: supplierOrderView(order) };
});
