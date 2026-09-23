import { z } from "zod";
import { parseJson, route } from "@/lib/http";
import { buyerOrderView, cancelOrder, getBuyerOrder } from "@/server/orders";
import { AppError } from "@/lib/errors";

const schema = z.object({ reason: z.string().trim().max(300).optional() });

export const POST = route<{ id: string }>({}, async ({ req, params, current, meta }) => {
  const { reason } = await parseJson(req, schema);
  await cancelOrder(current.user, params.id, reason, meta);
  const order = await getBuyerOrder(current.user.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: buyerOrderView(order) };
});
