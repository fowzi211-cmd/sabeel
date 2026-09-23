import { route } from "@/lib/http";
import { revokeCurrentSession } from "@/lib/session";

export const POST = route({ allowMfaPending: true }, async () => {
  await revokeCurrentSession();
  return { ok: true };
});
