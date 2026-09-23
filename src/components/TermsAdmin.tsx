"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, Field, Table, btnCls, fmtDate, inputCls, td, th } from "./ui";

export interface TermsRow {
  id: string; type: string; version: string; titleAr: string; titleEn: string;
  effectiveFrom: string; sha256Ar: string; legalReviewedAt: string | null;
}

const TYPES = ["SUPPLIER_AGREEMENT", "INDEPENDENT_AGREEMENT", "BUYER_TERMS"] as const;

export function TermsAdmin({ rows, canPublish }: { rows: TermsRow[]; canPublish: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ type: "SUPPLIER_AGREEMENT" as (typeof TYPES)[number], version: "", titleAr: "", titleEn: "", bodyAr: "", bodyEn: "", noticeDays: 30, effectiveFrom: "" });

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));

  async function review(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/terms/${id}/legal-reviewed`, { method: "POST" });
      router.refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function prefill() {
    setError(null);
    try {
      const r = await api<{ current: { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string } }>(`/terms/${f.type}`);
      setF((s) => ({ ...s, titleAr: r.current.titleAr, titleEn: r.current.titleEn, bodyAr: r.current.bodyAr, bodyEn: r.current.bodyEn }));
    } catch (e) {
      fail(e);
    }
  }

  async function publish(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/terms", { body: { ...f, effectiveFrom: new Date(f.effectiveFrom).toISOString() } });
      setF((s) => ({ ...s, version: "", bodyAr: "", bodyEn: "" }));
      router.refresh();
    } catch (e2) {
      fail(e2);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
      <Table>
        <thead>
          <tr>
            <th className={th}>{t("admin.termsTitle")}</th>
            <th className={th}>{t("admin.version")}</th>
            <th className={th}>{t("admin.effectiveFrom")}</th>
            <th className={th}>{t("agreement.hash")}</th>
            <th className={th}>{t("admin.legalReviewed")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>{t(`admin.termsType.${r.type}`)}</td>
              <td className={td}>{r.version}</td>
              <td className={td}>{fmtDate(r.effectiveFrom, locale)}</td>
              <td className={td}><span className="ltr-iso font-mono text-xs">{r.sha256Ar.slice(0, 12)}…</span></td>
              <td className={td}>
                {r.legalReviewedAt ? (
                  <Chip tone="ok">✔ {fmtDate(r.legalReviewedAt, locale)}</Chip>
                ) : canPublish ? (
                  <button type="button" disabled={busy} onClick={() => review(r.id)} className={btnCls("secondary", "!min-h-9 !py-1.5 text-sm")}>{t("admin.markReviewed")}</button>
                ) : (
                  <Chip tone="warn">{t("admin.legalPending")}</Chip>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {canPublish ? (
        <Card>
          <h2 className="mb-3 text-lg font-bold">{t("admin.publishTitle")}</h2>
          <form onSubmit={publish} className="grid gap-3 sm:grid-cols-2">
            <Field label={t("admin.type")} htmlFor="t-type">
              <select id="t-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as (typeof TYPES)[number] })} className={inputCls}>
                {TYPES.map((x) => <option key={x} value={x}>{t(`admin.termsType.${x}`)}</option>)}
              </select>
            </Field>
            <div className="flex items-end"><button type="button" className={btnCls("ghost")} onClick={prefill}>{t("admin.prefill")}</button></div>
            <Field label={t("admin.version")} htmlFor="t-ver"><input id="t-ver" dir="ltr" placeholder="1.1" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} className={`${inputCls} text-start`} /></Field>
            <Field label={t("admin.noticeDays")} htmlFor="t-notice"><input id="t-notice" type="number" min={0} value={f.noticeDays} onChange={(e) => setF({ ...f, noticeDays: Number(e.target.value) })} className={inputCls} /></Field>
            <Field label={t("admin.effectiveFrom")} htmlFor="t-eff"><input id="t-eff" type="datetime-local" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} className={inputCls} /></Field>
            <div />
            <Field label={t("admin.titleAr")} htmlFor="t-tar"><input id="t-tar" value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} className={inputCls} /></Field>
            <Field label={t("admin.titleEn")} htmlFor="t-ten"><input id="t-ten" dir="ltr" value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value })} className={`${inputCls} text-start`} /></Field>
            <Field label={t("admin.bodyAr")} htmlFor="t-bar"><textarea id="t-bar" dir="rtl" rows={10} value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} className={inputCls} /></Field>
            <Field label={t("admin.bodyEn")} htmlFor="t-ben"><textarea id="t-ben" dir="ltr" rows={10} value={f.bodyEn} onChange={(e) => setF({ ...f, bodyEn: e.target.value })} className={`${inputCls} text-start`} /></Field>
            <div className="sm:col-span-2">
              <button type="submit" disabled={busy || !f.version || !f.effectiveFrom || f.bodyAr.length < 100 || f.bodyEn.length < 100} className={btnCls("primary")}>{busy ? t("common.loading") : t("admin.publish")}</button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
