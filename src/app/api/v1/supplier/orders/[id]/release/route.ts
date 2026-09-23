import { parseJson, route } from "@/lib/http";
import { declineSchema, ownedSupplier, releaseOrder } from "@/server/fulfilment";

/** After accepting: hand the order back (before the trip starts) so the buyer is re-routed, not left waiting. */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, declineSchema);
  const supplier = await ownedSupplier(current.user.id);
  const outcome = await releaseOrder(current.user, supplier, params.id, input, meta);
  return { ok: true, outcome };
});
