import { z } from "zod";
import { parseJson, route } from "@/lib/http";
import { setStaffRoles } from "@/server/users";

const schema = z.object({ roles: z.array(z.enum(["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE", "SUPER_ADMIN"])) });

export const POST = route<{ id: string }>({ roles: ["SUPER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const { roles } = await parseJson(req, schema);
  const user = await setStaffRoles(current.user, params.id, roles, meta);
  return { user: { id: user.id, roles: user.roles } };
});
