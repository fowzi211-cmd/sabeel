import { parseJson, route } from "@/lib/http";
import { failDelivery, failSchema } from "@/server/driver";

/** T10: the delivery did not happen. Needs a reason and a photo taken at the door. */
export const POST = route<{ id: string }>({ roles: ["DRIVER"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, failSchema);
  return failDelivery(current.user, params.id, input, meta);
});
