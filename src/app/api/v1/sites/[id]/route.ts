import { route } from "@/lib/http";
import { deleteSite } from "@/server/sites";

export const DELETE = route<{ id: string }>({}, async ({ params, current, meta }) => {
  await deleteSite(current.user, params.id, meta);
  return { ok: true };
});
