import { parseJson, route } from "@/lib/http";
import { createDistrict, districtSchema, listDistricts } from "@/server/catalogue";

export const GET = route({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] }, async () => ({
  districts: await listDistricts({ includeInactive: true }),
}));

export const POST = route({ roles: ["ADMIN_OPS"] }, async ({ req, current, meta }) => {
  const input = await parseJson(req, districtSchema);
  return { district: await createDistrict(current.user, input, meta) };
});
