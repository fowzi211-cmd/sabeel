import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { reallocateEscalated } from "@/server/fulfilment";
import { adminOrderView, getAnyOrder } from "@/server/orders";

const schema = z.object({ supplierId: z.string().min(1).optional() });

/** Offer an escalated order to the best eligible supplier, or to the one the admin picked. */
export const POST = route<{ id: string }>({ roles: ["ADMIN_OPS"] }, async ({ req, params, current, meta }) => {
  const { supplierId } = await parseJson(req, schema);
  await reallocateEscalated(params.id, current.user, { supplierId, meta });
  const order = await getAnyOrder(params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: adminOrderView(order) };
});
