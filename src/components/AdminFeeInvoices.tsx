"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { formatSar } from "@/lib/money";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, Table, btnCls, fmtDate, inputCls, td, th } from "./ui";

export interface AdminInvoiceRow {
  id: string;
  invoiceNo: string;
  periodStart: string;
  periodEnd: string;
  totalHalalas: number;
  status: "ISSUED" | "PAYMENT_SUBMITTED" | "PAID" | "OVERDUE";
  dueAt: string;
  supplier: { tradeName: string | null; legalNameAr: string };
}

const tone = (status: AdminInvoiceRow["status"]) => (status === "PAID" ? "ok" : status === "OVERDUE" ? "bad" : status === "PAYMENT_SUBMITTED" ? "info" : "neutral");

export function AdminFeeInvoices({ invoices }: { invoices: AdminInvoiceRow[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      setRejecting(null);
      setReason("");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(null);
    }
  }

  if (invoices.length === 0) return <Card><p className="text-muted">{t("adminFeeInvoices.empty")}</p></Card>;

  return (
    <div className="space-y-3">
      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
      <Table>
        <thead>
          <tr>
            <th className={th}>{t("adminFeeInvoices.col.invoice")}</th>
            <th className={th}>{t("adminFeeInvoices.col.supplier")}</th>
            <th className={th}>{t("adminFeeInvoices.col.period")}</th>
            <th className={th}>{t("adminFeeInvoices.col.total")}</th>
            <th className={th}>{t("adminFeeInvoices.col.due")}</th>
            <th className={th}>{t("adminFeeInvoices.col.status")}</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td className={td}><span className="ltr-iso font-mono">{inv.invoiceNo}</span></td>
              <td className={td}>{inv.supplier.tradeName || inv.supplier.legalNameAr}</td>
              <td className={td}>{fmtDate(inv.periodStart, locale)} – {fmtDate(inv.periodEnd, locale)}</td>
              <td className={td}>{formatSar(inv.totalHalalas, locale)}</td>
              <td className={td}>{fmtDate(inv.dueAt, locale)}</td>
              <td className={td}><Chip tone={tone(inv.status)}>{t(`feeInvoice.status.${inv.status}`)}</Chip></td>
              <td className={td}>
                {inv.status === "PAYMENT_SUBMITTED" ? (
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" disabled={busy === inv.id} className={btnCls("primary", "!min-h-9 !py-1.5 text-sm")} onClick={() => run(inv.id, () => api(`/admin/fee-invoices/${inv.id}/confirm-payment`, { method: "POST", body: {} }))}>
                      {t("feeInvoice.confirmPayment")}
                    </button>
                    <button type="button" disabled={busy === inv.id} className={btnCls("secondary", "!min-h-9 !py-1.5 text-sm")} onClick={() => setRejecting(rejecting === inv.id ? null : inv.id)}>
                      {t("feeInvoice.rejectPayment")}
                    </button>
                  </div>
                ) : null}
                {rejecting === inv.id ? (
                  <div className="mt-2 space-y-1.5">
                    <textarea className={`${inputCls} min-h-14 text-sm`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("feeInvoice.rejectReasonPrompt")} />
                    <button type="button" disabled={busy === inv.id || reason.trim().length < 2} className={btnCls("danger", "!min-h-9 !py-1.5 text-sm")} onClick={() => run(inv.id, () => api(`/admin/fee-invoices/${inv.id}/reject-payment`, { body: { note: reason.trim() } }))}>
                      {t("feeInvoice.rejectPayment")}
                    </button>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
