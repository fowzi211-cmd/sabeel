import { z } from "zod";
import {
  Prisma,
  type DocKind,
  type Role,
  type Supplier,
  type SupplierDocument,
  type SupplierStatus,
  type SupplierType,
  type User,
  type BankAccount,
} from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { encryptField } from "@/lib/crypto";
import { isProduction } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { NEW_SUPPLIER_CEILING_HALALAS } from "@/lib/fulfilment";
import { sendSms } from "@/lib/sms";
import {
  hasArabic,
  isValidCrNumber,
  isValidFreelanceNumber,
  isValidSaudiIban,
  isValidSaudiIdNumber,
  isValidVatNumber,
  normalizeIban,
  normalizeSaudiMobile,
  toWesternDigits,
} from "@/lib/validate";
import { agreementTypeFor, hasAcceptedCurrent } from "./terms";
import { deleteUpload, saveUpload } from "./storage";

// ───────────── policy constants (editable settings arrive in a later slice) ─────────────
export const REQUIRED_DOCS: Record<SupplierType, DocKind[]> = {
  BRAND_COMPANY: ["CR", "VAT_CERT"],
  INDEPENDENT: ["CR", "NATIONAL_ID", "DRIVER_LICENSE", "VEHICLE_REGISTRATION", "SOURCING_INVOICE"],
};
export const OPTIONAL_DOCS: Record<SupplierType, DocKind[]> = {
  BRAND_COMPANY: ["MUNICIPAL_LICENSE", "BRAND_AUTHORIZATION", "QUALITY_CERT", "OTHER"],
  INDEPENDENT: ["QUALITY_CERT", "OTHER"],
};
const INDEPENDENT_PROBATION_DELIVERIES = 10;
const BANK_CHANGE_COOLDOWN_MS = 48 * 3_600_000;
const EDITABLE_STATES: SupplierStatus[] = ["DRAFT", "NEEDS_INFO"];

type Actor = { id: string; roles: Role[] };

// ───────────── input schemas ─────────────
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const applySchema = z
  .object({
    type: z.enum(["BRAND_COMPANY", "INDEPENDENT"]),
    legalNameAr: z.string().trim().min(2).max(120),
    legalNameEn: optionalText(120),
    tradeName: optionalText(120),
    registrationKind: z.enum(["CR", "FREELANCE"]).default("CR"),
    crNumber: z.string().trim().min(1),
    vatNumber: optionalText(20),
    contactName: z.string().trim().min(2).max(80),
    contactMobile: z.string().trim().min(1),
    contactEmail: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
    idNumber: optionalText(20),
    vehiclePlate: optionalText(20),
    driverLicenseNo: optionalText(30),
  })
  .superRefine((v, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (!hasArabic(v.legalNameAr)) bad("legalNameAr", "Arabic legal name is required");
    if (!normalizeSaudiMobile(v.contactMobile)) bad("contactMobile", "Enter a valid Saudi mobile number");

    if (v.type === "BRAND_COMPANY") {
      if (v.registrationKind !== "CR") bad("registrationKind", "A company must register with a Commercial Registration");
      if (!isValidCrNumber(v.crNumber)) bad("crNumber", "CR number must be 10 digits");
      if (!v.vatNumber || !isValidVatNumber(v.vatNumber)) bad("vatNumber", "VAT number must be 15 digits starting and ending with 3");
    } else {
      if (v.registrationKind === "CR" ? !isValidCrNumber(v.crNumber) : !isValidFreelanceNumber(v.crNumber))
        bad("crNumber", v.registrationKind === "CR" ? "CR number must be 10 digits" : "Invalid freelance document number");
      if (v.vatNumber && !isValidVatNumber(v.vatNumber)) bad("vatNumber", "VAT number must be 15 digits starting and ending with 3");
      if (!v.idNumber || !isValidSaudiIdNumber(v.idNumber)) bad("idNumber", "Enter a valid National ID / Iqama number");
      if (!v.vehiclePlate) bad("vehiclePlate", "Vehicle plate is required");
      if (!v.driverLicenseNo) bad("driverLicenseNo", "Driving licence number is required");
    }
  });
