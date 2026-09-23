import { route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { listSupplierReviews } from "@/server/reviews";

export const GET = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, current }) => {
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const supplier = await ownedSupplier(current.user.id);
  const { items: reviews, nextCursor } = await listSupplierReviews(supplier.id, { cursor });
  return { reviews, nextCursor };
});
