"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, Field, btnCls, inputCls } from "./ui";

export interface DriverRow {
  id: string; active: boolean; name: string | null; mobile: string; vehiclePlate: string | null; licenceNo: string | null;
  ackAccepted: boolean; openDeliveries: number; isYou: boolean;
}

/** The supplier's drivers (design pack S27): add by mobile, list, switch on/off, or add oneself. */
export function DriversManager({ drivers, canEdit, hasSelf, appUrl }: { drivers: DriverRow[]; canEdit: boolean; hasSelf: boolean; appUrl: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [f, setF] = useState({ name: "", mobile: "", vehiclePlate: "", licenceNo: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function run(label: string, fn: () => Promise<unknown>, okText?: string) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      if (okText) setMsg({ tone: "ok", text: okText });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof ApiError ? e.messageFor(locale) : t("common.error") });
    } finally {
      setBusy(null);
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run("add", async () => {
      await api("/supplier/drivers", { body: { name: f.name, mobile: f.mobile, vehiclePlate: f.vehiclePlate || undefined, licenceNo: f.licenceNo || undefined } });
      setF({ name: "", mobile: "", vehiclePlate: "", licenceNo: "" });
    }, t("drivers.added"));
  };

  return (
    <div className="space-y-4">
      <p className="text-muted">{t("drivers.intro")}</p>
      <Banner tone="info">{t("drivers.signInLink", { url: `${appUrl}/driver` })}</Banner>
      {!canEdit ? <Banner tone="warn">{t("drivers.needsActive")}</Banner> : null}
      {msg ? <Banner tone={msg.tone} role={msg.tone === "bad" ? "alert" : "status"}>{msg.text}</Banner> : null}

      {drivers.length === 0 ? <Card><p className="text-muted">{t("drivers.none")}</p></Card> : null}
      <ul className="space-y-3">
        {drivers.map((d) => (
          <li key={d.id}>
            <Card className={d.active ? "" : "opacity-70"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-bold">{d.name}</span> {d.isYou ? <span className="text-xs text-muted">{t("drivers.you")}</span> : null}
                  <div className="text-sm text-muted"><span className="ltr-iso">{d.mobile}</span>{d.vehiclePlate ? <> · <span className="ltr-iso">{d.vehiclePlate}</span></> : null}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip tone={d.active ? "ok" : "neutral"}>{d.active ? t("drivers.active") : t("drivers.inactive")}</Chip>
                  <Chip tone={d.ackAccepted ? "ok" : "warn"}>{d.ackAccepted ? t("drivers.ackDone") : t("drivers.ackPending")}</Chip>
                  {d.openDeliveries > 0 ? <Chip tone="info">{t("drivers.openDeliveries", { n: d.openDeliveries })}</Chip> : null}
                </div>
              </div>
              {canEdit ? (
                <div className="mt-3">
                  <button type="button" className={btnCls(d.active ? "secondary" : "primary", "!min-h-9 !py-1.5 text-sm")} disabled={!!busy}
                    onClick={() => run(d.id, () => api(`/supplier/drivers/${d.id}`, { method: "PATCH", body: { active: !d.active } }))}>
                    {d.active ? t("drivers.deactivate") : t("drivers.activate")}
                  </button>
                </div>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>

      {canEdit ? (
        <Card>
          <h2 className="mb-3 text-lg font-bold">{t("drivers.add")}</h2>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
            <Field label={t("drivers.name")} htmlFor="dr-name"><input id="dr-name" className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} required /></Field>
            <Field label={t("drivers.mobile")} htmlFor="dr-mobile"><input id="dr-mobile" dir="ltr" inputMode="tel" className={`${inputCls} text-start`} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder="05xxxxxxxx" required /></Field>
            <Field label={t("drivers.plate")} htmlFor="dr-plate"><input id="dr-plate" dir="ltr" className={`${inputCls} text-start`} value={f.vehiclePlate} onChange={(e) => setF({ ...f, vehiclePlate: e.target.value })} maxLength={20} /></Field>
            <Field label={t("drivers.licence")} htmlFor="dr-lic"><input id="dr-lic" dir="ltr" className={`${inputCls} text-start`} value={f.licenceNo} onChange={(e) => setF({ ...f, licenceNo: e.target.value })} maxLength={30} /></Field>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" className={btnCls("primary")} disabled={!!busy || !f.name.trim() || !f.mobile.trim()}>{busy === "add" ? t("common.loading") : t("drivers.add")}</button>
              {!hasSelf ? (
                <button type="button" className={btnCls("secondary")} disabled={!!busy} onClick={() => run("self", () => api("/supplier/drivers", { body: { self: true, vehiclePlate: f.vehiclePlate || undefined, licenceNo: f.licenceNo || undefined } }), t("drivers.added"))}>
                  {t("drivers.addSelf")}
                </button>
              ) : null}
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
