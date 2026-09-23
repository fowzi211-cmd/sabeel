import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { buyerOrderView, getBuyerOrder } from "@/server/orders";

export const GET = route<{ id: string }>({}, async ({ params, current }) => {
  const order = await getBuyerOrder(current.user.id, params.id);
  if (!order) throw new AppError("NOT_FOUND"); // also the answer for someone else's order
  return { order: buyerOrderView(order) };
});
