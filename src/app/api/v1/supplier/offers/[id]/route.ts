import { parseJson, route } from "@/lib/http";
import { deleteOffer, offerPatchSchema, requireLiveSupplier, updateOffer } from "@/server/catalogue";

export const PATCH = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const patch = await parseJson(req, offerPatchSchema);
  const supplier = await requireLiveSupplier(current.user.id);
  return { offer: await updateOffer(current.user, supplier, params.id, patch, meta) };
});

export const DELETE = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ params, current, meta }) => {
  const supplier = await requireLiveSupplier(current.user.id);
  await deleteOffer(current.user, supplier, params.id, meta);
  return { ok: true };
});