export type ApplyInput = z.infer<typeof applySchema>;

export const bankSchema = z.object({
  iban: z.string().trim().min(1),
  holderName: z.string().trim().min(2).max(120),
  bankName: optionalText(80),
});

export const documentMetaSchema = z.object({
  kind: z.enum([
    "CR", "VAT_CERT", "MUNICIPAL_LICENSE", "BRAND_AUTHORIZATION", "QUALITY_CERT",
    "NATIONAL_ID", "DRIVER_LICENSE", "VEHICLE_REGISTRATION", "SOURCING_INVOICE", "OTHER",
  ]),
  number: optionalText(40),
  issuedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});

// ───────────── loaders ─────────────
export type SupplierFull = Supplier & { documents: SupplierDocument[]; bankAccounts: BankAccount[] };

export function getOwnedSupplier(userId: string): Promise<SupplierFull | null> {
  return db.supplier.findFirst({
    where: { members: { some: { userId, role: "OWNER" } } },
    include: { documents: { orderBy: { createdAt: "desc" } }, bankAccounts: { orderBy: { createdAt: "desc" } } },
  });
}

/** A pending replacement account goes live once verified and its cool-down has passed. */
export async function ensureBankActivation(supplierId: string) {
  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { status: true } });
  if (!supplier || (supplier.status !== "ACTIVE" && supplier.status !== "PAUSED")) return;
  const ready = await db.bankAccount.findFirst({
    where: {
      supplierId,
      status: "PENDING",
      reviewedAt: { not: null },
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (!ready) return;
  await db.$transaction([
    db.bankAccount.updateMany({ where: { supplierId, status: "ACTIVE" }, data: { status: "REPLACED" } }),
    db.bankAccount.update({ where: { id: ready.id }, data: { status: "ACTIVE", activatedAt: new Date() } }),
  ]);
}

// ───────────── checklist ─────────────
export interface DocSlot {
  kind: DocKind;
  required: boolean;
  latest: SupplierDocument | null;
  satisfied: boolean; // uploaded, not rejected, not expired
  verified: boolean;
  expired: boolean;
}
export interface Checklist {
  docs: DocSlot[];
  bank: { present: boolean; verified: boolean; active: boolean };
  agreement: { type: ReturnType<typeof agreementTypeFor>; version: string | null; accepted: boolean; legalReviewed: boolean };
  submitReady: boolean;
  approveReady: boolean;
  blockers: string[];
}

export async function buildChecklist(s: SupplierFull, ownerUserId: string): Promise<Checklist> {
  const now = new Date();
  const kinds = [...REQUIRED_DOCS[s.type], ...OPTIONAL_DOCS[s.type]];
  const docs: DocSlot[] = kinds.map((kind) => {
    const ofKind = s.documents.filter((d) => d.kind === kind);
    const latest = ofKind.find((d) => d.status !== "REJECTED") ?? ofKind[0] ?? null;
    const expired = !!latest?.expiresAt && latest.expiresAt <= now;
    return {
      kind,
      required: REQUIRED_DOCS[s.type].includes(kind),
      latest,
      satisfied: !!latest && latest.status !== "REJECTED" && !expired,
      verified: !!latest && latest.status === "VERIFIED" && !expired,
      expired,
    };
  });

  const liveBank = s.bankAccounts.find((b) => b.status === "ACTIVE") ?? s.bankAccounts.find((b) => b.status === "PENDING");
  const bank = {
    present: !!liveBank,
    verified: !!liveBank && (liveBank.status === "ACTIVE" || !!liveBank.reviewedAt),
    active: liveBank?.status === "ACTIVE",
  };

  const type = agreementTypeFor(s.type);
  const { doc, accepted } = await hasAcceptedCurrent({ userId: ownerUserId, supplierId: s.id, type });
  const agreement = { type, version: doc?.version ?? null, accepted, legalReviewed: !!doc?.legalReviewedAt };

  const blockers: string[] = [];
  for (const d of docs.filter((x) => x.required && !x.satisfied)) blockers.push(`doc:${d.kind}`);
  if (!bank.present) blockers.push("bank");
  if (!agreement.accepted) blockers.push("agreement");
  const submitReady = blockers.length === 0;

  const approveBlockers: string[] = [];
  for (const d of docs.filter((x) => x.required && !x.verified)) approveBlockers.push(`doc:${d.kind}`);
  if (!bank.verified) approveBlockers.push("bank");
  if (!agreement.accepted) approveBlockers.push("agreement");
  if (isProduction() && !agreement.legalReviewed) approveBlockers.push("legal_review");

  return { docs, bank, agreement, submitReady, approveReady: approveBlockers.length === 0, blockers: approveBlockers.length ? approveBlockers : blockers };
}

// ───────────── notifications ─────────────
export async function notifyAdmins(event: string, payload: Prisma.InputJsonValue) {
  const admins = await db.user.findMany({
    where: { status: "ACTIVE", roles: { hasSome: ["ADMIN_OPS", "SUPER_ADMIN"] } },
    select: { id: true },
  });
  if (admins.length === 0) return;
  await db.notification.createMany({
    data: admins.map((a) => ({ userId: a.id, channel: "IN_APP" as const, event, payload, status: "SENT" as const, sentAt: new Date() })),
  });
}

export async function notifyOwner(supplierId: string, event: string, smsAr: string, payload: Prisma.InputJsonValue) {
  const owners = await db.supplierMember.findMany({ where: { supplierId, role: "OWNER" }, include: { user: true } });
  for (const { user } of owners) {
    await db.notification.create({
      data: { userId: user.id, channel: "IN_APP", event, payload, status: "SENT", sentAt: new Date() },
    });
    // The account decision matters more than delivery of the SMS: never fail the decision on it.
    await sendSms({ to: user.mobile, text: smsAr, event, userId: user.id }).catch((e) => console.error("[sms] failed", e));
  }
}

// ───────────── supplier actions ─────────────
export async function applyAsSupplier(user: User, input: ApplyInput, meta: RequestMeta) {
  if (await getOwnedSupplier(user.id)) throw new AppError("CONFLICT", { message: "You already have a supplier application" });

  const crNumber = toWesternDigits(input.crNumber).trim();
  try {
    const supplier = await db.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: {
          type: input.type,
          status: "DRAFT",
          legalNameAr: input.legalNameAr,
          legalNameEn: input.legalNameEn,
          tradeName: input.tradeName,
          registrationKind: input.registrationKind,
          crNumber,
          vatNumber: input.vatNumber ? toWesternDigits(input.vatNumber).trim() : undefined,
          contactName: input.contactName,
          contactMobile: normalizeSaudiMobile(input.contactMobile)!,
          contactEmail: input.contactEmail,
          ...(input.type === "INDEPENDENT"
            ? {
                idNumberEnc: encryptField(toWesternDigits(input.idNumber!).trim()),
                idNumberLast4: toWesternDigits(input.idNumber!).trim().slice(-4),
                vehiclePlate: input.vehiclePlate,
                driverLicenseNo: input.driverLicenseNo,
                probationDeliveriesLeft: INDEPENDENT_PROBATION_DELIVERIES,
              }
            : {}),
          creditCeilingHalalas: NEW_SUPPLIER_CEILING_HALALAS,
          invoiceCycle: "WEEKLY",
          members: { create: { userId: user.id, role: "OWNER" } },
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { roles: Array.from(new Set<Role>([...user.roles, "SUPPLIER_ADMIN"])) },
      });
      await audit(
        { actor: { id: user.id, roles: user.roles }, action: "supplier.applied", entity: "Supplier", entityId: created.id, after: { type: created.type, crNumber }, meta },
        tx,
      );
      return created;
    });
    return supplier;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("CONFLICT", { field: "crNumber", message: "This registration number is already used" });
    }
    throw e;
  }
}

