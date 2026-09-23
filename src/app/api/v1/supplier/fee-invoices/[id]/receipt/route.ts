import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { hasRole, isAdmin } from "@/lib/session";
import { readUpload } from "@/server/storage";

/** The bank-transfer receipt a supplier attached to a fee-invoice payment — private to that supplier and staff. */
export const GET = route<{ id: string }>({}, async ({ params, current }) => {
  const invoice = await db.feeInvoice.findUnique({ where: { id: params.id } });
  if (!invoice?.receiptFileKey) throw new AppError("NOT_FOUND");

  const { user } = current;
  const staff = isAdmin(user.roles) && hasRole(user.roles, "ADMIN_OPS", "ADMIN_FINANCE");
  let allowed = staff;
  if (!allowed) allowed = !!(await db.supplierMember.findFirst({ where: { supplierId: invoice.supplierId, userId: user.id } }));
  if (!allowed) throw new AppError("NOT_FOUND");

  const bytes = await readUpload(invoice.receiptFileKey).catch(() => {
    throw new AppError("NOT_FOUND");
  });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": invoice.receiptMime ?? "application/octet-stream",
      "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
    },
  });
});
