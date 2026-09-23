import { z } from "zod";
import { Prisma, type FeeInvoice, type Order, type ProofOfDelivery, type Role, type Supplier, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import {
  accrualAmounts, ceilingBand, earnsEstablishedStatus, invoiceDueAt, invoicePauseAt, invoiceSuspendAt, isInvoiceOnTime, periodFor,
} from "@/lib/fees";
import { ESTABLISHED_CEILING_HALALAS, FEE_CHANGE_NOTICE_DAYS, INVOICE_REMINDER_BEFORE_DAYS, ONTIME_INVOICES_FOR_ESTABLISHED } from "@/lib/fulfilment";
import { formatSar } from "@/lib/money";
import { deleteUpload, saveInvoiceReceipt } from "./storage";
import { notifySupplier } from "./notify";
import { checkRateLimit } from "@/lib/rateLimit";

type Actor = { id: string; roles: Role[] };
const TX = { timeout: 20_000, maxWait: 10_000 };
const DAY = 86_400_000;

async function nextInvoiceNo(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('sabeel_invoice_no_seq') AS n`;
  return `SBL-INV-${new Date().getUTCFullYear()}-${String(rows[0].n).padStart(6, "0")}`;
}

// ───────────────────────── accrual (created the moment an order is confirmed) ─────────────────────────

/** The one place a fee is ever decided — from the DELIVERED quantity on the order's own proof (FR-FEE-11). */
export async function createFeeAccrual(
  tx: Prisma.TransactionClient,
  order: Pick<Order, "id" | "supplierId" | "feePerPacketHalalas">,
  proof: Pick<ProofOfDelivery, "deliveredPacketEqMilli" | "deliveredFeeHalalas">,
) {
  const { amountHalalas, vatHalalas } = accrualAmounts(proof.deliveredFeeHalalas);
  await tx.feeAccrual.create({
    data: {
      orderId: order.id, supplierId: order.supplierId,
      packetEqMilli: proof.deliveredPacketEqMilli, ratePerPacketHalalas: order.feePerPacketHalalas,
      amountHalalas, vatHalalas,
    },
  });
}

/** Unbilled accruals + open invoices — what Sabeel is currently owed by this supplier. */
export async function supplierExposureHalalas(supplierId: string): Promise<number> {
  const [unbilled, open] = await Promise.all([
    db.feeAccrual.aggregate({ where: { supplierId, invoiceId: null }, _sum: { amountHalalas: true, vatHalalas: true } }),
    db.feeInvoice.aggregate({ where: { supplierId, status: { in: ["ISSUED", "PAYMENT_SUBMITTED", "OVERDUE"] } }, _sum: { totalHalalas: true } }),
  ]);
  return (unbilled._sum.amountHalalas ?? 0) + (unbilled._sum.vatHalalas ?? 0) + (open._sum.totalHalalas ?? 0);
}

/** A per-day dedup for exposure warnings — a supplier owner should see it at most once a day, not on every order. */
async function warnedToday(event: string, supplierId: string, now: Date): Promise<boolean> {
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  return !!(await db.notification.findFirst({ where: { event, payload: { path: ["supplierId"], equals: supplierId }, createdAt: { gte: dayStart } } }));
}

/** Called after a fee accrues: warn near the ceiling, and pause automatically once exposure reaches it. */
export async function checkCeilingAndPause(supplierId: string, now: Date = new Date()) {
  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return;
  const exposure = await supplierExposureHalalas(supplierId);
  const band = ceilingBand(exposure, supplier.creditCeilingHalalas);

  if (band === "over") {
    const changed = await db.supplier.updateMany({ where: { id: supplierId, status: "ACTIVE" }, data: { status: "PAUSED", pauseReason: "ceiling" } });
    if (changed.count > 0) {
      await notifySupplier(supplierId, "fee.ceiling_paused", {
        ar: `سبيل: بلغ رصيد الرسوم المستحقة حدّك الائتماني (${formatSar(supplier.creditCeilingHalalas, "ar")}). أُوقف استقبال طلبات جديدة مؤقتاً حتى تسوية الفواتير المستحقة.`,
        en: `Sabeel: your outstanding fees reached your credit ceiling (${formatSar(supplier.creditCeilingHalalas, "en")}). New orders are paused until your invoices are settled.`,
      }, { supplierId });
    }
    return;
  }
  if ((band === "warn90" || band === "warn70") && !(await warnedToday(`fee.ceiling_${band}`, supplierId, now))) {
    await notifySupplier(supplierId, `fee.ceiling_${band}`, {
      ar: `سبيل: بلغ رصيد الرسوم المستحقة ${band === "warn90" ? "90%" : "70%"} من حدّك الائتماني (${formatSar(supplier.creditCeilingHalalas, "ar")}). سدّد فواتيرك المفتوحة لتفادي إيقاف الطلبات.`,
      en: `Sabeel: your outstanding fees reached ${band === "warn90" ? "90%" : "70%"} of your credit ceiling (${formatSar(supplier.creditCeilingHalalas, "en")}). Settle your open invoices to avoid a pause on new orders.`,
    }, { supplierId });
  }
}

/** Once the reason a supplier was auto-paused is gone, it goes back to ACTIVE on its own. */
async function reinstateIfClear(supplierId: string, reason: "ceiling" | "invoice_grace") {
  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || supplier.status !== "PAUSED" || supplier.pauseReason !== reason) return;
  if (reason === "ceiling") {
    const exposure = await supplierExposureHalalas(supplierId);
    if (ceilingBand(exposure, supplier.creditCeilingHalalas) === "over") return;
  } else {
    const stillOverdue = await db.feeInvoice.findFirst({ where: { supplierId, status: "OVERDUE" } });
    if (stillOverdue) return;
  }
  const changed = await db.supplier.updateMany({ where: { id: supplierId, status: "PAUSED", pauseReason: reason }, data: { status: "ACTIVE", pauseReason: null } });
  if (changed.count > 0) {
    await notifySupplier(supplierId, "fee.reinstated", { ar: "سبيل: أُعيد تفعيل حسابك ويمكنك استقبال طلبات جديدة.", en: "Sabeel: your account is active again and can receive new orders." }, { supplierId });
  }
}

// ───────────────────────── invoicing (system-generated only) ─────────────────────────

/** Groups every supplier's unbilled accruals into their invoicing periods and bills every period that has closed. */
export async function generateInvoices(now: Date = new Date(), limit = 200) {
  const stats = { invoiced: 0, suppliersChecked: 0 };
  const suppliers = await db.supplier.findMany({ where: { feeAccruals: { some: { invoiceId: null } } }, select: { id: true, invoiceCycle: true }, take: limit });

  for (const supplier of suppliers) {
    stats.suppliersChecked++;
    const unbilled = await db.feeAccrual.findMany({ where: { supplierId: supplier.id, invoiceId: null }, orderBy: { accruedAt: "asc" } });
    const groups = new Map<string, { start: Date; end: Date; rows: typeof unbilled }>();
    for (const a of unbilled) {
      const p = periodFor(supplier.invoiceCycle, a.accruedAt);
      if (p.end > now) continue; // the period this accrual falls in has not closed yet
      const key = p.start.toISOString();
      if (!groups.has(key)) groups.set(key, { start: p.start, end: p.end, rows: [] });
      groups.get(key)!.rows.push(a);
    }

    for (const { start, end, rows } of groups.values()) {
      const invoice = await db.$transaction(async (tx) => {
        const subtotal = rows.reduce((s, r) => s + r.amountHalalas, 0);
        const vat = rows.reduce((s, r) => s + r.vatHalalas, 0);
        const invoiceNo = await nextInvoiceNo(tx);
        const dueAt = invoiceDueAt(now);
        const created = await tx.feeInvoice.create({
          data: { invoiceNo, supplierId: supplier.id, periodStart: start, periodEnd: end, subtotalHalalas: subtotal, vatHalalas: vat, totalHalalas: subtotal + vat, issuedAt: now, dueAt },
        });
        await tx.feeAccrual.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { invoiceId: created.id } });
        return created;
      }, TX);
      await notifySupplier(supplier.id, "fee_invoice.issued", {
        ar: `سبيل: فاتورة رسوم جديدة ${invoice.invoiceNo} بقيمة ${formatSar(invoice.totalHalalas, "ar")}، مستحقة السداد قبل ${invoice.dueAt.toISOString().slice(0, 10)}.`,
        en: `Sabeel: new fee invoice ${invoice.invoiceNo} for ${formatSar(invoice.totalHalalas, "en")}, due by ${invoice.dueAt.toISOString().slice(0, 10)}.`,
      }, { invoiceId: invoice.id });
      stats.invoiced++;
    }
  }
  return stats;
}

const alreadyNotified = (event: string, invoiceId: string) => db.notification.findFirst({ where: { event, payload: { path: ["invoiceId"], equals: invoiceId } } }).then((n) => !!n);

/** Reminds a supplier ahead of an invoice's due date, then moves it ISSUED → OVERDUE once it passes. */
export async function sendInvoiceReminders(now: Date = new Date(), limit = 200) {
  const stats = { reminded: 0, wentOverdue: 0 };

  const upcoming = await db.feeInvoice.findMany({ where: { status: "ISSUED", dueAt: { gt: now, lte: new Date(now.getTime() + INVOICE_REMINDER_BEFORE_DAYS * DAY) } }, take: limit });
  for (const inv of upcoming) {
    if (await alreadyNotified("fee_invoice.reminder", inv.id)) continue;
    await notifySupplier(inv.supplierId, "fee_invoice.reminder", {
      ar: `سبيل: فاتورة الرسوم ${inv.invoiceNo} (${formatSar(inv.totalHalalas, "ar")}) مستحقة قريباً.`,
      en: `Sabeel: fee invoice ${inv.invoiceNo} (${formatSar(inv.totalHalalas, "en")}) is due soon.`,
    }, { invoiceId: inv.id });
    stats.reminded++;
  }

  const overdue = await db.feeInvoice.findMany({ where: { status: "ISSUED", dueAt: { lte: now } }, take: limit });
  for (const inv of overdue) {
    const changed = await db.feeInvoice.updateMany({ where: { id: inv.id, status: "ISSUED" }, data: { status: "OVERDUE" } });
    if (changed.count === 0) continue;
    await notifySupplier(inv.supplierId, "fee_invoice.overdue", {
      ar: `سبيل: تجاوزت فاتورة الرسوم ${inv.invoiceNo} (${formatSar(inv.totalHalalas, "ar")}) موعد الاستحقاق. سدّدها لتفادي إيقاف حسابك.`,
      en: `Sabeel: fee invoice ${inv.invoiceNo} (${formatSar(inv.totalHalalas, "en")}) is past due. Settle it to avoid a pause on your account.`,
    }, { invoiceId: inv.id });
    stats.wentOverdue++;
  }
  return stats;
}

/** The escalation ladder: unresolved OVERDUE invoices pause the supplier, then suspend it (design pack §G). */
export async function escalateOverdueInvoices(now: Date = new Date(), limit = 200) {
  const stats = { paused: 0, suspended: 0 };
  const overdue = await db.feeInvoice.findMany({ where: { status: "OVERDUE" }, take: limit });
  for (const inv of overdue) {
    const pauseAt = invoicePauseAt(inv.dueAt);
    const suspendAt = invoiceSuspendAt(inv.dueAt);
    if (now >= suspendAt) {
      const changed = await db.supplier.updateMany({ where: { id: inv.supplierId, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "SUSPENDED", pauseReason: "invoice_grace" } });
      if (changed.count > 0) {
        await notifySupplier(inv.supplierId, "fee_invoice.suspended", {
          ar: `سبيل: عُلّق حسابك كمورّد لعدم سداد فاتورة الرسوم ${inv.invoiceNo}. تواصل مع الدعم لتسوية الأمر.`,
          en: `Sabeel: your supplier account was suspended for the unpaid fee invoice ${inv.invoiceNo}. Contact support to resolve it.`,
        }, { invoiceId: inv.id });
        stats.suspended++;
      }
    } else if (now >= pauseAt) {
      const changed = await db.supplier.updateMany({ where: { id: inv.supplierId, status: "ACTIVE" }, data: { status: "PAUSED", pauseReason: "invoice_grace" } });
      if (changed.count > 0) {
        await notifySupplier(inv.supplierId, "fee_invoice.paused", {
          ar: `سبيل: أُوقف استقبال طلبات جديدة لتجاوز فاتورة الرسوم ${inv.invoiceNo} مهلة السماح. سدّدها في أقرب وقت.`,
          en: `Sabeel: new orders are paused because fee invoice ${inv.invoiceNo} passed its grace period. Please settle it soon.`,
        }, { invoiceId: inv.id });
        stats.paused++;
      }
    }
  }
  return stats;
}

// ───────────────────────── supplier payment actions ─────────────────────────

export const submitInvoicePaymentSchema = z.object({ paymentDate: z.coerce.date(), bankReference: z.string().trim().min(1).max(60) });

export async function submitInvoicePayment(user: User, supplier: Supplier, invoiceId: string, input: z.infer<typeof submitInvoicePaymentSchema>, file: File | null, meta: RequestMeta, now: Date = new Date()) {
  checkRateLimit(`invoice.submit_payment:${supplier.id}`, 10, 60 * 60_000);
  const invoice = await db.feeInvoice.findFirst({ where: { id: invoiceId, supplierId: supplier.id } });
  if (!invoice) throw new AppError("NOT_FOUND");
  if (!["ISSUED", "OVERDUE"].includes(invoice.status)) throw new AppError("INVALID_STATE");
  if (input.paymentDate.getTime() > now.getTime() + DAY) throw new AppError("VALIDATION", { field: "paymentDate" });

  const receipt = file ? await saveInvoiceReceipt(invoiceId, file) : null;
  try {
    await db.$transaction(async (tx) => {
      const fresh = await tx.feeInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (!["ISSUED", "OVERDUE"].includes(fresh.status)) throw new AppError("INVALID_STATE");
      await tx.feeInvoice.update({
        where: { id: invoiceId },
        data: { status: "PAYMENT_SUBMITTED", paymentDate: input.paymentDate, bankReference: input.bankReference.trim(), submittedAt: now, ...(receipt ? { receiptFileKey: receipt.fileKey, receiptMime: receipt.mime } : {}) },
      });
      await audit({ actor: { id: user.id, roles: user.roles }, action: "fee_invoice.submitted", entity: "FeeInvoice", entityId: invoiceId, after: { bankReference: input.bankReference }, meta }, tx);
    }, TX);
  } catch (e) {
    if (receipt) await deleteUpload(receipt.fileKey);
    throw e;
  }
  return db.feeInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
}

// ───────────────────────── admin actions ─────────────────────────

async function bumpOnTimeAndMaybeUpgrade(tx: Prisma.TransactionClient, supplierId: string, onTime: boolean) {
  const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId } });
  const count = onTime ? supplier.onTimeInvoiceCount + 1 : 0;
  const upgrade = onTime && earnsEstablishedStatus(count) && supplier.creditCeilingHalalas < ESTABLISHED_CEILING_HALALAS;
  await tx.supplier.update({
    where: { id: supplierId },
    data: { onTimeInvoiceCount: count, ...(upgrade ? { creditCeilingHalalas: ESTABLISHED_CEILING_HALALAS, invoiceCycle: "MONTHLY" } : {}) },
  });
  return upgrade;
}

/** Admin confirms a supplier's self-reported invoice payment arrived. */
export async function confirmInvoicePayment(admin: Actor, invoiceId: string, meta: RequestMeta, now: Date = new Date()) {
  const invoice = await db.feeInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new AppError("NOT_FOUND");
  if (invoice.status !== "PAYMENT_SUBMITTED") throw new AppError("INVALID_STATE");

  const upgraded = await db.$transaction(async (tx) => {
    const fresh = await tx.feeInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (fresh.status !== "PAYMENT_SUBMITTED") throw new AppError("INVALID_STATE");
    await tx.feeInvoice.update({ where: { id: invoiceId }, data: { status: "PAID", confirmedById: admin.id, confirmedAt: now } });
    const onTime = isInvoiceOnTime(fresh.paymentDate, fresh.dueAt);
    const up = await bumpOnTimeAndMaybeUpgrade(tx, fresh.supplierId, onTime);
    await audit({ actor: admin, action: "fee_invoice.confirmed", entity: "FeeInvoice", entityId: invoiceId, after: { onTime, upgraded: up }, meta }, tx);
    return up;
  }, TX);

  await notifySupplier(invoice.supplierId, "fee_invoice.paid", { ar: `سبيل: أكّدت الإدارة استلام دفعة فاتورة الرسوم ${invoice.invoiceNo}.`, en: `Sabeel: Sabeel confirmed payment was received for fee invoice ${invoice.invoiceNo}.` }, { invoiceId });
  if (upgraded) {
    await notifySupplier(invoice.supplierId, "fee.ceiling_upgraded", {
      ar: `سبيل: تهانينا! بفضل سجلّك في السداد بالموعد رُفع حدّك الائتماني إلى ${formatSar(ESTABLISHED_CEILING_HALALAS, "ar")} وانتقلت الفوترة إلى شهرية.`,
      en: `Sabeel: congratulations — your on-time payment record raised your credit ceiling to ${formatSar(ESTABLISHED_CEILING_HALALAS, "en")} and moved you to monthly billing.`,
    }, { supplierId: invoice.supplierId });
  }
  // Paying an invoice lowers exposure regardless of which reason paused the supplier — check both.
  await reinstateIfClear(invoice.supplierId, "ceiling");
  await reinstateIfClear(invoice.supplierId, "invoice_grace");
  return db.feeInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
}

export const rejectInvoicePaymentSchema = z.object({ note: z.string().trim().min(2).max(300) });

/** Admin says the self-reported payment did not actually arrive — puts the invoice back where it was. */
export async function rejectInvoicePayment(admin: Actor, invoiceId: string, input: z.infer<typeof rejectInvoicePaymentSchema>, meta: RequestMeta, now: Date = new Date()) {
  const invoice = await db.feeInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new AppError("NOT_FOUND");
  if (invoice.status !== "PAYMENT_SUBMITTED") throw new AppError("INVALID_STATE");

  await db.$transaction(async (tx) => {
    const fresh = await tx.feeInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (fresh.status !== "PAYMENT_SUBMITTED") throw new AppError("INVALID_STATE");
    await tx.feeInvoice.update({ where: { id: invoiceId }, data: { status: fresh.dueAt < now ? "OVERDUE" : "ISSUED", rejectReason: input.note.trim(), rejectedAt: now } });
    await audit({ actor: admin, action: "fee_invoice.rejected", entity: "FeeInvoice", entityId: invoiceId, note: input.note, meta }, tx);
  }, TX);

  await notifySupplier(invoice.supplierId, "fee_invoice.rejected", { ar: `سبيل: تعذّر تأكيد دفعة فاتورة الرسوم ${invoice.invoiceNo}. راجع بيانات التحويل وأعد المحاولة.`, en: `Sabeel: the payment for fee invoice ${invoice.invoiceNo} could not be confirmed. Please check the details and try again.` }, { invoiceId });
}

export interface InvoiceListFilter { status?: FeeInvoice["status"]; q?: string }

export const listSupplierInvoices = (supplierId: string, filter: InvoiceListFilter = {}) =>
  db.feeInvoice.findMany({
    where: { supplierId, ...(filter.status ? { status: filter.status } : {}), ...(filter.q ? { invoiceNo: { contains: filter.q, mode: "insensitive" } } : {}) },
    orderBy: { issuedAt: "desc" },
    take: 300,
  });

export const listAdminInvoices = (filter: InvoiceListFilter = {}) =>
  db.feeInvoice.findMany({
    where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.q ? { OR: [{ invoiceNo: { contains: filter.q, mode: "insensitive" } }, { supplier: { tradeName: { contains: filter.q, mode: "insensitive" } } }] } : {}) },
    include: { supplier: { select: { id: true, tradeName: true, legalNameAr: true } } },
    orderBy: { issuedAt: "desc" },
    take: 300,
  });

export const getInvoiceWithAccruals = (id: string) =>
  db.feeInvoice.findUnique({ where: { id }, include: { accruals: { include: { order: { select: { orderNo: true } } } }, supplier: { select: { id: true, tradeName: true, legalNameAr: true, bankAccounts: { where: { status: "ACTIVE" }, take: 1 } } } } });

/** One supplier's fee summary for its own dashboard: exposure, ceiling, band and billing cycle. */
export async function supplierFeeSummary(supplierId: string) {
  const supplier = await db.supplier.findUniqueOrThrow({ where: { id: supplierId } });
  const exposure = await supplierExposureHalalas(supplierId);
  return {
    creditCeilingHalalas: supplier.creditCeilingHalalas,
    invoiceCycle: supplier.invoiceCycle,
    onTimeInvoiceCount: supplier.onTimeInvoiceCount,
    onTimeInvoicesToEstablished: Math.max(0, ONTIME_INVOICES_FOR_ESTABLISHED - supplier.onTimeInvoiceCount),
    exposureHalalas: exposure,
    band: ceilingBand(exposure, supplier.creditCeilingHalalas),
    paused: supplier.status === "PAUSED",
    pauseReason: supplier.pauseReason,
  };
}

/** Admin's exposure dashboard: every supplier with anything outstanding, worst band first. */
export async function adminExposureOverview() {
  const suppliers = await db.supplier.findMany({
    where: { OR: [{ feeAccruals: { some: { invoiceId: null } } }, { feeInvoices: { some: { status: { in: ["ISSUED", "PAYMENT_SUBMITTED", "OVERDUE"] } } } }] },
    select: { id: true, tradeName: true, legalNameAr: true, status: true, pauseReason: true, creditCeilingHalalas: true, invoiceCycle: true },
  });
  const rows = await Promise.all(suppliers.map(async (s) => {
    const exposure = await supplierExposureHalalas(s.id);
    return { ...s, exposureHalalas: exposure, band: ceilingBand(exposure, s.creditCeilingHalalas) };
  }));
  const order = { over: 0, warn90: 1, warn70: 2, ok: 3 };
  return rows.sort((a, b) => order[a.band] - order[b.band] || b.exposureHalalas - a.exposureHalalas);
}

// ───────────────────────── the fee rule itself (admin, editable, disclosed) ─────────────────────────

export const publishFeeRuleSchema = z.object({
  scope: z.enum(["GLOBAL", "SUPPLIER_TYPE", "SUPPLIER", "PACK_SIZE", "PROMO"]).default("GLOBAL"),
  scopeRef: z.string().trim().min(1).max(60).optional(),
  model: z.enum(["FIXED_PER_PACKET", "FIXED_PER_BOTTLE", "PERCENTAGE", "FLAT_PER_ORDER"]).default("FIXED_PER_PACKET"),
  amountHalalas: z.number().int().min(0).max(1_000_000),
  effectiveFrom: z.coerce.date(),
  reason: z.string().trim().min(2).max(300),
});
export type PublishFeeRuleInput = z.infer<typeof publishFeeRuleSchema>;

/** New rules must be disclosed at least FEE_CHANGE_NOTICE_DAYS ahead — the very first rule for a scope may start now. */
export async function publishFeeRule(admin: Actor, input: PublishFeeRuleInput, meta: RequestMeta, now: Date = new Date()) {
  const earliest = new Date(now.getTime() + FEE_CHANGE_NOTICE_DAYS * DAY);
  const current = await db.feeRule.findFirst({ where: { scope: input.scope, scopeRef: input.scopeRef ?? null, model: input.model, effectiveFrom: { lte: now } }, orderBy: { effectiveFrom: "desc" } });
  if (current && input.effectiveFrom.getTime() < earliest.getTime() - 60_000) {
    throw new AppError("VALIDATION", { field: "effectiveFrom", message: `effectiveFrom must be at least ${FEE_CHANGE_NOTICE_DAYS} days ahead` });
  }

  const rule = await db.feeRule.create({
    data: { scope: input.scope, scopeRef: input.scopeRef ?? null, model: input.model, amountHalalas: input.amountHalalas, effectiveFrom: input.effectiveFrom, reason: input.reason, createdById: admin.id },
  });
  await audit({ actor: admin, action: "fee_rule.published", entity: "FeeRule", entityId: rule.id, after: { scope: input.scope, amountHalalas: input.amountHalalas, effectiveFrom: input.effectiveFrom }, note: input.reason, meta });

  if (input.scope === "GLOBAL") {
    const suppliers = await db.supplier.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
    for (const s of suppliers) {
      await notifySupplier(s.id, "fee_rule.changing", {
        ar: `سبيل: سيتغيّر رسم سبيل لكل عبوة إلى ${formatSar(input.amountHalalas, "ar")} اعتباراً من ${input.effectiveFrom.toISOString().slice(0, 10)}. ${input.reason}`,
        en: `Sabeel: the Sabeel fee per packet will change to ${formatSar(input.amountHalalas, "en")} from ${input.effectiveFrom.toISOString().slice(0, 10)}. ${input.reason}`,
      }, { feeRuleId: rule.id }, { sms: false });
    }
  }
  return rule;
}
