import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { hasRole, isAdmin } from "@/lib/session";
import { readUpload } from "@/server/storage";

/** The photo a buyer attached to their review — private to the order's buyer, supplier and staff. */
export const GET = route<{ id: string }>({}, async ({ params, current }) => {
  const order = await db.order.findFirst({ where: { OR: [{ id: params.id }, { orderNo: params.id }] }, include: { review: true } });
  if (!order?.review?.photoFileKey) throw new AppError("NOT_FOUND");

  const { user } = current;
  const staff = isAdmin(user.roles) && hasRole(user.roles, "ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE");
  let allowed = staff || order.buyerId === user.id;
  if (!allowed) allowed = !!(await db.supplierMember.findFirst({ where: { supplierId: order.supplierId, userId: user.id } }));
  if (!allowed) throw new AppError("NOT_FOUND");

  const bytes = await readUpload(order.review.photoFileKey).catch(() => {
    throw new AppError("NOT_FOUND");
  });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": order.review.photoMime ?? "application/octet-stream",
      "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
    },
  });
});
