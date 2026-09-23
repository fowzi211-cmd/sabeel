"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { sarToHalalas } from "@/lib/money";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, btnCls, inputCls } from "./ui";

export interface ZoneDistrict {
  id: string; nameAr: string; nameEn: string; restricted: boolean; restrictedReason: string | null; restrictedReasonEn: string | null;
  zone: { deliveryFeeHalalas: number; leadTimeHours: number; active: boolean } | null;
}

function Row({ d, canEdit }: { d: ZoneDistrict; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [active, setActive] = useState(d.zone?.active ?? false);
  const [fee, setFee] = useState(((d.zone?.deliveryFeeHalalas ?? 2000) / 100).toFixed(2));
  const [lead, setLead] = useState(String(d.zone?.leadTimeHours ?? 24));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const feeH = sarToHalalas(fee);
  const leadN = Number(lead);
  const valid = feeH !== null && Number.isInteger(leadN) && leadN >= 0;

  async function save() {
    if (!valid) return setMsg({ tone: "bad", text: t("errors.required") });
    setBusy(true);
    setMsg(null);
    try {
      await fetchSave();
      setMsg({ tone: "ok", text: t("zones.saved") });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof ApiError ? e.messageFor(locale) : t("common.error") });
    } finally {
      setBusy(false);
    }
  }
  const fetchSave = () => api("/supplier/coverage", { method: "PUT", body: { districtId: d.id, deliveryFeeHalalas: feeH, leadTimeHours: leadN, active } });

  return (
    <Card className={d.restricted ? "opacity-70" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold">{locale === "ar" ? d.nameAr : d.nameEn}</div>
        {d.restricted ? <Chip tone="bad" wrap>{t("zones.restricted", { reason: (locale === "ar" ? d.restrictedReason : d.restrictedReasonEn ?? d.restrictedReason) ?? "" })}</Chip> : d.zone?.active ? <Chip tone="ok">✔</Chip> : null}
      </div>
      {!d.restricted ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-aqua-600" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={!canEdit} />{t("zones.serve")}</label>
          <div><label className="mb-1 block text-xs font-medium" htmlFor={`f-${d.id}`}>{t("zones.fee")}</label><input id={`f-${d.id}`} dir="ltr" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} disabled={!canEdit} className={`${inputCls} text-start`} /></div>
          <div><label className="mb-1 block text-xs font-medium" htmlFor={`l-${d.id}`}>{t("zones.lead")}</label><input id={`l-${d.id}`} dir="ltr" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, ""))} disabled={!canEdit} className={`${inputCls} text-start`} /></div>
          {canEdit ? <button type="button" className={btnCls("primary")} disabled={busy} onClick={save}>{busy ? t("common.loading") : t("zones.save")}</button> : null}
        </div>
      ) : null}
      {msg ? <div className="mt-2"><Banner tone={msg.tone} role="status">{msg.text}</Banner></div> : null}
    </Card>
  );
}

export function ZonesManager({ districts, canEdit }: { districts: ZoneDistrict[]; canEdit: boolean }) {
  const { t } = useI18n();
  if (districts.length === 0) return <p className="text-muted">{t("zones.none")}</p>;
  return <div className="space-y-3">{districts.map((d) => <Row key={d.id} d={d} canEdit={canEdit} />)}</div>;
}