export async function updateSupplierProfile(
  user: User,
  supplier: Supplier,
  patch: Partial<Pick<ApplyInput, "legalNameEn" | "tradeName" | "contactName" | "contactMobile" | "contactEmail" | "vatNumber" | "vehiclePlate" | "driverLicenseNo">>,
  meta: RequestMeta,
) {
  const editable = EDITABLE_STATES.includes(supplier.status);
  // After onboarding only contact details may change; identity fields are locked to protect the record.
  const data: Prisma.SupplierUpdateInput = {};
  if (patch.contactName) data.contactName = patch.contactName;
  if (patch.contactEmail !== undefined) data.contactEmail = patch.contactEmail || null;
  if (patch.contactMobile) {
    const m = normalizeSaudiMobile(patch.contactMobile);
    if (!m) throw new AppError("MOBILE_INVALID", { field: "contactMobile" });
    data.contactMobile = m;
  }
  if (editable) {
    if (patch.legalNameEn !== undefined) data.legalNameEn = patch.legalNameEn || null;
    if (patch.tradeName !== undefined) data.tradeName = patch.tradeName || null;
    if (patch.vatNumber) {
      if (!isValidVatNumber(patch.vatNumber)) throw new AppError("VALIDATION", { field: "vatNumber" });
      data.vatNumber = toWesternDigits(patch.vatNumber).trim();
    }
    if (patch.vehiclePlate) data.vehiclePlate = patch.vehiclePlate;
    if (patch.driverLicenseNo) data.driverLicenseNo = patch.driverLicenseNo;
  }
  const updated = await db.supplier.update({ where: { id: supplier.id }, data });
  await audit({ actor: user, action: "supplier.profile_updated", entity: "Supplier", entityId: supplier.id, after: Object.keys(data), meta });
  return updated;
}

