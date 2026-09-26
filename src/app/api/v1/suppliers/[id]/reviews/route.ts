import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { getPublicSupplierProfile, listPublicSupplierReviews } from "@/server/profile";

export const GET = route<{ id: string }>({}, async ({ req, params }) => {
  if (!(await getPublicSupplierProfile(params.id))) throw new AppError("NOT_FOUND");
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const { items, nextCursor } = await listPublicSupplierReviews(params.id, { cursor });
  return { reviews: items, nextCursor };
});
