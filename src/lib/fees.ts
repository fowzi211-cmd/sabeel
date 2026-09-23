// Pure fee-accrual, invoice-period and credit-ceiling rules (design pack §G "fee security", §6.3).
// No database here so they are easy to test.

import {
  CEILING_WARN_70, CEILING_WARN_90, ESTABLISHED_CEILING_HALALAS, INVOICE_DUE_DAYS, INVOICE_GRACE_DAYS,
  INVOICE_SUSPEND_AFTER_DAYS, NEW_SUPPLIER_CEILING_HALALAS, ONTIME_INVOICES_FOR_ESTABLISHED,
} from "./fulfilment";
import { VAT_PERCENT } from "./money";

const DAY = 86_400_000;
const RIYADH_OFFSET_MS = 3 * 3_600_000;
export type InvoiceCycle = "WEEKLY" | "MONTHLY";

/** The fee on one delivered order and the VAT on top of it (the fee itself is quoted excl. VAT — R02/R03). */
export function accrualAmounts(deliveredFeeHalalas: number): { amountHalalas: number; vatHalalas: number } {
  return { amountHalalas: deliveredFeeHalalas, vatHalalas: Math.round((deliveredFeeHalalas * VAT_PERCENT) / 100) };
}

/** The invoicing period a moment falls in: a Riyadh calendar week (Saturday–Friday) or calendar month. */
export function periodFor(cycle: InvoiceCycle, at: Date): { start: Date; end: Date } {
  const local = new Date(at.getTime() + RIYADH_OFFSET_MS); // read with getUTC* = Riyadh wall clock
  if (cycle === "MONTHLY") {
    const y = local.getUTCFullYear();
    const m = local.getUTCMonth();
    return { start: new Date(Date.UTC(y, m, 1) - RIYADH_OFFSET_MS), end: new Date(Date.UTC(y, m + 1, 1) - RIYADH_OFFSET_MS) };
  }
  const dow = local.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const sinceSaturday = (dow + 1) % 7; // Saturday is day 0 of the Saudi week
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const start = Date.UTC(y, m, d - sinceSaturday) - RIYADH_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + 7 * DAY) };
}

export const invoiceDueAt = (issuedAt: Date): Date => new Date(issuedAt.getTime() + INVOICE_DUE_DAYS * DAY);
export const invoicePauseAt = (dueAt: Date): Date => new Date(dueAt.getTime() + INVOICE_GRACE_DAYS * DAY);
export const invoiceSuspendAt = (dueAt: Date): Date => new Date(dueAt.getTime() + INVOICE_SUSPEND_AFTER_DAYS * DAY);

/** "Paid on time" is judged by when the supplier said they paid, against the due date (mirrors payments.ts). */
export const isInvoiceOnTime = (paymentDate: Date | null, dueAt: Date): boolean => !!paymentDate && paymentDate.getTime() <= dueAt.getTime();

export type CeilingBand = "ok" | "warn70" | "warn90" | "over";

/** How close a supplier's total exposure (unbilled fees + open invoices) is to its credit ceiling. */
export function ceilingBand(exposureHalalas: number, ceilingHalalas: number): CeilingBand {
  if (ceilingHalalas <= 0) return "over";
  const ratio = exposureHalalas / ceilingHalalas;
  if (ratio >= 1) return "over";
  if (ratio >= CEILING_WARN_90) return "warn90";
  if (ratio >= CEILING_WARN_70) return "warn70";
  return "ok";
}

/** A run of on-time invoices earns the established ceiling + monthly billing (design pack R04/R05). */
export const earnsEstablishedStatus = (onTimeInvoiceCount: number): boolean => onTimeInvoiceCount >= ONTIME_INVOICES_FOR_ESTABLISHED;
export const ceilingFor = (established: boolean): number => (established ? ESTABLISHED_CEILING_HALALAS : NEW_SUPPLIER_CEILING_HALALAS);
