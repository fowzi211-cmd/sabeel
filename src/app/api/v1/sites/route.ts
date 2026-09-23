import { parseJson, route } from "@/lib/http";
import { createSite, listSites, siteSchema } from "@/server/sites";

const view = (s: Awaited<ReturnType<typeof listSites>>[number]) => ({
  id: s.id, label: s.label, districtId: s.districtId, district: { id: s.district.id, nameAr: s.district.nameAr, nameEn: s.district.nameEn },
  lat: s.lat, lng: s.lng, nationalAddress: s.nationalAddress, landmark: s.landmark, accessNotes: s.accessNotes,
  recipientName: s.recipientName, recipientMobile: s.recipientMobile,
});

export const GET = route({}, async ({ current }) => ({ sites: (await listSites(current.user.id)).map(view) }));

export const POST = route({}, async ({ req, current, meta }) => {
  const input = await parseJson(req, siteSchema);
  return { site: view(await createSite(current.user, input, meta)) };
});
