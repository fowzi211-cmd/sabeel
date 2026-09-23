import { parseJson, route } from "@/lib/http";
import { brandSchema, updateBrand } from "@/server/brands";

export const PATCH = route<{ id: string }>({ roles: ["ADMIN_OPS"] }, async ({ req, params, current, meta }) => {
  const patch = await parseJson(req, brandSchema.partial());
  return { brand: await updateBrand(current.user, params.id, patch, meta) };
});
