import { db } from "@/lib/db";
import { route } from "@/lib/http";

/** Public: the registry of brands that may be sold on Sabeel (approved brands only). */
export const GET = route({ auth: "none" }, async () => ({
  brands: await db.brand.findMany({
    where: { status: "ACTIVE" },
    orderBy: { nameEn: "asc" },
    select: { id: true, nameAr: true, nameEn: true },
  }),
}));
