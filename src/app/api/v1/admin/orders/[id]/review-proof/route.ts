import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { reviewProof, reviewSchema } from "@/server/fulfilment";
import { adminOrderView, getAnyOrder } from "@/server/orders";

/** Pilot rule: an admin reviews the evidence of each delivery and records the verdict. */
export const POST = route<{ id: string }>({ roles: ["ADMIN_OPS"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, reviewSchema);
  await reviewProof(current.user, params.id, input, meta);
  const order = await getAnyOrder(params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: adminOrderView(order) };
});
