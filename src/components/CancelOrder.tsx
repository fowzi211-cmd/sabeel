"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";
import { Banner, btnCls, inputCls } from "./ui";

export function CancelOrder({ orderId }: { orderId: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${orderId}/cancel`, { body: { reason: reason.trim() || undefined } });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
      setBusy(false);
    }
  }

  if (!open) {
    return <button type="button" className={btnCls("danger")} onClick={() => setOpen(true)}>{t("orders.cancel")}</button>;
  }
  return (
    <div className="space-y-3 rounded-xl border border-bad/30 bg-bad-bg/40 p-3">
      <label htmlFor="cancel-reason" className="block text-sm font-medium">{t("orders.cancelReason")}</label>
      <textarea id="cancel-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputCls} min-h-16`} />
      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
      <div className="flex gap-2">
        <button type="button" className={btnCls("danger")} disabled={busy} onClick={cancel}>{busy ? t("common.loading") : t("orders.cancelConfirm")}</button>
        <button type="button" className={btnCls("ghost")} onClick={() => setOpen(false)}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}
