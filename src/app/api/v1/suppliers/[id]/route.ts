import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { getPublicSupplierProfile } from "@/server/profile";

/** Any signed-in user may look at an active supplier's trust figures. */
export const GET = route<{ id: string }>({}, async ({ params }) => {
  const profile = await getPublicSupplierProfile(params.id);
  if (!profile) throw new AppError("NOT_FOUND");
  return { supplier: profile };
});
