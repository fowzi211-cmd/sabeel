"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, btnCls, inputCls } from "./ui";

const CATEGORIES = ["NOT_DELIVERED", "SHORT", "WRONG_BRAND", "DAMAGED", "LATE", "OTHER"] as const;

/** T12/T15: the buyer confirms the delivery, or reports a problem instead. */
export function BuyerConfirmDelivery({ orderId }: { orderId: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("NOT_DELIVERED");
  const [note, setNote] = useState("");

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

  return (
    <Card tint>
      <h2 className="mb-1 text-lg font-bold">{t("orders.confirmTitle")}</h2>
      <p className="mb-3 text-sm text-muted">{t("orders.confirmHint")}</p>
      {error ? <div className="mb-3"><Banner tone="bad" role="alert">{error}</Banner></div> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnCls("primary")} disabled={!!busy} onClick={() => run("confirm", () => api(`/orders/${orderId}/confirm-receipt`, { method: "POST", body: {} }))}>
          {busy === "confirm" ? t("common.loading") : t("orders.confirmButton")}
        </button>
        <button type="button" className={btnCls("secondary")} disabled={!!busy} onClick={() => setShowReport((v) => !v)} aria-expanded={showReport}>
          {t("dispute.reportButton")}
        </button>
      </div>

      {showReport ? (
        <div className="mt-4 space-y-3 rounded-[10px] border border-line p-3">
          <h3 className="font-semibold">{t("dispute.reportTitle")}</h3>
          <p className="text-sm text-muted">{t("dispute.reportHint")}</p>
          <div role="radiogroup" className="grid gap-1.5">
            {CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="radio" name="dispute-category" className="size-4 accent-aqua-600" checked={category === c} onChange={() => setCategory(c)} />
                {t(`dispute.category.${c}`)}
              </label>
            ))}
          </div>
          <div>
            <label htmlFor="dispute-note" className="mb-1 block text-sm font-medium">{t("dispute.reportNote")}</label>
            <textarea id="dispute-note" className={`${inputCls} min-h-20`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button
            type="button" className={btnCls("danger")} disabled={!!busy || note.trim().length < 2}
            onClick={() => run("report", () => api(`/orders/${orderId}/report-problem`, { body: { category, note: note.trim() } }))}
          >
            {busy === "report" ? t("common.loading") : t("dispute.reportSubmit")}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
