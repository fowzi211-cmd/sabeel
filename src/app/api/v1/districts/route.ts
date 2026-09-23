import { route } from "@/lib/http";
import { listDistricts } from "@/server/catalogue";

/** Public: delivery districts with their availability (restricted areas are listed but flagged). */
export const GET = route({ auth: "none" }, async () => {
  const districts = await listDistricts();
  return {
    districts: districts.map((d) => ({
      id: d.id, slug: d.slug, city: d.city, nameAr: d.nameAr, nameEn: d.nameEn,
      restricted: d.restricted, restrictedReason: d.restricted ? d.restrictedReason : null, restrictedReasonEn: d.restricted ? d.restrictedReasonEn : null,
    })),
  };
});
