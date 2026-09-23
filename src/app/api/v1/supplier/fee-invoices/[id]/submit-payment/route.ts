import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { submitInvoicePayment, submitInvoicePaymentSchema } from "@/server/fees";

/** The supplier paid the fee invoice outside the platform (bank transfer) and tells us — an optional receipt is evidence. */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const supplier = await ownedSupplier(current.user.id);
  const form = await req.formData().catch(() => {
    throw new AppError("BAD_REQUEST");
  });
  const input = submitInvoicePaymentSchema.parse({ paymentDate: form.get("paymentDate"), bankReference: form.get("bankReference") });
  const file = form.get("file");
  const invoice = await submitInvoicePayment(current.user, supplier, params.id, input, file instanceof File && file.size > 0 ? file : null, meta);
  return { invoice };
});
