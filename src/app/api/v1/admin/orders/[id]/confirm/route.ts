import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { adminOrderView, getAnyOrder } from "@/server/orders";
import { adminConfirmSilence } from "@/server/payments";

const schema = z.object({ note: z.string().trim().min(2).max(500) });

/** T14: the buyer never responded within 72 h — an admin confirms the delivery on the evidence on file. */
export const POST = route<{ id: string }>({ roles: ["ADMIN_OPS"] }, async ({ req, params, current, meta }) => {
  const { note } = await parseJson(req, schema);
  await adminConfirmSilence(current.user, params.id, note, meta);
  const order = await getAnyOrder(params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: adminOrderView(order) };
});
