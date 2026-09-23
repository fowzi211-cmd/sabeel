import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { hasRole, isAdmin } from "@/lib/session";
import { readUpload } from "@/server/storage";

/**
 * Delivery photos are private. Readable by: the order's buyer, the supplier that fulfilled it, the driver who
 * took them, and operations/support staff. Anyone else gets "not found" so existence is not revealed.
 */
export const GET = route<{ id: string }>({}, async ({ params, current, meta }) => {
  const photo = await db.proofPhoto.findUnique({
    where: { id: params.id },
    include: { delivery: { include: { order: { select: { id: true, buyerId: true, supplierId: true } }, driver: { select: { userId: true } } } } },
  });
  if (!photo) throw new AppError("NOT_FOUND");
  const { user } = current;
  const o = photo.delivery.order;
  const staff = isAdmin(user.roles) && hasRole(user.roles, "ADMIN_OPS", "ADMIN_SUPPORT");
  let allowed = staff || o.buyerId === user.id || photo.delivery.driver.userId === user.id;
  if (!allowed) allowed = !!(await db.supplierMember.findFirst({ where: { supplierId: o.supplierId, userId: user.id } }));
  if (!allowed) throw new AppError("NOT_FOUND");
  if (staff) await audit({ actor: user, action: "proof_photo.viewed", entity: "ProofPhoto", entityId: photo.id, meta });

  const bytes = await readUpload(photo.fileKey).catch(() => {
    throw new AppError("NOT_FOUND");
  });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": photo.mime,
      "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
    },
  });
});