export async function addDocument(user: User, supplier: Supplier, meta: RequestMeta, file: File, m: z.infer<typeof documentMetaSchema>) {
  if (!["DRAFT", "NEEDS_INFO", "ACTIVE", "PAUSED", "PENDING"].includes(supplier.status)) throw new AppError("NOT_EDITABLE");
  const allowed = [...REQUIRED_DOCS[supplier.type], ...OPTIONAL_DOCS[supplier.type]];
  if (!allowed.includes(m.kind)) throw new AppError("VALIDATION", { field: "kind" });

  const saved = await saveUpload(supplier.id, file);
  const doc = await db.supplierDocument.create({
    data: { supplierId: supplier.id, kind: m.kind, number: m.number, issuedAt: m.issuedAt, expiresAt: m.expiresAt, ...saved },
  });
  await audit({ actor: user, action: "supplier.document_uploaded", entity: "SupplierDocument", entityId: doc.id, after: { kind: m.kind, sha256: saved.sha256 }, meta });
  return doc;
}

export async function removeDocument(user: User, supplier: Supplier, docId: string, meta: RequestMeta) {
  const doc = await db.supplierDocument.findFirst({ where: { id: docId, supplierId: supplier.id } });
  if (!doc) throw new AppError("NOT_FOUND");
  if (doc.status === "VERIFIED") throw new AppError("NOT_EDITABLE");
  if (supplier.status === "PENDING") throw new AppError("NOT_EDITABLE");
  await db.supplierDocument.delete({ where: { id: doc.id } });
  await deleteUpload(doc.fileKey);
  await audit({ actor: user, action: "supplier.document_removed", entity: "SupplierDocument", entityId: doc.id, after: { kind: doc.kind }, meta });
}

