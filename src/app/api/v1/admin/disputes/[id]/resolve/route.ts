import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { adminOrderView, getAnyOrder } from "@/server/orders";
import { resolveDispute, resolveDisputeSchema } from "@/server/payments";

/** T16: admin decides a dispute — redeliver, adjust the price, cancel, dismiss, or settle a payment claim. */
export const POST = route<{ id: string }>({ roles: ["ADMIN_OPS"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, resolveDisputeSchema);
  const dispute = await db.dispute.findUnique({ where: { id: params.id }, select: { orderId: true } });
  if (!dispute) throw new AppError("NOT_FOUND");
  await resolveDispute(current.user, params.id, input, meta);
  const order = await getAnyOrder(dispute.orderId);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: adminOrderView(order) };
});
