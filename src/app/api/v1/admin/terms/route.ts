import { z } from "zod";
import { db } from "@/lib/db";
import { parseJson, route } from "@/lib/http";
import { publishTerms } from "@/server/terms";

const ADMIN_READ = ["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE"] as const;

export const GET = route({ roles: [...ADMIN_READ] }, async () => {
  const docs = await db.termsDocument.findMany({
    orderBy: [{ type: "asc" }, { effectiveFrom: "desc" }],
    select: {
      id: true, type: true, version: true, titleAr: true, titleEn: true, sha256Ar: true, sha256En: true,
      noticeDays: true, effectiveFrom: true, publishedAt: true, legalReviewedAt: true,
    },
  });
  return { terms: docs };
});

const schema = z.object({
  type: z.enum(["SUPPLIER_AGREEMENT", "INDEPENDENT_AGREEMENT", "BUYER_TERMS"]),
  version: z.string().trim().regex(/^\d+\.\d+$/, "Use a version like 1.1"),
  titleAr: z.string().trim().min(3).max(150),
  titleEn: z.string().trim().min(3).max(150),
  bodyAr: z.string().trim().min(100),
  bodyEn: z.string().trim().min(100),
  noticeDays: z.number().int().min(0).max(365).default(30),
  effectiveFrom: z.coerce.date(),
});

/** Publishing an agreement is a legal act: super-admin only, immutable once published. */
export const POST = route({ roles: ["SUPER_ADMIN"] }, async ({ req, current, meta }) => {
  const input = await parseJson(req, schema);
  const doc = await publishTerms(current.user, input, meta);
  return { terms: { id: doc.id, type: doc.type, version: doc.version, effectiveFrom: doc.effectiveFrom } };
});
