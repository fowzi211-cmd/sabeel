import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { adminCancelOrder } from "@/server/fulfilment";
import { adminOrderView, getAnyOrder } from "@/server/orders";

const schema = z.object({ reason: z.string().trim().min(2).max(300) });

export const POST = route<{ id: string }>({ roles: ["ADMIN_OPS"] }, async ({ req, params, current, meta }) => {
  const { reason } = await parseJson(req, schema);
  await adminCancelOrder(current.user, params.id, reason, meta);
  const order = await getAnyOrder(params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: adminOrderView(order) };
});
