// Pure payment/confirmation rules (design pack §6.2, T12–T18). No database here so they are easy to test.

import { PAYMENT_DUE_DAYS } from "./fulfilment";

const DAY = 86_400_000;

/** The payment clock starts the moment both sides have confirmed the delivery. */
export const dueAtFrom = (now: Date): Date => new Date(now.getTime() + PAYMENT_DUE_DAYS * DAY);

/** "Paid on time" is judged by when the buyer said they paid, against the due date — not when the supplier got round to confirming it. */
export const isOnTime = (markedPaidAt: Date | null, dueAt: Date): boolean => !!markedPaidAt && markedPaidAt.getTime() <= dueAt.getTime();

/** A dispute may lower the price before payment becomes due; otherwise the order's own total is what is owed. */
export const amountOwedFor = (totalHalalas: number, adjustedTotalHalalas: number | null): number => adjustedTotalHalalas ?? totalHalalas;

/** A price adjustment can only ever reduce what the buyer owes, never raise it. */
export const isValidAdjustment = (adjustedTotalHalalas: number, totalHalalas: number): boolean =>
  Number.isInteger(adjustedTotalHalalas) && adjustedTotalHalalas > 0 && adjustedTotalHalalas <= totalHalalas;
