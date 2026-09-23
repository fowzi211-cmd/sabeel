import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { buyerOrderView, getBuyerOrder } from "@/server/orders";
import { submitReview, submitReviewSchema } from "@/server/reviews";

/** The buyer leaves one review per order, once delivery is confirmed and inside the submission window. */
export const POST = route<{ id: string }>({}, async ({ req, params, current, meta }) => {
  const form = await req.formData().catch(() => {
    throw new AppError("BAD_REQUEST");
  });
  const input = submitReviewSchema.parse({
    stars: Number(form.get("stars")),
    timeliness: form.get("timeliness") ? Number(form.get("timeliness")) : undefined,
    asOrdered: form.get("asOrdered") ? Number(form.get("asOrdered")) : undefined,
    packaging: form.get("packaging") ? Number(form.get("packaging")) : undefined,
    driverConduct: form.get("driverConduct") ? Number(form.get("driverConduct")) : undefined,
    value: form.get("value") ? Number(form.get("value")) : undefined,
    comment: form.get("comment") || undefined,
  });
  const file = form.get("file");
  await submitReview(current.user, params.id, input, file instanceof File && file.size > 0 ? file : null, meta);
  const order = await getBuyerOrder(current.user.id, params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: buyerOrderView(order) };
});
