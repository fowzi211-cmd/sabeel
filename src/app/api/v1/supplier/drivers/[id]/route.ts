import { parseJson, route } from "@/lib/http";
import { driverPatchSchema, updateDriver } from "@/server/drivers";
import { ownedSupplier } from "@/server/fulfilment";

export const PATCH = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const patch = await parseJson(req, driverPatchSchema);
  const supplier = await ownedSupplier(current.user.id);
  await updateDriver(current.user, supplier, params.id, patch, meta);
  return { ok: true };
});
