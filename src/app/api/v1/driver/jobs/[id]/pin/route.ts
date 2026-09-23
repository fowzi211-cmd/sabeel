import { parseJson, route } from "@/lib/http";
import { pinSchema, proposePin } from "@/server/driver";

/** The driver proposes a corrected pin; the buyer's own pin is never overwritten. */
export const POST = route<{ id: string }>({ roles: ["DRIVER"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, pinSchema);
  await proposePin(current.user, params.id, input, meta);
  return { ok: true };
});
