import { z } from "zod";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { getCurrentSession } from "@/lib/session";
import { getCurrentTerms, getUpcomingTerms, hasAcceptedCurrent } from "@/server/terms";
import { getOwnedSupplier } from "@/server/suppliers";

const typeSchema = z.enum(["SUPPLIER_AGREEMENT", "INDEPENDENT_AGREEMENT", "BUYER_TERMS", "DRIVER_ACK"]);

/** Agreements are public documents; the acceptance flag is added only for a signed-in reader. */
export const GET = route<{ type: string }>({ auth: "none" }, async ({ params }) => {
  const parsed = typeSchema.safeParse(params.type);
  if (!parsed.success) throw new AppError("NOT_FOUND");
  const type = parsed.data;

  const [doc, upcoming] = await Promise.all([getCurrentTerms(type), getUpcomingTerms(type)]);
  if (!doc) throw new AppError("TERMS_NOT_FOUND");

  let accepted: boolean | null = null;
  const current = await getCurrentSession();
  if (current) {
    const supplier = type === "BUYER_TERMS" || type === "DRIVER_ACK" ? null : await getOwnedSupplier(current.user.id);
    accepted = (await hasAcceptedCurrent({ userId: current.user.id, supplierId: supplier?.id ?? null, type })).accepted;
  }

  const view = (d: typeof doc) => ({
    id: d.id,
    type: d.type,
    version: d.version,
    titleAr: d.titleAr,
    titleEn: d.titleEn,
    bodyAr: d.bodyAr,
    bodyEn: d.bodyEn,
    sha256Ar: d.sha256Ar,
    sha256En: d.sha256En,
    effectiveFrom: d.effectiveFrom,
    noticeDays: d.noticeDays,
    legalReviewed: !!d.legalReviewedAt,
  });
  return { current: view(doc), upcoming: upcoming ? view(upcoming) : null, accepted };
});
