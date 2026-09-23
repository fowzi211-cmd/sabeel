import { Prisma, type Lang, type SupplierType, type TermsType, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { verifyOtp } from "@/lib/otp";
import { notifyUserId } from "./notify";

/** Text is normalised before hashing so line-ending differences cannot change the fingerprint. */
export const normalizeBody = (s: string) => s.replace(/\r\n/g, "\n").trim();
export const termsHash = (s: string) => sha256Hex(normalizeBody(s));

export const agreementTypeFor = (t: SupplierType): TermsType =>
  t === "INDEPENDENT" ? "INDEPENDENT_AGREEMENT" : "SUPPLIER_AGREEMENT";

const isSupplierAgreement = (t: TermsType) => t === "SUPPLIER_AGREEMENT" || t === "INDEPENDENT_AGREEMENT";

/** The version in force now: latest one whose effective date has passed. */
export function getCurrentTerms(type: TermsType) {
  return db.termsDocument.findFirst({
    where: { type, effectiveFrom: { lte: new Date() } },
    orderBy: [{ effectiveFrom: "desc" }, { publishedAt: "desc" }],
  });
}

/** A published version that is not effective yet — suppliers are notified during its notice period. */
export function getUpcomingTerms(type: TermsType) {
  return db.termsDocument.findFirst({
    where: { type, effectiveFrom: { gt: new Date() } },
    orderBy: { effectiveFrom: "asc" },
  });
}

export async function hasAcceptedCurrent(opts: { userId: string; supplierId: string | null; type: TermsType }) {
  const doc = await getCurrentTerms(opts.type);
  if (!doc) return { doc: null, accepted: false as const, acceptance: null };
  const acceptance = await db.termsAcceptance.findFirst({
    where: { termsDocumentId: doc.id, ...(opts.supplierId ? { supplierId: opts.supplierId } : { userId: opts.userId, supplierId: null }) },
    orderBy: { acceptedAt: "desc" },
  });
  return { doc, accepted: !!acceptance, acceptance };
}

async function nextCertificateNo(): Promise<string> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval('sabeel_acceptance_no_seq') AS n`;
  const year = new Date().getUTCFullYear();
  return `SBL-AGR-${year}-${String(rows[0].n).padStart(6, "0")}`;
}

export interface AcceptInput {
  user: User;
  type: TermsType;
  version: string;
  language: Lang;
  confirmRead: boolean;
  authorised?: boolean;
  code?: string;
  meta: RequestMeta;
}

/**
 * Records an online acceptance. Supplier agreements are signed with a fresh SMS code
 * (the electronic signature, FR-LEG-02) by the supplier's owner; buyer terms are accepted
 * inside the authenticated session.
 */
export async function acceptTerms(a: AcceptInput) {
  const doc = await getCurrentTerms(a.type);
  if (!doc) throw new AppError("TERMS_NOT_FOUND");
  if (doc.version !== a.version) throw new AppError("TERMS_STALE");
  if (!a.confirmRead) throw new AppError("VALIDATION", { field: "confirmRead" });
  if (!a.user.name?.trim()) throw new AppError("VALIDATION", { field: "name" });

  if (a.type === "DRIVER_ACK" && !a.user.roles.includes("DRIVER")) throw new AppError("FORBIDDEN");

  let supplierId: string | null = null;
  let method: "CLICK_WRAP_OTP" | "CLICK_WRAP_SESSION" = "CLICK_WRAP_SESSION";
  let otpChallengeId: string | null = null;

  if (isSupplierAgreement(a.type)) {
    const wanted: SupplierType = a.type === "INDEPENDENT_AGREEMENT" ? "INDEPENDENT" : "BRAND_COMPANY";
    const membership = await db.supplierMember.findFirst({
      where: { userId: a.user.id, role: "OWNER", supplier: { type: wanted } },
    });
    if (!membership) throw new AppError("FORBIDDEN");
    if (!a.authorised) throw new AppError("VALIDATION", { field: "authorised" });
    if (!a.code) throw new AppError("VALIDATION", { field: "code" });

    const ok = await verifyOtp({
      mobile: a.user.mobile,
      purpose: "SIGN",
      code: a.code,
      context: `terms:${a.type}:${a.version}`,
    });
    supplierId = membership.supplierId;
    method = "CLICK_WRAP_OTP";
    otpChallengeId = ok.challengeId;
  }

  const certificateNo = await nextCertificateNo();
  try {
    const acceptance = await db.termsAcceptance.create({
      data: {
        certificateNo,
        userId: a.user.id,
        supplierId,
        termsDocumentId: doc.id,
        termsType: a.type,
        version: doc.version,
        sha256Ar: doc.sha256Ar,
        sha256En: doc.sha256En,
        languageShown: a.language,
        signatoryName: a.user.name.trim(),
        authorisedToBind: !!a.authorised,
        method,
        otpChallengeId,
        ip: a.meta.ip,
        userAgent: a.meta.ua?.slice(0, 300) ?? null,
      },
    });
    await audit({
      actor: { id: a.user.id, roles: a.user.roles },
      action: "terms.accepted",
      entity: "TermsAcceptance",
      entityId: acceptance.id,
      after: { certificateNo, type: a.type, version: doc.version, supplierId, method },
      meta: a.meta,
    });
    return acceptance;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("CONFLICT", { message: "already accepted" });
    }
    throw e;
  }
}

export interface PublishInput {
  type: TermsType;
  version: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  noticeDays: number;
  effectiveFrom: Date;
}

/** Publishes a new immutable version. Material changes must carry the notice period. */
export async function publishTerms(admin: { id: string; roles: User["roles"] }, i: PublishInput, meta: RequestMeta) {
  const now = new Date();
  const earliest = new Date(now.getTime() + i.noticeDays * 86_400_000);
  const current = await getCurrentTerms(i.type);
  // The very first version can be effective immediately; later ones honour the notice period.
  if (current && i.effectiveFrom < new Date(earliest.getTime() - 60_000)) {
    throw new AppError("VALIDATION", {
      field: "effectiveFrom",
      message: `effectiveFrom must be at least ${i.noticeDays} days ahead`,
    });
  }
  try {
    const doc = await db.termsDocument.create({
      data: {
        type: i.type,
        version: i.version,
        titleAr: i.titleAr,
        titleEn: i.titleEn,
        bodyAr: normalizeBody(i.bodyAr),
        bodyEn: normalizeBody(i.bodyEn),
        sha256Ar: termsHash(i.bodyAr),
        sha256En: termsHash(i.bodyEn),
        noticeDays: i.noticeDays,
        effectiveFrom: i.effectiveFrom,
        publishedById: admin.id,
      },
    });
    await audit({
      actor: admin,
      action: "terms.published",
      entity: "TermsDocument",
      entityId: doc.id,
      after: { type: i.type, version: i.version, effectiveFrom: i.effectiveFrom, sha256Ar: doc.sha256Ar },
      meta,
    });
    return doc;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("CONFLICT", { message: "that version already exists" });
    }
    throw e;
  }
}

export async function markLegallyReviewed(admin: { id: string; roles: User["roles"] }, id: string, meta: RequestMeta) {
  const doc = await db.termsDocument.findUnique({ where: { id } });
  if (!doc) throw new AppError("NOT_FOUND");
  if (doc.legalReviewedAt) return doc;
  const updated = await db.termsDocument.update({ where: { id }, data: { legalReviewedAt: new Date() } });
  await audit({
    actor: admin,
    action: "terms.legal_reviewed",
    entity: "TermsDocument",
    entityId: id,
    after: { type: doc.type, version: doc.version },
    meta,
  });
  return updated;
}

/**
 * `agreements.reacceptance_check` (design pack §9). A supplier can already never accept an order without
 * having accepted the current agreement (`AGREEMENT_REQUIRED` gate in fulfilment.ts) — this job is the
 * proactive half: it tells the owner *before or as soon as* a version they haven't accepted takes effect,
 * instead of leaving them to discover the block on their own. One notice per (document, owner), ever.
 * No `now` parameter (unlike the other background jobs) — getCurrentTerms()/getUpcomingTerms() always
 * read the real wall clock, so there is nothing here a caller could meaningfully time-travel.
 */
export async function sendReacceptanceNudges(limit = 200) {
  const stats = { notified: 0 };
  for (const type of ["SUPPLIER_AGREEMENT", "INDEPENDENT_AGREEMENT"] as const) {
    const wanted: SupplierType = type === "INDEPENDENT_AGREEMENT" ? "INDEPENDENT" : "BRAND_COMPANY";
    const docs = [await getUpcomingTerms(type), await getCurrentTerms(type)].filter((d): d is NonNullable<typeof d> => !!d);
    if (docs.length === 0) continue;

    const suppliers = await db.supplier.findMany({
      where: { type: wanted, status: "ACTIVE" },
      include: { members: { where: { role: "OWNER" }, take: 1, include: { user: { select: { id: true } } } } },
      take: limit,
    });
    for (const doc of docs) {
      for (const s of suppliers) {
        const owner = s.members[0];
        if (!owner) continue;
        const accepted = await db.termsAcceptance.findFirst({ where: { termsDocumentId: doc.id, supplierId: s.id } });
        if (accepted) continue;
        const already = await db.notification.findFirst({
          where: { event: "terms.reacceptance_needed", userId: owner.user.id, payload: { path: ["termsDocumentId"], equals: doc.id } },
        });
        if (already) continue;
        const dateStr = doc.effectiveFrom.toISOString().slice(0, 10);
        await notifyUserId(owner.user.id, "terms.reacceptance_needed", {
          ar: `سبيل: هناك نسخة من اتفاقية المورّد (${doc.version}) تسري في ${dateStr}. اقبلها من صفحة حسابك حتى تستمر باستقبال الطلبات.`,
          en: `Sabeel: a version of the supplier agreement (${doc.version}) takes effect on ${dateStr}. Accept it from your account page to keep receiving orders.`,
        }, { termsDocumentId: doc.id, supplierId: s.id });
        stats.notified++;
      }
    }
  }
  return stats;
}
