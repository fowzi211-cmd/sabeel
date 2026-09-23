import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { adminOrderView, getAnyOrder } from "@/server/orders";

export const GET = route<{ id: string }>({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE"] }, async ({ params }) => {
  const order = await getAnyOrder(params.id);
  if (!order) throw new AppError("NOT_FOUND");
  return { order: adminOrderView(order) };
});
