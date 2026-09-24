import { parseJson, route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { flagReview, flagReviewSchema } from "@/server/reviews";

/** The supplier reports a review to admin. It stays visible until an admin decides. */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const supplier = await ownedSupplier(current.user.id);
  const input = await parseJson(req, flagReviewSchema);
  const flag = await flagReview(current.user, supplier, params.id, input, meta);
  return { flag };
});
