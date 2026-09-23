"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { hasArabic } from "@/lib/validate";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, Field, Table, btnCls, inputCls, statusTone, td, th } from "./ui";

export interface BrandRow { id: string; nameAr: string; nameEn: string; sfdaRef: string; status: "ACTIVE" | "SUSPENDED"; notes: string | null }

export function BrandsManager({ brands, canEdit }: { brands: BrandRow[]; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [f, setF] = useState({ nameAr: "", nameEn: "", sfdaRef: "", notes: "" });
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!hasArabic(f.nameAr)) return setErr({ field: "nameAr", msg: t("errors.arabicName") });
    setBusy(true);
    try {
      await api("/admin/brands", { body: { nameAr: f.nameAr, nameEn: f.nameEn, sfdaRef: f.sfdaRef, notes: f.notes || undefined } });
      setF({ nameAr: "", nameEn: "", sfdaRef: "", notes: "" });
      router.refresh();
    } catch (error) {
      setErr({ field: error instanceof ApiError ? error.field : undefined, msg: error instanceof ApiError ? error.messageFor(locale) : t("common.error") });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(b: BrandRow) {
    setBusy(true);
    try {
      await api(`/admin/brands/${b.id}`, { method: "PATCH", body: { status: b.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" } });
      router.refresh();
    } catch (error) {
      setErr({ msg: error instanceof ApiError ? error.messageFor(locale) : t("common.error") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {err && !err.field ? <Banner tone="bad" role="alert">{err.msg}</Banner> : null}
      <Table>
        <thead>
          <tr>
            <th className={th}>{t("admin.nameAr")}</th>
            <th className={th}>{t("admin.nameEn")}</th>
            <th className={th}>{t("admin.sfdaRef")}</th>
            <th className={th}>{t("common.status")}</th>
            {canEdit ? <th className={th}></th> : null}
          </tr>
        </thead>
        <tbody>
          {brands.length === 0 ? <tr><td className={td} colSpan={5}>{t("common.none")}</td></tr> : null}
          {brands.map((b) => (
            <tr key={b.id}>
              <td className={td}>{b.nameAr}</td>
              <td className={td}><span dir="ltr">{b.nameEn}</span>{b.notes ? <div className="text-xs text-muted">{b.notes}</div> : null}</td>
              <td className={td}><span className="ltr-iso font-mono">{b.sfdaRef}</span></td>
              <td className={td}><Chip tone={statusTone(b.status)}>{t(`admin.brandStatus.${b.status}`)}</Chip></td>
              {canEdit ? (
                <td className={td}>
                  <button type="button" disabled={busy} onClick={() => toggle(b)} className={btnCls(b.status === "ACTIVE" ? "danger" : "secondary", "!min-h-9 !py-1.5 text-sm")}>
                    {b.status === "ACTIVE" ? t("admin.suspendBrand") : t("admin.reactivateBrand")}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </Table>

      {canEdit ? (
        <Card>
          <h2 className="mb-3 text-lg font-bold">{t("admin.addBrand")}</h2>
          <form onSubmit={add} noValidate className="grid gap-3 sm:grid-cols-3">
            <Field label={t("admin.nameAr")} htmlFor="b-ar" error={err?.field === "nameAr" ? err.msg : null}>
              <input id="b-ar" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} className={inputCls} />
            </Field>
            <Field label={t("admin.nameEn")} htmlFor="b-en" error={err?.field === "nameEn" ? err.msg : null}>
              <input id="b-en" dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} className={`${inputCls} text-start`} />
            </Field>
            <Field label={t("admin.sfdaRef")} htmlFor="b-sfda" error={err?.field === "sfdaRef" ? err.msg : null}>
              <input id="b-sfda" dir="ltr" value={f.sfdaRef} onChange={(e) => setF({ ...f, sfdaRef: e.target.value })} className={`${inputCls} text-start font-mono`} />
            </Field>
            <div className="sm:col-span-3">
              <button type="submit" disabled={busy || !f.nameAr.trim() || !f.nameEn.trim() || !f.sfdaRef.trim()} className={btnCls("primary")}>{t("admin.addBrand")}</button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
