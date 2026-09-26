import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { disputeResponseSchema, respondToDispute } from "@/server/payments";

/** The supplier's one answer (note + optional photo) to a buyer's delivery dispute, inside its 48 h window. */
export const POST = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, params, current, meta }) => {
  const supplier = await ownedSupplier(current.user.id);
  const form = await req.formData().catch(() => {
    throw new AppError("BAD_REQUEST");
  });
  const input = disputeResponseSchema.parse({ note: form.get("note") });
  const file = form.get("file");
  return respondToDispute(current.user, supplier, params.id, input, file instanceof File && file.size > 0 ? file : null, meta);
});
