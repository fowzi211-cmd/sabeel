import type { DocKind } from "@prisma/client";
import { db } from "@/lib/db";
import { notifySupplier } from "./notify";

const DAY = 86_400_000;
/** How far ahead of a verified document's expiry the supplier is warned (design pack `documents.expiry_check`). */
const DOC_EXPIRY_WARN_DAYS = 14;

/**
 * Suppliers whose latest verified document of some kind has expired. Expired documents hide products
 * and stop acceptance automatically (lean prompt §C, acceptance criterion 10).
 */
export async function suppliersWithExpiredDocs(supplierIds: string[], now: Date = new Date()): Promise<Set<string>> {
  if (supplierIds.length === 0) return new Set();
  const docs = await db.supplierDocument.findMany({
    where: { supplierId: { in: supplierIds }, status: "VERIFIED", expiresAt: { not: null } },
    select: { supplierId: true, kind: true, expiresAt: true },
  });
  const valid = await db.supplierDocument.findMany({
    where: { supplierId: { in: supplierIds }, status: "VERIFIED", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { supplierId: true, kind: true },
  });
  const stillValid = new Set(valid.map((d) => `${d.supplierId}:${d.kind}`));
  const bad = new Set<string>();
  for (const d of docs as { supplierId: string; kind: DocKind; expiresAt: Date }[]) {
    if (d.expiresAt <= now && !stillValid.has(`${d.supplierId}:${d.kind}`)) bad.add(d.supplierId);
  }
  return bad;
}

const alreadyNotified = (event: string, docId: string) =>
  db.notification.findFirst({ where: { event, payload: { path: ["docId"], equals: docId } } }).then((n) => !!n);

/**
 * `documents.expiry_check` (design pack §9 background jobs). Until now `suppliersWithExpiredDocs()` only
 * hid an already-expired supplier reactively; this proactively warns before that happens, and again once
 * it does, so a supplier isn't silently dropped from comparison without knowing why. Each document gets
 * at most one warning and one expired notice, ever (idempotent via the Notification log).
 */
export async function sendDocumentExpiryNotices(now: Date = new Date(), limit = 200) {
  const stats = { warned: 0, expired: 0 };

  const expiringSoon = await db.supplierDocument.findMany({
    where: { status: "VERIFIED", expiresAt: { gt: now, lte: new Date(now.getTime() + DOC_EXPIRY_WARN_DAYS * DAY) }, supplier: { status: "ACTIVE" } },
    take: limit,
  });
  for (const d of expiringSoon) {
    if (await alreadyNotified("document.expiring_soon", d.id)) continue;
    await notifySupplier(d.supplierId, "document.expiring_soon", {
      ar: `سبيل: تنتهي صلاحية أحد مستنداتك الموثّقة قريباً (${d.expiresAt!.toISOString().slice(0, 10)}). جدّده حتى لا تختفي عروضك من المقارنة.`,
      en: `Sabeel: one of your verified documents expires soon (${d.expiresAt!.toISOString().slice(0, 10)}). Renew it so your offers don't disappear from comparison.`,
    }, { docId: d.id });
    stats.warned++;
  }

  const alreadyExpired = await db.supplierDocument.findMany({
    where: { status: "VERIFIED", expiresAt: { lte: now }, supplier: { status: "ACTIVE" } },
    take: limit,
  });
  for (const d of alreadyExpired) {
    if (await alreadyNotified("document.expired", d.id)) continue;
    await notifySupplier(d.supplierId, "document.expired", {
      ar: "سبيل: انتهت صلاحية أحد مستنداتك الموثّقة. اختفت عروضك من المقارنة وتعذّر قبول طلبات جديدة حتى تجدّده.",
      en: "Sabeel: one of your verified documents has expired. Your offers are hidden from comparison and you cannot accept new orders until it is renewed.",
    }, { docId: d.id });
    stats.expired++;
  }
  return stats;
}

/** For the admin dashboard's queue tile: every verified document an active supplier needs to look at. */
export async function docsNeedingAttention(now: Date = new Date(), limit = 50) {
  const docs = await db.supplierDocument.findMany({
    where: { status: "VERIFIED", expiresAt: { lte: new Date(now.getTime() + DOC_EXPIRY_WARN_DAYS * DAY) }, supplier: { status: "ACTIVE" } },
    orderBy: { expiresAt: "asc" },
    include: { supplier: { select: { id: true, tradeName: true, legalNameAr: true } } },
    take: limit,
  });
  return docs.map((d) => ({
    id: d.id, kind: d.kind, expiresAt: d.expiresAt!, expired: d.expiresAt! <= now,
    supplierId: d.supplierId, supplierName: d.supplier.tradeName || d.supplier.legalNameAr,
  }));
}
