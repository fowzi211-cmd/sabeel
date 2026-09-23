"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, Field, btnCls, inputCls } from "./ui";

export interface DistrictRow {
  id: string; slug: string; nameAr: string; nameEn: string; restricted: boolean; restrictedReason: string | null; restrictedReasonEn: string | null;
  gpsRadiusM: number; deliveryStart: string; deliveryEnd: string; fridayBlackoutStart: string | null; fridayBlackoutEnd: string | null; active: boolean;
}

function Row({ d, canEdit }: { d: DistrictRow; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [s, setS] = useState({ ...d, restrictedReason: d.restrictedReason ?? "", restrictedReasonEn: d.restrictedReasonEn ?? "", fridayBlackoutStart: d.fridayBlackoutStart ?? "", fridayBlackoutEnd: d.fridayBlackoutEnd ?? "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/admin/districts/${d.id}`, {
        method: "PATCH",
        body: {
          restricted: s.restricted, restrictedReason: s.restricted ? s.restrictedReason : null, restrictedReasonEn: s.restricted ? s.restrictedReasonEn || null : null, gpsRadiusM: Number(s.gpsRadiusM),
          deliveryStart: s.deliveryStart, deliveryEnd: s.deliveryEnd,
          fridayBlackoutStart: s.fridayBlackoutStart || null, fridayBlackoutEnd: s.fridayBlackoutEnd || null, active: s.active,
        },
      });
      setMsg({ tone: "ok", text: t("common.saved") });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof ApiError ? e.messageFor(locale) : t("common.error") });
    } finally {
      setBusy(false);
    }
  }

  const time = (id: string, label: string, key: "deliveryStart" | "deliveryEnd" | "fridayBlackoutStart" | "fridayBlackoutEnd") => (
    <div>
      <label className="mb-1 block text-xs font-medium" htmlFor={id}>{label}</label>
      <input id={id} type="time" dir="ltr" value={s[key]} onChange={(e) => setS({ ...s, [key]: e.target.value })} disabled={!canEdit} className={`${inputCls} text-start`} />
    </div>
  );

  return (
    <Card className={s.restricted ? "!border-bad/40" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-bold">{d.nameAr}</span> <span className="text-muted" dir="ltr">· {d.nameEn}</span> <span className="ltr-iso text-xs text-muted">({d.slug})</span>
        </div>
        <div className="flex gap-1.5">
          {s.restricted ? <Chip tone="bad">{t("admin.restrictedFlag")}</Chip> : <Chip tone="ok">✔</Chip>}
          {!s.active ? <Chip>—</Chip> : null}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        {time(`hs-${d.id}`, t("admin.hoursFrom"), "deliveryStart")}
        {time(`he-${d.id}`, t("admin.hoursTo"), "deliveryEnd")}
        {time(`fs-${d.id}`, t("admin.fridayFrom"), "fridayBlackoutStart")}
        {time(`fe-${d.id}`, t("admin.fridayTo"), "fridayBlackoutEnd")}
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor={`gr-${d.id}`}>{t("admin.gpsRadius")}</label>
          <input id={`gr-${d.id}`} type="number" min={20} max={2000} dir="ltr" value={s.gpsRadiusM} onChange={(e) => setS({ ...s, gpsRadiusM: Number(e.target.value) })} disabled={!canEdit} className={`${inputCls} text-start`} />
        </div>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" className="size-4 accent-bad" checked={s.restricted} onChange={(e) => setS({ ...s, restricted: e.target.checked })} disabled={!canEdit} />{t("admin.restrictedFlag")}</label>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" className="size-4 accent-aqua-600" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} disabled={!canEdit} />{t("admin.activeFlag")}</label>
        {s.restricted ? (
          <>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium" htmlFor={`rr-${d.id}`}>{t("admin.restrictedReason")} (العربية)</label>
              <input id={`rr-${d.id}`} dir="rtl" value={s.restrictedReason} onChange={(e) => setS({ ...s, restrictedReason: e.target.value })} disabled={!canEdit} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium" htmlFor={`re-${d.id}`}>{t("admin.restrictedReason")} (English)</label>
              <input id={`re-${d.id}`} dir="ltr" value={s.restrictedReasonEn} onChange={(e) => setS({ ...s, restrictedReasonEn: e.target.value })} disabled={!canEdit} className={`${inputCls} text-start`} />
            </div>
          </>
        ) : null}
      </div>
      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={btnCls("primary")} disabled={busy} onClick={save}>{busy ? t("common.loading") : t("common.save")}</button>
          {msg ? <Banner tone={msg.tone} role="status">{msg.text}</Banner> : null}
        </div>
      ) : null}
    </Card>
  );
}

export function DistrictsAdmin({ districts, canEdit }: { districts: DistrictRow[]; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [f, setF] = useState({ slug: "", nameAr: "", nameEn: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/admin/districts", { body: { ...f, sortOrder: 500 } });
      setF({ slug: "", nameAr: "", nameEn: "" });
      router.refresh();
    } catch (error) {
      setErr(error instanceof ApiError ? error.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {districts.map((d) => <Row key={d.id + JSON.stringify(d)} d={d} canEdit={canEdit} />)}
      {canEdit ? (
        <Card>
          <h2 className="mb-3 text-lg font-bold">{t("admin.addDistrict")}</h2>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
            <Field label={t("admin.slug")} htmlFor="d-slug"><input id="d-slug" dir="ltr" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} className={`${inputCls} text-start font-mono`} placeholder="al-example" /></Field>
            <Field label={t("admin.nameAr")} htmlFor="d-ar"><input id="d-ar" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} className={inputCls} /></Field>
            <Field label={t("admin.nameEn")} htmlFor="d-en"><input id="d-en" dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} className={`${inputCls} text-start`} /></Field>
            {err ? <div className="sm:col-span-3"><Banner tone="bad" role="alert">{err}</Banner></div> : null}
            <div className="sm:col-span-3"><button type="submit" className={btnCls("primary")} disabled={busy || !f.slug || !f.nameAr || !f.nameEn}>{t("admin.addDistrict")}</button></div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
