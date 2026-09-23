"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { fmtWhen } from "@/lib/format";
import { formatSar } from "@/lib/money";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, btnCls, inputCls } from "./ui";

export interface PaymentView {
  status: string;
  transactionNo: string;
  amountHalalas: number;
  dueAt: string | Date;
  paymentDate: string | Date | null;
  bankReference: string | null;
  hasReceipt: boolean;
  receiptUrl: string | null;
  markedPaidAt: string | Date | null;
  receivedAt: string | Date | null;
  notReceivedNote: string | null;
  notReceivedAt: string | Date | null;
  bank: { iban: string; holderName: string; bankName: string | null } | null;
}

/** T: DUE → BUYER_MARKED_PAID → RECEIVED. The buyer pays the supplier directly and just tells Sabeel about it. */
export function BuyerPaymentCard({ orderId, payment }: { orderId: string; payment: PaymentView }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankReference, setBankReference] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const canPay = payment.status === "DUE" || payment.status === "OVERDUE";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("paymentDate", new Date(paymentDate).toISOString());
      form.set("bankReference", bankReference.trim());
      const file = fileRef.current?.files?.[0];
      if (file) form.set("file", file);
      await api(`/orders/${orderId}/payment/mark-paid`, { form });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const tone = payment.status === "RECEIVED" ? "ok" : payment.status === "OVERDUE" || payment.status === "DISPUTED" ? "bad" : "info";

  return (
    <Card tint>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{t("payment.title")}</h2>
        <Chip tone={tone}>{t(`payment.status.${payment.status}`)}</Chip>
      </div>

      {payment.status === "OVERDUE" ? <div className="mb-3"><Banner tone="bad" role="alert">{t("payment.overdueBanner")}</Banner></div> : null}
      {payment.status === "DISPUTED" ? <div className="mb-3"><Banner tone="warn">{t("payment.disputedBanner")}</Banner></div> : null}
      {payment.status === "VOID" ? <div className="mb-3"><Banner tone="info">{t("payment.voidBanner")}</Banner></div> : null}
      {payment.status === "RECEIVED" ? <div className="mb-3"><Banner tone="ok">{t("payment.receivedBanner")}</Banner></div> : null}
      {payment.status === "BUYER_MARKED_PAID" ? <div className="mb-3"><Banner tone="info">{t("payment.markedPaidBanner", { date: payment.markedPaidAt ? fmtWhen(payment.markedPaidAt, locale) : "" })}</Banner></div> : null}
      {payment.notReceivedNote && payment.status !== "RECEIVED" ? <div className="mb-3"><Banner tone="warn">{t("payment.notReceivedBanner", { note: payment.notReceivedNote })}</Banner></div> : null}

      {payment.bank ? (
        <div className="mb-4 rounded-[10px] border border-line bg-white p-3">
          <h3 className="mb-2 font-semibold">{t("payment.bankTitle")}</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">{t("payment.iban")}</dt><dd className="ltr-iso font-mono">{payment.bank.iban}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">{t("payment.holder")}</dt><dd>{payment.bank.holderName}</dd></div>
            {payment.bank.bankName ? <div className="flex justify-between gap-3"><dt className="text-muted">{t("payment.bankName")}</dt><dd>{payment.bank.bankName}</dd></div> : null}
            <div className="flex justify-between gap-3"><dt className="text-muted">{t("payment.transactionNo")}</dt><dd className="ltr-iso font-mono">{payment.transactionNo}</dd></div>
            <div className="flex justify-between gap-3 font-semibold"><dt>{t("payment.amount")}</dt><dd>{formatSar(payment.amountHalalas, locale)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">{t("payment.dueDate")}</dt><dd>{fmtWhen(payment.dueAt, locale)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-muted">{t("payment.transferNote")}</p>
          <p className="text-xs font-semibold text-warn">{t("payment.warnOnly")}</p>
        </div>
      ) : null}

      {payment.hasReceipt && payment.receiptUrl ? (
        <a href={payment.receiptUrl} target="_blank" rel="noreferrer" className="mb-3 inline-block text-sm text-aqua-700 underline">{t("payment.viewReceipt")}</a>
      ) : null}

      {canPay ? (
        <div className="space-y-3 border-t border-line pt-3">
          <h3 className="font-semibold">{t("payment.markPaidTitle")}</h3>
          {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pay-date" className="mb-1 block text-sm font-medium">{t("payment.paymentDate")}</label>
              <input id="pay-date" type="date" dir="ltr" className={`${inputCls} text-start`} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
            </div>
            <div>
              <label htmlFor="pay-ref" className="mb-1 block text-sm font-medium">{t("payment.bankReference")}</label>
              <input id="pay-ref" dir="ltr" className={`${inputCls} text-start`} maxLength={60} value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="pay-receipt" className="mb-1 block text-sm font-medium">{t("payment.receipt")}</label>
            <input id="pay-receipt" ref={fileRef} type="file" accept="image/*,application/pdf" className="block w-full text-sm" />
          </div>
          <button type="button" className={btnCls("primary")} disabled={busy || !bankReference.trim()} onClick={submit}>
            {busy ? t("common.loading") : t("payment.markPaidButton")}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
