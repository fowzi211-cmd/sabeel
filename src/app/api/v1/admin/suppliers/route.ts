import { z } from "zod";
import { route } from "@/lib/http";
import { safeSupplier } from "@/server/serialize";
import { listSuppliers } from "@/server/suppliers";

const statuses = ["DRAFT", "PENDING", "NEEDS_INFO", "ACTIVE", "PAUSED", "SUSPENDED", "REJECTED", "OFFBOARDED"] as const;

export const GET = route({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] }, async ({ req }) => {
  const status = z.enum(statuses).optional().parse(req.nextUrl.searchParams.get("status") ?? undefined);
  const suppliers = await listSuppliers(status);
  return { suppliers: suppliers.map(safeSupplier) };
});
