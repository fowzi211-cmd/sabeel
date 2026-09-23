"use client";

import { Fragment, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { fmtWhen } from "@/lib/format";
import { formatSar } from "@/lib/money";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, Table, btnCls, fmtDate, inputCls, td, th } from "./ui";

export interface FeeInvoiceRow {
  id: string;
  invoiceNo: string;
  periodStart: string | Date;
  periodEnd: string | Date;
  totalHalalas: number;
  status: "ISSUED" | "PAYMENT_SUBMITTED" | "PAID" | "OVERDUE";
  dueAt: string | Date;
  paymentDate: string | Date | null;
  bankReference: string | null;
  receiptFileKey: string | null;
}

const tone = (status: FeeInvoiceRow["status"]) => (status === "PAID" ? "ok" : status === "OVERDUE" ? "bad" : status === "PAYMENT_SUBMITTED" ? "info" : "neutral");

export function SupplierFeeInvoices({ invoices }: { invoices: FeeInvoiceRow[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankReference, setBankReference] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(id: string) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("paymentDate", new Date(paymentDate).toISOString());
      form.set("bankReference", bankReference.trim());
      const file = fileRef.current?.files?.[0];
      if (file) form.set("file", file);
      await api(`/supplier/fee-invoices/${id}/submit-payment`, { form });
      setOpen(null);
      setBankReference("");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  if (invoices.length === 0) return <Card><p className="text-muted">{t("supplierFees.empty")}</p></Card>;

  return (
    <div className="space-y-3">
      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
      <Table>
        <thead>
          <tr>
            <th className={th}>{t("feeInvoice.invoiceNo")}</th>
            <th className={th}>{t("feeInvoice.period")}</th>
            <th className={th}>{t("feeInvoice.total")}</th>
            <th className={th}>{t("feeInvoice.dueDate")}</th>
            <th className={th}>{t("common.status")}</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <Fragment key={inv.id}>
              <tr>
                <td className={td}><span className="ltr-iso font-mono">{inv.invoiceNo}</span></td>
                <td className={td}>{fmtDate(inv.periodStart, locale)} – {fmtDate(inv.periodEnd, locale)}</td>
                <td className={td}>{formatSar(inv.totalHalalas, locale)}</td>
                <td className={td}>{fmtDate(inv.dueAt, locale)}</td>
                <td className={td}><Chip tone={tone(inv.status)}>{t(`feeInvoice.status.${inv.status}`)}</Chip></td>
                <td className={td}>
                  {inv.status === "ISSUED" || inv.status === "OVERDUE" ? (
                    <button type="button" className={btnCls("secondary", "!min-h-9 !py-1.5 text-sm")} onClick={() => setOpen(open === inv.id ? null : inv.id)}>
                      {t("feeInvoice.markPaidButton")}
                    </button>
                  ) : null}
                </td>
              </tr>
              {open === inv.id ? (
                <tr>
                  <td className={td} colSpan={6}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`fi-date-${inv.id}`} className="mb-1 block text-sm font-medium">{t("feeInvoice.paymentDate")}</label>
                        <input id={`fi-date-${inv.id}`} type="date" dir="ltr" className={`${inputCls} text-start`} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
                      </div>
                      <div>
                        <label htmlFor={`fi-ref-${inv.id}`} className="mb-1 block text-sm font-medium">{t("feeInvoice.bankReference")}</label>
                        <input id={`fi-ref-${inv.id}`} dir="ltr" className={`${inputCls} text-start`} maxLength={60} value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor={`fi-receipt-${inv.id}`} className="mb-1 block text-sm font-medium">{t("feeInvoice.receipt")}</label>
                        <input id={`fi-receipt-${inv.id}`} ref={fileRef} type="file" accept="image/*,application/pdf" className="block w-full text-sm" />
                      </div>
                      <div className="sm:col-span-2">
                        <button type="button" className={btnCls("primary")} disabled={busy || !bankReference.trim()} onClick={() => submit(inv.id)}>
                          {busy ? t("common.loading") : t("feeInvoice.markPaidButton")}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null}
              {inv.status === "PAYMENT_SUBMITTED" ? (
                <tr>
                  <td className={td} colSpan={6}>
                    <Banner tone="info">{t("feeInvoice.submittedBanner", { date: inv.paymentDate ? fmtWhen(inv.paymentDate, locale) : "" })}</Banner>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
