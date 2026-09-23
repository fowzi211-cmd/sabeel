import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { safeSupplier } from "@/server/serialize";
import { getOwnedSupplier, submitApplication } from "@/server/suppliers";

export const POST = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ current, meta }) => {
  const supplier = await getOwnedSupplier(current.user.id);
  if (!supplier) throw new AppError("NOT_FOUND");
  const updated = await submitApplication(current.user, supplier, meta);
  return { supplier: safeSupplier(updated) };
});
