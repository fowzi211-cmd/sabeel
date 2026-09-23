import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { hasRole, isAdmin } from "@/lib/session";
import { readUpload } from "@/server/storage";

/** Supplier documents are sensitive: only the owning supplier and staff can read them. */
export const GET = route<{ id: string }>({}, async ({ params, current, meta }) => {
  const doc = await db.supplierDocument.findUnique({ where: { id: params.id } });
  if (!doc) throw new AppError("NOT_FOUND");

  const { user } = current;
  const staff = isAdmin(user.roles) && hasRole(user.roles, "ADMIN_OPS", "ADMIN_SUPPORT");
  if (!staff) {
    const member = await db.supplierMember.findFirst({ where: { supplierId: doc.supplierId, userId: user.id } });
    if (!member) throw new AppError("NOT_FOUND"); // do not reveal that the file exists
  } else {
    await audit({ actor: user, action: "document.viewed", entity: "SupplierDocument", entityId: doc.id, meta });
  }

  const bytes = await readUpload(doc.fileKey).catch(() => {
    throw new AppError("NOT_FOUND");
  });
  const asciiName = doc.originalName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
});