export async function addBankAccount(user: User, supplier: SupplierFull, input: z.infer<typeof bankSchema>, meta: RequestMeta) {
  if (!["DRAFT", "NEEDS_INFO", "ACTIVE", "PAUSED", "PENDING"].includes(supplier.status)) throw new AppError("NOT_EDITABLE");
  const iban = normalizeIban(input.iban);
  if (!isValidSaudiIban(iban)) throw new AppError("VALIDATION", { field: "iban", message: "Invalid Saudi IBAN" });

  const hasActive = supplier.bankAccounts.some((b) => b.status === "ACTIVE");
  const account = await db.$transaction(async (tx) => {
    await tx.bankAccount.updateMany({ where: { supplierId: supplier.id, status: "PENDING" }, data: { status: "REPLACED" } });
    return tx.bankAccount.create({
      data: {
        supplierId: supplier.id,
        iban,
        holderName: input.holderName,
        bankName: input.bankName,
        // Changing a live account is the classic payment-diversion attack: it waits 48 h and alerts admins.
        cooldownUntil: hasActive ? new Date(Date.now() + BANK_CHANGE_COOLDOWN_MS) : null,
      },
    });
  });
  await audit({ actor: user, action: "supplier.bank_account_added", entity: "BankAccount", entityId: account.id, after: { last4: iban.slice(-4), replacesActive: hasActive }, meta });
  if (hasActive) await notifyAdmins("supplier.bank_account_changed", { supplierId: supplier.id, bankAccountId: account.id });
  return account;
}

export async function submitApplication(user: User, supplier: SupplierFull, meta: RequestMeta) {
  if (!EDITABLE_STATES.includes(supplier.status)) throw new AppError("NOT_EDITABLE");
  const checklist = await buildChecklist(supplier, user.id);
  if (!checklist.submitReady) throw new AppError("INCOMPLETE", { details: { missing: checklist.blockers } });

  const updated = await db.supplier.update({
    where: { id: supplier.id },
    data: { status: "PENDING", submittedAt: new Date(), decisionNote: null },
  });
  await audit({ actor: user, action: "supplier.submitted", entity: "Supplier", entityId: supplier.id, before: { status: supplier.status }, after: { status: "PENDING" }, meta });
  await notifyAdmins("supplier.submitted", { supplierId: supplier.id, name: supplier.legalNameAr });
  return updated;
}

// ───────────── admin actions ─────────────
export async function reviewDocument(admin: Actor, docId: string, action: "verify" | "reject", reason: string | undefined, meta: RequestMeta) {
  if (action === "reject" && !reason?.trim()) throw new AppError("VALIDATION", { field: "reason" });
  const doc = await db.supplierDocument.findUnique({ where: { id: docId } });
  if (!doc) throw new AppError("NOT_FOUND");
  const updated = await db.supplierDocument.update({
    where: { id: docId },
    data: action === "verify"
      ? { status: "VERIFIED", reviewedById: admin.id, reviewedAt: new Date(), rejectReason: null }
      : { status: "REJECTED", reviewedById: admin.id, reviewedAt: new Date(), rejectReason: reason!.trim() },
  });
  await audit({ actor: admin, action: `supplier.document_${action === "verify" ? "verified" : "rejected"}`, entity: "SupplierDocument", entityId: docId, before: { status: doc.status }, after: { status: updated.status }, note: reason, meta });
  return updated;
}

export async function reviewBankAccount(admin: Actor, bankId: string, action: "verify" | "reject", reason: string | undefined, meta: RequestMeta) {
  if (action === "reject" && !reason?.trim()) throw new AppError("VALIDATION", { field: "reason" });
  const bank = await db.bankAccount.findUnique({ where: { id: bankId } });
  if (!bank) throw new AppError("NOT_FOUND");
  if (bank.status !== "PENDING") throw new AppError("NOT_EDITABLE");
  const updated = await db.bankAccount.update({
    where: { id: bankId },
    data: action === "verify"
      ? { reviewedById: admin.id, reviewedAt: new Date(), rejectReason: null }
      : { status: "REJECTED", reviewedById: admin.id, reviewedAt: new Date(), rejectReason: reason!.trim() },
  });
  await audit({ actor: admin, action: `supplier.bank_account_${action === "verify" ? "verified" : "rejected"}`, entity: "BankAccount", entityId: bankId, after: { last4: bank.iban.slice(-4) }, note: reason, meta });
  await ensureBankActivation(bank.supplierId);
  return updated;
}

export type Decision = "approve" | "reject" | "needs_info" | "suspend" | "reinstate";

