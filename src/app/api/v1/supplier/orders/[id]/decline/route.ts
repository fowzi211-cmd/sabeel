import { parseJson, route } from "@/lib/http";
import { declineOrder, declineSchema, ownedSupplier } from "@/server/fulfilment";

/** T03: declining needs a reason; the order is offered to the next eligible supplier straight away. */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, declineSchema);
  const supplier = await ownedSupplier(current.user.id);
  const outcome = await declineOrder(current.user, supplier, params.id, input, meta);
  return { ok: true, outcome };
});
