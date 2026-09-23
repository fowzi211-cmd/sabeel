import { route, parseJson } from "@/lib/http";
import { createStaffUser, listUsers, staffSchema } from "@/server/users";

export const GET = route({ roles: ["SUPER_ADMIN"] }, async ({ req }) => ({
  users: await listUsers(req.nextUrl.searchParams.get("q") ?? undefined),
}));

export const POST = route({ roles: ["SUPER_ADMIN"] }, async ({ req, current, meta }) => {
  const input = await parseJson(req, staffSchema);
  const user = await createStaffUser(current.user, input, meta);
  return { user: { id: user.id, mobile: user.mobile, name: user.name, roles: user.roles } };
});
