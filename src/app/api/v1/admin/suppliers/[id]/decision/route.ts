import { z } from "zod";
import { parseJson, route } from "@/lib/http";
import { safeDocument, safeSupplier } from "@/server/serialize";
import { decideSupplier } from "@/server/suppliers";

const schema = z.object({
  action: z.enum(["approve", "reject", "needs_info", "suspend", "reinstate"]),
  note: z.string().trim().max(500).optional(),
});

export const POST = route<{ id: string }>({ roles: ["ADMIN_OPS"] }, async ({ req, params, current, meta }) => {
  const { action, note } = await parseJson(req, schema);
  const supplier = await decideSupplier(current.user, params.id, action, note, meta);
  const { documents, ...rest } = safeSupplier(supplier!);
  return { supplier: rest, documents: documents.map(safeDocument) };
});
