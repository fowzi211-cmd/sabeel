import { parseJson, route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { replyToReview, replyToReviewSchema } from "@/server/reviews";

/** The supplier's one and only reply to a review — never editable afterwards. */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const supplier = await ownedSupplier(current.user.id);
  const input = await parseJson(req, replyToReviewSchema);
  const reply = await replyToReview(current.user, supplier, params.id, input, meta);
  return { reply };
});
