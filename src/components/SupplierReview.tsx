"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";
import { Banner, Chip, btnCls, fmtDate, inputCls, statusTone } from "./ui";

export interface ReviewDoc {
  id: string; kind: string; originalName: string; status: string; number: string | null;
  expiresAt: string | null; rejectReason: string | null; sha256: string;
}
export interface ReviewBank {
  id: string; iban: string; holderName: string; bankName: string | null; status: string;
  reviewedAt: string | null; cooldownUntil: string | null; rejectReason: string | null;
}

interface Props {
  supplierId: string;
  status: string;
  docs: ReviewDoc[];
  banks: ReviewBank[];
  canDecide: boolean;
  approveBlockers: string[];
}

const groupIban = (i: string) => i.replace(/(.{4})/g, "$1 ").trim();

export function SupplierReview({ supplierId, status, docs, banks, canDecide, approveBlockers }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setRejecting(null);
      setReason("");
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const reviewDoc = (id: string, action: "verify" | "reject") =>
    run(() => api(`/admin/suppliers/${supplierId}/documents/${id}`, { body: { action, reason: action === "reject" ? reason : undefined } }));
  const reviewBank = (id: string, action: "verify" | "reject") =>
    run(() => api(`/admin/suppliers/${supplierId}/bank/${id}`, { body: { action, reason: action === "reject" ? reason : undefined } }));
  const decide = (action: string) => run(() => api(`/admin/suppliers/${supplierId}/decision`, { body: { action, note } }));

  const label = (b: string) =>
    b === "legal_review" ? t("admin.legalPending") : b.startsWith("doc:") ? t(`supplier.docKind.${b.slice(4)}`) : t(`supplier.missing.${b}`);

  const rejectBox = (onConfirm: () => void, id: string) =>
    rejecting === id ? (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("admin.docRejectPrompt")} className={`${inputCls} max-w-xs`} aria-label={t("admin.docRejectPrompt")} />
        <button type="button" className={btnCls("danger", "!min-h-9 !py-1.5 text-sm")} disabled={busy || !reason.trim()} onClick={onConfirm}>{t("admin.reject")}</button>
        <button type="button" className={btnCls("ghost", "!min-h-9 !py-1.5 text-sm")} onClick={() => setRejecting(null)}>{t("common.cancel")}</button>
      </div>
    ) : null;

  const allowed = {
    approve: status === "PENDING",
    needs_info: status === "PENDING",
    reject: status === "PENDING" || status === "NEEDS_INFO",
    suspend: status === "ACTIVE" || status === "PAUSED",
    reinstate: status === "SUSPENDED" || status === "PAUSED",
  };
  const noNote = note.trim().length === 0;

  return (
    <div className="space-y-6">
      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}

      <section>
        <h2 className="mb-2 text-lg font-bold">{t("admin.documents")}</h2>
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {docs.length === 0 ? <li className="p-3 text-muted">{t("common.none")}</li> : null}
          {docs.map((d) => (
            <li key={d.id} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{t(`supplier.docKind.${d.kind}`)}</span>
                <Chip tone={statusTone(d.status)}>{t(`supplier.docStatus.${d.status}`)}</Chip>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
                <a className="font-medium text-aqua-700 underline" href={`/api/v1/files/${d.id}`} target="_blank" rel="noopener noreferrer">{d.originalName}</a>
                {d.number ? <span className="ltr-iso">{d.number}</span> : null}
                {d.expiresAt ? <span>{t("supplier.docExpires")}: {fmtDate(d.expiresAt, locale)}</span> : null}
                <span className="ltr-iso font-mono text-xs" title="SHA-256">{d.sha256.slice(0, 12)}…</span>
              </div>
              {d.rejectReason ? <p className="mt-1 text-sm text-bad">{t("supplier.rejectedReason", { reason: d.rejectReason })}</p> : null}
              {canDecide && d.status === "UPLOADED" ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" className={btnCls("primary", "!min-h-9 !py-1.5 text-sm")} disabled={busy} onClick={() => reviewDoc(d.id, "verify")}>{t("admin.verify")}</button>
                  <button type="button" className={btnCls("danger", "!min-h-9 !py-1.5 text-sm")} disabled={busy} onClick={() => setRejecting(`d-${d.id}`)}>{t("admin.reject")}</button>
                </div>
              ) : null}
              {rejectBox(() => reviewDoc(d.id, "reject"), `d-${d.id}`)}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">{t("admin.bank")}</h2>
        <Banner tone="info">{t("admin.holderMatch")}</Banner>
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-white">
          {banks.length === 0 ? <li className="p-3 text-muted">{t("common.none")}</li> : null}
          {banks.map((b) => (
            <li key={b.id} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="ltr-iso font-mono font-semibold">{groupIban(b.iban)}</span>
                <Chip tone={statusTone(b.status)}>{t(`supplier.bankStatus.${b.status}`)}</Chip>
              </div>
              <p className="mt-1 text-sm">{b.holderName}{b.bankName ? ` · ${b.bankName}` : ""}</p>
              {b.status === "PENDING" && b.reviewedAt ? <p className="mt-1 text-xs text-ok">✔ {t("admin.verify")} — {b.cooldownUntil && new Date(b.cooldownUntil) > new Date() ? t("admin.activatesAfter", { time: fmtDate(b.cooldownUntil, locale, true) }) : ""}</p> : null}
              {b.rejectReason ? <p className="mt-1 text-sm text-bad">{t("supplier.rejectedReason", { reason: b.rejectReason })}</p> : null}
              {canDecide && b.status === "PENDING" && !b.reviewedAt ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" className={btnCls("primary", "!min-h-9 !py-1.5 text-sm")} disabled={busy} onClick={() => reviewBank(b.id, "verify")}>{t("admin.verify")}</button>
                  <button type="button" className={btnCls("danger", "!min-h-9 !py-1.5 text-sm")} disabled={busy} onClick={() => setRejecting(`b-${b.id}`)}>{t("admin.reject")}</button>
                </div>
              ) : null}
              {rejectBox(() => reviewBank(b.id, "reject"), `b-${b.id}`)}
            </li>
          ))}
        </ul>
      </section>

      {canDecide ? (
        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="mb-2 text-lg font-bold">{t("admin.decision")}</h2>
          {allowed.approve && approveBlockers.length ? (
            <Banner tone="warn">{t("admin.cannotApprove", { list: approveBlockers.map(label).join("، ") })}</Banner>
          ) : null}
          <label htmlFor="decision-note" className="mb-1 mt-3 block text-sm font-medium">{t("admin.decisionNote")}</label>
          <textarea id="decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} min-h-24`} />
          <div className="mt-3 flex flex-wrap gap-2">
            {allowed.approve ? <button type="button" className={btnCls("primary")} disabled={busy || approveBlockers.length > 0} onClick={() => decide("approve")}>{t("admin.approve")}</button> : null}
            {allowed.needs_info ? <button type="button" className={btnCls("secondary")} disabled={busy || noNote} onClick={() => decide("needs_info")}>{t("admin.needsInfo")}</button> : null}
            {allowed.reject ? <button type="button" className={btnCls("danger")} disabled={busy || noNote} onClick={() => decide("reject")}>{t("admin.reject")}</button> : null}
            {allowed.suspend ? <button type="button" className={btnCls("danger")} disabled={busy || noNote} onClick={() => decide("suspend")}>{t("admin.suspend")}</button> : null}
            {allowed.reinstate ? <button type="button" className={btnCls("secondary")} disabled={busy || noNote} onClick={() => decide("reinstate")}>{t("admin.reinstate")}</button> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
