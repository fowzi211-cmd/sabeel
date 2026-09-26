"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { fmtWhen } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, btnCls, inputCls } from "./ui";

/** The supplier's one answer to a buyer's delivery report, with an optional photo, until the 48 h window closes. */
export function SupplierDisputeResponse({ orderId, dueAt }: { orderId: string; dueAt: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("note", note.trim());
      if (file) form.set("file", file);
      await api(`/supplier/orders/${orderId}/dispute/respond`, { form });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-bold">{t("dispute.respond.title")}</h2>
      <p className="mb-2 text-sm text-muted">{t("dispute.respond.intro", { due: fmtWhen(dueAt, locale) })}</p>
      {error ? <div className="mb-2"><Banner tone="bad" role="alert">{error}</Banner></div> : null}
      <textarea className={`${inputCls} min-h-24`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("dispute.respond.placeholder")} />
      <label className="mt-2 block text-sm">
        <span className="text-muted">{t("dispute.respond.photo")}</span>
        <input type="file" accept="image/*" className="mt-1 block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <button type="button" className={`${btnCls("primary")} mt-3`} disabled={busy || note.trim().length < 5} onClick={send}>
        {busy ? t("common.loading") : t("dispute.respond.submit")}
      </button>
    </Card>
  );
}
