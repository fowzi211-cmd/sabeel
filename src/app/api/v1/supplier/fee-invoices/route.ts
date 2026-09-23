import { z } from "zod";
import { route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { listSupplierInvoices } from "@/server/fees";

const statuses = ["ISSUED", "PAYMENT_SUBMITTED", "PAID", "OVERDUE"] as const;

/** The supplier's fee-invoices list, mirroring the shape of /supplier/payments. */
export const GET = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, current }) => {
  const sp = req.nextUrl.searchParams;
  const status = z.enum(statuses).optional().parse(sp.get("status") ?? undefined);
  const q = sp.get("q")?.trim() || undefined;
  const cursor = sp.get("cursor") ?? undefined;
  const supplier = await ownedSupplier(current.user.id);
  const { items: invoices, nextCursor } = await listSupplierInvoices(supplier.id, { status, q }, { cursor });
  return { invoices, nextCursor };
});
