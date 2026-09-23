// Fulfilment rules that are policy, not code: the owner can tune them here (design pack §6, R10, R11).

/** How long a supplier has to accept before the order is offered to the next one. */
export const ACCEPT_SLA_HOURS = 2;
/** A failed delivery can be rescheduled once; after the second failed trip only cancel/admin remain (T11). */
export const MAX_DELIVERY_ATTEMPTS = 2;
/** Proof needs at least this many in-app photos, one of them showing the brand label + batch/expiry. */
export const MIN_PROOF_PHOTOS = 2;
export const MAX_PROOF_PHOTOS = 8;
/** GPS readings worse than this many metres are treated as "no reliable position". */
export const MAX_GPS_ACCURACY_M = 150;
/** A phone clock this far off the server's is suspicious (or just wrong) — flag for review. */
export const MAX_CLOCK_SKEW_MS = 10 * 60_000;
/** Recipient delivery code: how many sends per delivery. */
export const MAX_RECIPIENT_CODE_SENDS = 3;

/** Pilot rule (R11 + section 12): the admin reviews EVERY delivery. Switch off once the pilot has proved itself. */
export const PILOT_REVIEW_ALL = true;
/** Share of deliveries picked at random for review once PILOT_REVIEW_ALL is off. */
export const AUDIT_SAMPLE_RATE = 0.05;
/** An independent distributor's first deliveries are always reviewed. */
export const PROBATION_DELIVERIES = 10;

export const DECLINE_REASONS = ["OUT_OF_STOCK", "CANNOT_MEET_WINDOW", "TOO_FAR", "PRICE_CHANGED", "OTHER"] as const;
export const FAIL_REASONS = ["RECIPIENT_ABSENT", "WRONG_ADDRESS", "ACCESS_BLOCKED", "RECIPIENT_REFUSED", "VEHICLE_PROBLEM", "OTHER"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];
export type FailReason = (typeof FAIL_REASONS)[number];

// ───────────────────────── slice 4: confirmation, payment, disputes ─────────────────────────

/** How long the buyer has to pay the supplier once both sides have confirmed the delivery (design pack §6.2). */
export const PAYMENT_DUE_DAYS = 3;
/** Silence after delivery: reminders at these hours, then the order goes to admin review (T13). */
export const CONFIRM_REMINDER_HOURS = [24, 48] as const;
export const CONFIRM_ADMIN_REVIEW_HOURS = 72;
/** Payment reminders: this long before the due date, and this long after it if still unpaid. */
export const PAYMENT_REMINDER_BEFORE_HOURS = 24;
export const PAYMENT_REMINDER_FOLLOWUP_DAYS = 2;
/** A paid order is closed (and its numbers final) this many days after payment is confirmed received (T18). */
export const REVIEW_WINDOW_DAYS = 30;

export const DISPUTE_CATEGORIES = ["NOT_DELIVERED", "SHORT", "WRONG_BRAND", "DAMAGED", "LATE", "OTHER"] as const;
export const DELIVERY_DISPUTE_OUTCOMES = ["REDELIVER", "PRICE_ADJUSTMENT", "CANCEL", "DISMISS"] as const;
export const PAYMENT_DISPUTE_OUTCOMES = ["PAYMENT_RECEIVED", "PAYMENT_STILL_DUE", "PAYMENT_VOID"] as const;
export type DisputeCategoryInput = (typeof DISPUTE_CATEGORIES)[number];

// ───────────────────────── slice 5: fee accrual, invoicing, reviews ─────────────────────────

/** The most Sabeel can be owed at once (design pack "fee security" §2). Editable per supplier by an admin. */
export const NEW_SUPPLIER_CEILING_HALALAS = 25_000; // SAR 250 — new suppliers and independents
export const ESTABLISHED_CEILING_HALALAS = 100_000; // SAR 1,000 — after a run of on-time invoices
export const CEILING_WARN_70 = 0.7;
export const CEILING_WARN_90 = 0.9;
/** Consecutive fee invoices paid by their due date before the ceiling rises and billing moves to monthly. */
export const ONTIME_INVOICES_FOR_ESTABLISHED = 4;

/** A fee-rule change must be disclosed at least this many days before it takes effect (design pack §G, "disclosed"). */
export const FEE_CHANGE_NOTICE_DAYS = 30;

/** Fee invoices are due 7 days after issue, with 7 days' grace before the escalation ladder pauses the supplier. */
export const INVOICE_DUE_DAYS = 7;
export const INVOICE_GRACE_DAYS = 7;
/** After the grace period a supplier is paused; this many more days unresolved and it is suspended. */
export const INVOICE_SUSPEND_AFTER_DAYS = 14;
export const INVOICE_REMINDER_BEFORE_DAYS = 3;

/** How long a buyer has to leave a review after the order closes (design pack §H) — the same window T18 uses. */
export const REVIEW_SUBMIT_WINDOW_DAYS = REVIEW_WINDOW_DAYS;
/** Review prompt reminders (N15): now (at confirmation), then these hours later if still unreviewed. */
export const REVIEW_REMINDER_HOURS = [24, 72] as const;
/** A supplier's rating shows "New" until this many reviews are in (design pack §H). */
export const REVIEWS_UNTIL_RATED = 3;

export const REVIEW_CATEGORIES = ["timeliness", "asOrdered", "packaging", "driverConduct", "value"] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];
