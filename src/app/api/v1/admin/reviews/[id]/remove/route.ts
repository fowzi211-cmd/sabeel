import { parseJson, route } from "@/lib/http";
import { removeReview, removeReviewSchema } from "@/server/reviews";

/** Admin-only takedown (abuse, off-topic, policy violation) — the review stays in the record, only hidden. */
export const POST = route<{ id: string }>({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, removeReviewSchema);
  await removeReview(current.user, params.id, input, meta);
  return { ok: true };
});
