import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { safeSupplier } from "@/server/serialize";
import { getOwnedSupplier, updateSupplierProfile } from "@/server/suppliers";

const schema = z.object({
  legalNameEn: z.string().trim().max(120).optional(),
  tradeName: z.string().trim().max(120).optional(),
  contactName: z.string().trim().min(2).max(80).optional(),
  contactMobile: z.string().trim().optional(),
  contactEmail: z.string().trim().email().or(z.literal("")).optional(),
  vatNumber: z.string().trim().max(20).optional(),
  vehiclePlate: z.string().trim().max(20).optional(),
  driverLicenseNo: z.string().trim().max(30).optional(),
});

export const PATCH = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, current, meta }) => {
  const patch = await parseJson(req, schema);
  const supplier = await getOwnedSupplier(current.user.id);
  if (!supplier) throw new AppError("NOT_FOUND");
  const updated = await updateSupplierProfile(current.user, supplier, patch, meta);
  return { supplier: safeSupplier(updated) };
});
