import { route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { supplierFeeSummary } from "@/server/fees";

export const GET = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ current }) => {
  const supplier = await ownedSupplier(current.user.id);
  return { summary: await supplierFeeSummary(supplier.id) };
});
