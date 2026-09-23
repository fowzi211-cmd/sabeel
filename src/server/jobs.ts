import { expireOverdueOrders, retryEscalatedOrders } from "./fulfilment";
import { closeReviewWindow, sendConfirmReminders, sendPaymentReminders } from "./payments";
import { escalateOverdueInvoices, generateInvoices, sendInvoiceReminders } from "./fees";
import { sendReviewPromptReminders } from "./reviews";
import { sendDocumentExpiryNotices } from "./compliance";
import { sendReacceptanceNudges } from "./terms";
import { purgeStaleDriverLocations } from "./privacy";

const INTERVAL_MS = 60_000;
const g = globalThis as unknown as { __sabeelJobsTimer?: ReturnType<typeof setInterval>; __sabeelJobsBusy?: boolean };

/**
 * One pass of the background work. Every step is idempotent and takes per-order locks (or a conditional
 * update), so it is safe if two app instances (or a developer's manual run) overlap. Slice 3: supplier-
 * acceptance expiry and re-offering escalated orders. Slice 4: confirmation and payment reminders, sending
 * silent orders to admin review, and closing paid orders after the 30-day review window. Slice 5: generating
 * fee invoices from unbilled accruals, invoice reminders and the pause/suspend escalation ladder, and
 * review-prompt reminders. Slice 6: supplier document-expiry notices, agreement re-acceptance nudges, and
 * purging stale driver-location pins (design pack `documents.expiry_check` / `agreements.reacceptance_check`
 * / `privacy.purge_location_pings`).
 */
export async function runJobsOnce(now: Date = new Date()) {
  const expiry = await expireOverdueOrders(now);
  const retry = await retryEscalatedOrders(now);
  const confirmReminders = await sendConfirmReminders(now);
  const paymentReminders = await sendPaymentReminders(now);
  const closed = await closeReviewWindow(now);
  const invoicesGenerated = await generateInvoices(now);
  const invoiceReminders = await sendInvoiceReminders(now);
  const invoiceEscalation = await escalateOverdueInvoices(now);
  const reviewPrompts = await sendReviewPromptReminders(now);
  const documentExpiry = await sendDocumentExpiryNotices(now);
  const reacceptanceNudges = await sendReacceptanceNudges();
  const locationPurge = await purgeStaleDriverLocations(now);
  const result = {
    expiry, retry, confirmReminders, paymentReminders, closed, invoicesGenerated, invoiceReminders, invoiceEscalation,
    reviewPrompts, documentExpiry, reacceptanceNudges, locationPurge,
  };
  const noisy =
    expiry.checked > 0 || retry.checked > 0 || Object.values(confirmReminders).some(Boolean) || Object.values(paymentReminders).some(Boolean) ||
    closed.closed > 0 || invoicesGenerated.invoiced > 0 || Object.values(invoiceReminders).some(Boolean) || Object.values(invoiceEscalation).some(Boolean) ||
    reviewPrompts.reminded > 0 || Object.values(documentExpiry).some(Boolean) || reacceptanceNudges.notified > 0 || Object.values(locationPurge).some(Boolean);
  if (noisy) console.log("[jobs]", JSON.stringify(result));
  return result;
}

/** Starts the once-a-minute loop inside the server process (see src/instrumentation.ts). Idempotent across hot reloads. */
export function startJobs() {
  if (g.__sabeelJobsTimer) return;
  g.__sabeelJobsTimer = setInterval(() => {
    if (g.__sabeelJobsBusy) return;
    g.__sabeelJobsBusy = true;
    runJobsOnce()
      .catch((e) => console.error("[jobs] pass failed", e))
      .finally(() => (g.__sabeelJobsBusy = false));
  }, INTERVAL_MS);
  g.__sabeelJobsTimer.unref?.();
  console.log(`[jobs] background jobs started (every ${INTERVAL_MS / 1000}s)`);
}
