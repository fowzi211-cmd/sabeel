"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";
import { Banner, Chip, btnCls, inputCls, statusTone, fmtDate } from "./ui";

export interface DocSlotView {
  kind: string;
  required: boolean;
  state: "MISSING" | "UPLOADED" | "VERIFIED" | "REJECTED" | "EXPIRED";
  latest: { id: string; originalName: string; expiresAt: string | null; rejectReason: string | null; number: string | null } | null;
}

export function DocumentsPanel({ slots, canEdit }: { slots: DocSlotView[]; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [openKind, setOpenKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function upload(e: FormEvent<HTMLFormElement>, kind: string) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError(t("errors.fileNeeded"));
      return;
    }
    form.set("kind", kind);
    setBusy(true);
    try {
      await api("/supplier/documents", { form });
      setOpenKind(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/supplier/documents/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("supplier.docHelp")}</p>
      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {slots.map((s) => (
          <li key={s.kind} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold">{t(`supplier.docKind.${s.kind}`)}</span>{" "}
                <span className="text-xs text-muted">({s.required ? t("supplier.requiredDoc") : t("supplier.optionalDoc")})</span>
              </div>
              <Chip tone={s.state === "EXPIRED" ? "bad" : s.state === "MISSING" ? "neutral" : statusTone(s.state)}>{t(`supplier.docStatus.${s.state}`)}</Chip>
            </div>

            {s.latest ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <a className="font-medium text-aqua-700 underline" href={`/api/v1/files/${s.latest.id}`} target="_blank" rel="noopener noreferrer">
                  {s.latest.originalName}
                </a>
                {s.latest.number ? <span className="ltr-iso">{s.latest.number}</span> : null}
                {s.latest.expiresAt ? <span>{t("supplier.docExpires")}: {fmtDate(s.latest.expiresAt, locale)}</span> : null}
                {canEdit && s.state !== "VERIFIED" ? (
                  <button type="button" disabled={busy} onClick={() => remove(s.latest!.id)} className="text-bad underline">
                    {t("common.delete")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {s.latest?.rejectReason ? <p className="mt-1 text-sm text-bad">{t("supplier.rejectedReason", { reason: s.latest.rejectReason })}</p> : null}

            {canEdit ? (
              openKind === s.kind ? (
                <form ref={formRef} onSubmit={(e) => upload(e, s.kind)} className="mt-3 grid gap-3 rounded-lg bg-page p-3 sm:grid-cols-2">
                  <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sm:col-span-2 text-sm" />
                  <div>
                    <label className="mb-1 block text-xs font-medium" htmlFor={`n-${s.kind}`}>{t("supplier.docNumber")}</label>
                    <input id={`n-${s.kind}`} name="number" dir="ltr" className={`${inputCls} text-start`} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium" htmlFor={`i-${s.kind}`}>{t("supplier.docIssued")}</label>
                      <input id={`i-${s.kind}`} name="issuedAt" type="date" className={inputCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium" htmlFor={`e-${s.kind}`}>{t("supplier.docExpires")}</label>
                      <input id={`e-${s.kind}`} name="expiresAt" type="date" className={inputCls} />
                    </div>
                  </div>
                  <div className="flex gap-2 sm:col-span-2">
                    <button type="submit" disabled={busy} className={btnCls("primary")}>{busy ? t("common.loading") : t("supplier.upload")}</button>
                    <button type="button" className={btnCls("ghost")} onClick={() => setOpenKind(null)}>{t("common.cancel")}</button>
                  </div>
                </form>
              ) : (
                <button type="button" className={`${btnCls("secondary")} mt-2 !min-h-9 !py-1.5 text-sm`} onClick={() => { setOpenKind(s.kind); setError(null); }}>
                  {s.latest ? t("supplier.replace") : t("supplier.upload")}
                </button>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
