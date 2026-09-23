import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { buyerOrderView, getBuyerOrder } from "@/server/orders";
import { openDeliveryDispute, reportProblemSchema } from "@/server/payments";

/** T15: the buyer reports a problem with the delivery (not delivered, short, wrong brand, damaged, late). */
export const POST = route<{ id: string }>({}, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, reportProblemSchema);
  await openDeliveryDispute(current.user, params.id, input, meta);
  const order = await getBuyerOrder(current.user.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: buyerOrderView(order) };
});
