import { parseJson, route } from "@/lib/http";
import { confirmDelivery, confirmSchema } from "@/server/driver";

/** T09: submit the proof. Server-side rules decide whether it is complete; nothing here trusts the app. */
export const POST = route<{ id: string }>({ roles: ["DRIVER"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, confirmSchema);
  return confirmDelivery(current.user, params.id, input, meta);
});
