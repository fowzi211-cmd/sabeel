import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { getOwnedSupplier, removeDocument } from "@/server/suppliers";

export const DELETE = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ params, current, meta }) => {
  const supplier = await getOwnedSupplier(current.user.id);
  if (!supplier) throw new AppError("NOT_FOUND");
  await removeDocument(current.user, supplier, params.id, meta);
  return { ok: true };
});
