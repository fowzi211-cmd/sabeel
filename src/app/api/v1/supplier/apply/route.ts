import { parseJson, route } from "@/lib/http";
import { safeSupplier } from "@/server/serialize";
import { applyAsSupplier, applySchema } from "@/server/suppliers";

export const POST = route({}, async ({ req, current, meta }) => {
  const input = await parseJson(req, applySchema);
  const supplier = await applyAsSupplier(current.user, input, meta);
  // The account now holds the SUPPLIER_ADMIN role, so two-step verification is required from here on.
  return { supplier: safeSupplier(supplier), next: "/2fa?setup=1" };
});
