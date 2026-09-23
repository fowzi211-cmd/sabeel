import { z } from "zod";
import { route } from "@/lib/http";
import { listAdminInvoices } from "@/server/fees";

const statuses = ["ISSUED", "PAYMENT_SUBMITTED", "PAID", "OVERDUE"] as const;

export const GET = route({ roles: ["ADMIN_OPS", "ADMIN_FINANCE"] }, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const status = z.enum(statuses).optional().parse(sp.get("status") ?? undefined);
  const q = sp.get("q")?.trim() || undefined;
  return { invoices: await listAdminInvoices({ status, q }) };
});
