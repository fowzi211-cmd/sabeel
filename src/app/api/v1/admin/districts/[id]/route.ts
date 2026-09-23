import { parseJson, route } from "@/lib/http";
import { districtSchema, updateDistrict } from "@/server/catalogue";

export const PATCH = route<{ id: string }>({ roles: ["ADMIN_OPS"] }, async ({ req, params, current, meta }) => {
  const patch = await parseJson(req, districtSchema.partial());
  return { district: await updateDistrict(current.user, params.id, patch, meta) };
});
