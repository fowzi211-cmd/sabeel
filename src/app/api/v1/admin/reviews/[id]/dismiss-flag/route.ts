import { parseJson, route } from "@/lib/http";
import { dismissFlagSchema, dismissReviewFlag } from "@/server/reviews";

/** Admin keeps a flagged review published and tells the supplier why. (Removing it uses the existing remove route.) */
export const POST = route<{ id: string }>({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, dismissFlagSchema);
  await dismissReviewFlag(current.user, params.id, input, meta);
  return { ok: true };
});