export async function decideSupplier(admin: Actor, supplierId: string, action: Decision, note: string | undefined, meta: RequestMeta) {
  const supplier = await getSupplierForAdmin(supplierId);
  if (!supplier) throw new AppError("NOT_FOUND");
  const needsNote = action !== "approve";
  if (needsNote && !note?.trim()) throw new AppError("VALIDATION", { field: "note" });

  const allowedFrom: Record<Decision, SupplierStatus[]> = {
    approve: ["PENDING"],
    reject: ["PENDING", "NEEDS_INFO"],
    needs_info: ["PENDING"],
    suspend: ["ACTIVE", "PAUSED"],
    reinstate: ["SUSPENDED", "PAUSED"],
  };
  if (!allowedFrom[action].includes(supplier.status)) throw new AppError("NOT_EDITABLE");

  const owner = supplier.members.find((m) => m.role === "OWNER");
  if (action === "approve") {
    if (!owner) throw new AppError("INCOMPLETE");
    const checklist = await buildChecklist(supplier, owner.userId);
    if (!checklist.approveReady) throw new AppError("INCOMPLETE", { details: { missing: checklist.blockers } });
  }
  if (action === "reinstate" && owner) {
    const { accepted } = await hasAcceptedCurrent({ userId: owner.userId, supplierId, type: agreementTypeFor(supplier.type) });
    if (!accepted) throw new AppError("INCOMPLETE", { details: { missing: ["agreement"] } });
  }

  const next: Record<Decision, SupplierStatus> = {
    approve: "ACTIVE", reject: "REJECTED", needs_info: "NEEDS_INFO", suspend: "SUSPENDED", reinstate: "ACTIVE",
  };

  await db.$transaction(async (tx) => {
    await tx.supplier.update({
      where: { id: supplierId },
      data: { status: next[action], pauseReason: action === "reinstate" ? null : undefined, decidedAt: new Date(), decidedById: admin.id, decisionNote: note?.trim() || null },
    });
    if (action === "approve") {
      const pending = await tx.bankAccount.findFirst({
        where: { supplierId, status: "PENDING", reviewedAt: { not: null } },
        orderBy: { createdAt: "desc" },
      });
      if (pending) {
        await tx.bankAccount.updateMany({ where: { supplierId, status: "ACTIVE" }, data: { status: "REPLACED" } });
        await tx.bankAccount.update({ where: { id: pending.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
      }
    }
    await audit({ actor: admin, action: `supplier.${action}`, entity: "Supplier", entityId: supplierId, before: { status: supplier.status }, after: { status: next[action] }, note, meta }, tx);
  });

  const messages: Partial<Record<Decision, string>> = {
    approve: "سبيل: تم اعتماد حسابك كمورّد. يمكنك الآن استقبال الطلبات.",
    reject: "سبيل: تعذّر اعتماد طلب التسجيل. راجع ملاحظات الإدارة في حسابك.",
    needs_info: "سبيل: نحتاج معلومات إضافية لإكمال مراجعة طلبك. راجع حسابك.",
    suspend: "سبيل: تم تعليق حسابك كمورّد. راجع حسابك لمعرفة السبب.",
    reinstate: "سبيل: أُعيد تفعيل حسابك كمورّد.",
  };
  await notifyOwner(supplierId, `supplier.${action}`, messages[action]!, { supplierId, note: note ?? null });
  return getSupplierForAdmin(supplierId);
}

export function getSupplierForAdmin(id: string) {
  return db.supplier.findUnique({
    where: { id },
    include: {
      documents: { orderBy: { createdAt: "desc" } },
      bankAccounts: { orderBy: { createdAt: "desc" } },
      members: { include: { user: { select: { id: true, mobile: true, name: true } } } },
      acceptances: { orderBy: { acceptedAt: "desc" } },
    },
  });
}

export function listSuppliers(status?: SupplierStatus) {
  return db.supplier.findMany({
    where: status ? { status } : {},
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    include: { members: { include: { user: { select: { name: true, mobile: true } } } } },
    take: 200,
  });
}
