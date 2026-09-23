import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { addBankAccount, bankSchema, getOwnedSupplier } from "@/server/suppliers";

export const POST = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, current, meta }) => {
  const input = await parseJson(req, bankSchema);
  const supplier = await getOwnedSupplier(current.user.id);
  if (!supplier) throw new AppError("NOT_FOUND");
  const account = await addBankAccount(current.user, supplier, input, meta);
  return { bankAccount: account };
});
