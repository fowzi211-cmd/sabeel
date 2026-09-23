import { route } from "@/lib/http";
import { resetUserTotp } from "@/server/users";

export const POST = route<{ id: string }>({ roles: ["SUPER_ADMIN"] }, async ({ params, current, meta }) => {
  await resetUserTotp(current.user, params.id, meta);
  return { ok: true };
});
