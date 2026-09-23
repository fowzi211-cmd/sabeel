import { route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { listSupplierReviews } from "@/server/reviews";

export const GET = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ current }) => {
  const supplier = await ownedSupplier(current.user.id);
  return { reviews: await listSupplierReviews(supplier.id) };
});
