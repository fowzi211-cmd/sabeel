"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { fmtWhen } from "@/lib/format";
import { formatSar } from "@/lib/money";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, btnCls, inputCls } from "./ui";
import type { PaymentView } from "./BuyerPaymentCard";

/** T: BUYER_MARKED_PAID → RECEIVED / DUE, and the supplier's own non-payment report. */
export function SupplierPaymentActions({ orderId, payment, hasOpenDispute }: { orderId: string; payment: PaymentView; hasOpenDispute: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNotReceived, setShowNotReceived] = useState(false);
  const [notReceivedNote, setNotReceivedNote] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [reportNote, setReportNote] = useState("");

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(null);
    }
  }

  const tone = payment.status === "RECEIVED" ? "ok" : payment.status === "OVERDUE" || payment.status === "DISPUTED" ? "bad" : "info";

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{t("sorders.paymentTitle")}</h2>
        <Chip tone={tone}>{t(`payment.status.${payment.status}`)}</Chip>
      </div>
      {error ? <div className="mb-3"><Banner tone="bad" role="alert">{error}</Banner></div> : null}
      <dl className="mb-3">
        <div className="grid gap-1 border-t border-line py-2 sm:grid-cols-[170px_1fr] first:border-0"><dt className="text-sm text-muted">{t("payment.transactionNo")}</dt><dd className="ltr-iso font-mono">{payment.transactionNo}</dd></div>
        <div className="grid gap-1 border-t border-line py-2 sm:grid-cols-[170px_1fr]"><dt className="text-sm text-muted">{t("payment.amount")}</dt><dd className="font-medium">{formatSar(payment.amountHalalas, locale)}</dd></div>
        <div className="grid gap-1 border-t border-line py-2 sm:grid-cols-[170px_1fr]"><dt className="text-sm text-muted">{t("payment.dueDate")}</dt><dd className="font-medium">{fmtWhen(payment.dueAt, locale)}</dd></div>
        {payment.markedPaidAt ? (
          <div className="grid gap-1 border-t border-line py-2 sm:grid-cols-[170px_1fr]">
            <dt className="text-sm text-muted">{t("payment.markPaidTitle")}</dt>
            <dd className="font-medium">
              {t("sorders.buyerMarkedPaid", { date: payment.paymentDate ? fmtWhen(payment.paymentDate, locale) : "", ref: payment.bankReference ?? "" })}
              {payment.receiptUrl ? <> · <a className="text-aqua-700 underline" href={payment.receiptUrl} target="_blank" rel="noreferrer">{t("payment.viewReceipt")}</a></> : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {payment.status === "DUE" || payment.status === "OVERDUE" ? <Banner tone="info">{t("sorders.waitingBuyerPay")}</Banner> : null}
      {payment.status === "RECEIVED" ? <Banner tone="ok">{t("sorders.paidBanner")}</Banner> : null}

      {payment.status === "BUYER_MARKED_PAID" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={btnCls("primary")} disabled={!!busy} onClick={() => run("received", () => api(`/supplier/orders/${orderId}/payment/mark-received`, { method: "POST", body: {} }))}>
            {busy === "received" ? t("common.loading") : t("sorders.markReceived")}
          </button>
          <button type="button" className={btnCls("secondary")} disabled={!!busy} onClick={() => setShowNotReceived((v) => !v)} aria-expanded={showNotReceived}>
            {t("sorders.markNotReceived")}
          </button>
        </div>
      ) : null}
      {showNotReceived ? (
        <div className="mt-3 space-y-2 rounded-[10px] border border-line p-3">
          <label htmlFor="nr-note" className="block text-sm font-medium">{t("sorders.notReceivedNote")}</label>
          <textarea id="nr-note" className={`${inputCls} min-h-16`} maxLength={300} value={notReceivedNote} onChange={(e) => setNotReceivedNote(e.target.value)} />
          <button type="button" className={btnCls("danger")} disabled={!!busy || notReceivedNote.trim().length < 2} onClick={() => run("notReceived", () => api(`/supplier/orders/${orderId}/payment/not-received`, { body: { note: notReceivedNote.trim() } }))}>
            {t("sorders.notReceivedSubmit")}
          </button>
        </div>
      ) : null}

      {(payment.status === "DUE" || payment.status === "OVERDUE") && !hasOpenDispute ? (
        <div className="mt-3 border-t border-line pt-3">
          <button type="button" className={btnCls("ghost", "!px-0")} onClick={() => setShowReport((v) => !v)} aria-expanded={showReport}>{t("sorders.reportNonPayment")}</button>
          {showReport ? (
            <div className="mt-2 space-y-2">
              <label htmlFor="np-note" className="block text-sm font-medium">{t("sorders.nonPaymentNote")}</label>
              <textarea id="np-note" className={`${inputCls} min-h-16`} maxLength={500} value={reportNote} onChange={(e) => setReportNote(e.target.value)} />
              <button type="button" className={btnCls("danger")} disabled={!!busy || reportNote.trim().length < 2} onClick={() => run("report", () => api(`/supplier/orders/${orderId}/payment/dispute`, { body: { note: reportNote.trim() } }))}>
                {t("sorders.nonPaymentSubmit")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
