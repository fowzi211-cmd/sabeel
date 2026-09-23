"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { formatSar } from "@/lib/money";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, Field, Table, btnCls, fmtDate, inputCls, td, th } from "./ui";

export interface FeeRuleRow { id: string; scope: string; scopeRef: string | null; model: string; amountHalalas: number; effectiveFrom: string; reason: string }
export interface ExposureRow { id: string; tradeName: string | null; legalNameAr: string; status: string; pauseReason: string | null; creditCeilingHalalas: number; invoiceCycle: string; exposureHalalas: number; band: "ok" | "warn70" | "warn90" | "over" }

const SCOPES = ["GLOBAL", "SUPPLIER_TYPE", "SUPPLIER", "PACK_SIZE", "PROMO"] as const;
const MODELS = ["FIXED_PER_PACKET", "FIXED_PER_BOTTLE", "PERCENTAGE", "FLAT_PER_ORDER"] as const;
const bandTone = (b: ExposureRow["band"]) => (b === "over" ? "bad" : b === "warn90" ? "warn" : b === "warn70" ? "warn" : "ok");

export function FeesAdmin({ rules, exposure, canPublish }: { rules: FeeRuleRow[]; exposure: ExposureRow[]; canPublish: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ scope: "GLOBAL" as (typeof SCOPES)[number], scopeRef: "", model: "FIXED_PER_PACKET" as (typeof MODELS)[number], amountHalalas: 50, effectiveFrom: "", reason: "" });

  async function publish(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/fees", { body: { ...f, scopeRef: f.scopeRef.trim() || undefined, effectiveFrom: new Date(f.effectiveFrom).toISOString() } });
      setF((s) => ({ ...s, reason: "", scopeRef: "" }));
      router.refresh();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Table>
        <thead>
          <tr>
            <th className={th}>{t("admin.scope")}</th>
            <th className={th}>{t("admin.model")}</th>
            <th className={th}>{t("admin.amount")}</th>
            <th className={th}>{t("admin.effectiveFrom")}</th>
            <th className={th}>{t("common.reason")}</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td className={td}>{r.scope}{r.scopeRef ? ` · ${r.scopeRef}` : ""}</td>
              <td className={td}>{r.model === "FIXED_PER_PACKET" ? t("admin.perPacket") : r.model}</td>
              <td className={td}><span className="ltr-iso font-mono">{r.amountHalalas} ({(r.amountHalalas / 100).toFixed(2)} {t("common.sar")})</span></td>
              <td className={td}>{fmtDate(r.effectiveFrom, locale)}</td>
              <td className={td}>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      {canPublish ? (
        <Card>
          <h2 className="mb-3 text-lg font-bold">{t("admin.publishFeeRule")}</h2>
          {error ? <div className="mb-3"><Banner tone="bad" role="alert">{error}</Banner></div> : null}
          <form onSubmit={publish} className="grid gap-3 sm:grid-cols-2">
            <Field label={t("admin.scope")} htmlFor="f-scope">
              <select id="f-scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as (typeof SCOPES)[number] })} className={inputCls}>
                {SCOPES.map((s) => <option key={s} value={s}>{t(`admin.feeRuleScope.${s}`)}</option>)}
              </select>
            </Field>
            <Field label={t("admin.scopeRef")} htmlFor="f-scoperef"><input id="f-scoperef" dir="ltr" value={f.scopeRef} onChange={(e) => setF({ ...f, scopeRef: e.target.value })} className={`${inputCls} text-start`} /></Field>
            <Field label={t("admin.model")} htmlFor="f-model">
              <select id="f-model" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value as (typeof MODELS)[number] })} className={inputCls}>
                {MODELS.map((m) => <option key={m} value={m}>{t(`admin.feeRuleModel.${m}`)}</option>)}
              </select>
            </Field>
            <Field label={t("admin.amount")} htmlFor="f-amount"><input id="f-amount" type="number" min={0} value={f.amountHalalas} onChange={(e) => setF({ ...f, amountHalalas: Number(e.target.value) })} className={inputCls} /></Field>
            <Field label={t("admin.effectiveFrom")} htmlFor="f-eff" hint={t("admin.feeRuleNoticeHint")}>
              <input id="f-eff" type="datetime-local" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} className={inputCls} />
            </Field>
            <Field label={t("admin.feeRuleReason")} htmlFor="f-reason"><input id="f-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={inputCls} /></Field>
            <div className="sm:col-span-2">
              <button type="submit" disabled={busy || !f.effectiveFrom || f.reason.trim().length < 2} className={btnCls("primary")}>{busy ? t("common.loading") : t("admin.publish")}</button>
            </div>
          </form>
        </Card>
      ) : null}

      <h2 className="text-lg font-bold">{t("admin.exposureTitle")}</h2>
      <p className="text-sm text-muted">{t("admin.exposureIntro")}</p>
      {exposure.length === 0 ? <Card><p className="text-muted">{t("admin.exposureEmpty")}</p></Card> : (
        <Table>
          <thead>
            <tr>
              <th className={th}>{t("admin.supplierCol")}</th>
              <th className={th}>{t("admin.exposureHalalas")}</th>
              <th className={th}>{t("admin.ceiling")}</th>
              <th className={th}>{t("admin.cycle")}</th>
              <th className={th}>{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {exposure.map((s) => (
              <tr key={s.id}>
                <td className={td}>{s.tradeName || s.legalNameAr}</td>
                <td className={td}>{formatSar(s.exposureHalalas, locale)}</td>
                <td className={td}>{formatSar(s.creditCeilingHalalas, locale)}</td>
                <td className={td}>{t(`admin.invoiceCycle.${s.invoiceCycle}`)}</td>
                <td className={td}>
                  <Chip tone={bandTone(s.band)}>{t(`admin.band.${s.band}`)}</Chip>
                  {s.status === "PAUSED" ? <> <Chip tone="bad">{t("admin.pausedFlag")}</Chip></> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
