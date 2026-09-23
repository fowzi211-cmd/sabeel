import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { requestOtp } from "@/lib/otp";
import { getCurrentTerms } from "@/server/terms";
import { getOwnedSupplier } from "@/server/suppliers";
import { agreementTypeFor } from "@/server/terms";

const schema = z.object({
  type: z.enum(["SUPPLIER_AGREEMENT", "INDEPENDENT_AGREEMENT"]),
  version: z.string().min(1).max(20),
});

/** Sends the fresh SMS code that acts as the electronic signature for a supplier agreement. */
export const POST = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, current, meta }) => {
  const { type, version } = await parseJson(req, schema);
  const { user } = current;

  const supplier = await getOwnedSupplier(user.id);
  if (!supplier || agreementTypeFor(supplier.type) !== type) throw new AppError("FORBIDDEN");
  const doc = await getCurrentTerms(type);
  if (!doc) throw new AppError("TERMS_NOT_FOUND");
  if (doc.version !== version) throw new AppError("TERMS_STALE");

  const r = await requestOtp({
    mobile: user.mobile,
    purpose: "SIGN",
    context: `terms:${type}:${version}`,
    userId: user.id,
    lang: user.language,
    ip: meta.ip,
  });
  return { ok: true, expiresAt: r.expiresAt, cooldownSeconds: r.cooldownSeconds, ...(r.devCode ? { devCode: r.devCode } : {}) };
});
