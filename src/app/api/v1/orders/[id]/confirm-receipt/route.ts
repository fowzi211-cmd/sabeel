import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { buyerOrderView, getBuyerOrder } from "@/server/orders";
import { confirmReceipt } from "@/server/payments";

/** T12: the buyer confirms the delivery. Reveals the supplier's bank details and starts the 3-day payment clock. */
export const POST = route<{ id: string }>({}, async ({ params, current, meta }) => {
  await confirmReceipt(current.user, params.id, meta);
  const order = await getBuyerOrder(current.user.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: buyerOrderView(order) };
});
