import { route } from "@/lib/http";
import { confirmInvoicePayment } from "@/server/fees";

export const POST = route<{ id: string }>({ roles: ["ADMIN_FINANCE"] }, async ({ params, current, meta }) => {
  const invoice = await confirmInvoicePayment(current.user, params.id, meta);
  return { invoice };
});
