import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { buyerOrderView, getBuyerOrder } from "@/server/orders";
import { markPaid, markPaidSchema } from "@/server/payments";

/** The buyer paid the supplier directly (bank transfer) and tells us — an optional receipt is just evidence. */
export const POST = route<{ id: string }>({}, async ({ req, params, current, meta }) => {
  const form = await req.formData().catch(() => {
    throw new AppError("BAD_REQUEST");
  });
  const input = markPaidSchema.parse({ paymentDate: form.get("paymentDate"), bankReference: form.get("bankReference") });
  const file = form.get("file");
  await markPaid(current.user, params.id, input, file instanceof File && file.size > 0 ? file : null, meta);
  const order = await getBuyerOrder(current.user.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: buyerOrderView(order) };
});
