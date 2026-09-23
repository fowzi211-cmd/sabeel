import { parseJson, route } from "@/lib/http";
import { brandSchema, createBrand, listBrands } from "@/server/brands";

export const GET = route({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] }, async () => ({ brands: await listBrands() }));

export const POST = route({ roles: ["ADMIN_OPS"] }, async ({ req, current, meta }) => {
  const input = await parseJson(req, brandSchema);
  return { brand: await createBrand(current.user, input, meta) };
});
