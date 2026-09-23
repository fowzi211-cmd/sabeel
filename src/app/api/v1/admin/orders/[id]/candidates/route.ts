import { route } from "@/lib/http";
import { listCandidatesForOrder } from "@/server/fulfilment";

export const GET = route<{ id: string }>({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] }, async ({ params }) => {
  const candidates = await listCandidatesForOrder(params.id);
  return { candidates: candidates.map((c) => ({ supplierId: c.supplierId, supplierName: c.supplierName, totalHalalas: c.totalHalalas, leadHours: c.leadHours })) };
});
