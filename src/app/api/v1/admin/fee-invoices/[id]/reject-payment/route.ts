import { parseJson, route } from "@/lib/http";
import { rejectInvoicePayment, rejectInvoicePaymentSchema } from "@/server/fees";

export const POST = route<{ id: string }>({ roles: ["ADMIN_FINANCE"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, rejectInvoicePaymentSchema);
  await rejectInvoicePayment(current.user, params.id, input, meta);
  return { ok: true };
});
