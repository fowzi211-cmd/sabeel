import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { hasRole, isAdmin } from "@/lib/session";
import { readUpload } from "@/server/storage";

/** The photo a supplier attached to its dispute response — private to the order's buyer, supplier and staff. */
export const GET = route<{ id: string }>({}, async ({ params, current }) => {
  const dispute = await db.dispute.findUnique({ where: { id: params.id }, include: { order: { select: { buyerId: true, supplierId: true } } } });
  if (!dispute?.responseFileKey) throw new AppError("NOT_FOUND");

  const { user } = current;
  const staff = isAdmin(user.roles) && hasRole(user.roles, "ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE");
  let allowed = staff || dispute.order.buyerId === user.id;
  if (!allowed) allowed = !!(await db.supplierMember.findFirst({ where: { supplierId: dispute.order.supplierId, userId: user.id } }));
  if (!allowed) throw new AppError("NOT_FOUND");

  const bytes = await readUpload(dispute.responseFileKey).catch(() => {
    throw new AppError("NOT_FOUND");
  });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": dispute.responseMime ?? "application/octet-stream",
      "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
    },
  });
});
