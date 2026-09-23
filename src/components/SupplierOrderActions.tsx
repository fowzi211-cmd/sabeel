"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { fmtWhen } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, btnCls, inputCls } from "./ui";

const DECLINE = ["OUT_OF_STOCK", "CANNOT_MEET_WINDOW", "TOO_FAR", "PRICE_CHANGED", "OTHER"] as const;

interface DriverOpt { id: string; name: string | null; vehiclePlate: string | null }

interface Props {
  orderId: string;
  status: string;
  acceptBy: string;
  attempts: number;
  maxAttempts: number;
  drivers: DriverOpt[];
  currentDriverId: string | null;
  /** False when the supplier account is not active (paused, suspended…). */
  canAct: boolean;
}

/** Everything a supplier can do with one order, driven by its state. Every action is re-checked on the server. */
export function SupplierOrderActions(p: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<(typeof DECLINE)[number]>("OUT_OF_STOCK");
  const [note, setNote] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [driverId, setDriverId] = useState(p.currentDriverId ?? p.drivers[0]?.id ?? "");
  const [slots, setSlots] = useState<{ start: string; end: string }[] | null>(null);
  const [slot, setSlot] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (p.status !== "FAILED_ATTEMPT" || p.attempts >= p.maxAttempts) return;
    api<{ slots: { start: string; end: string }[] }>(`/supplier/orders/${p.orderId}/slots`).then((r) => {
      setSlots(r.slots);
      setSlot(r.slots[0]?.start ?? "");
    }).catch(() => setSlots([]));
  }, [p.status, p.attempts, p.maxAttempts, p.orderId]);

  async function run(label: string, fn: () => Promise<unknown>, after: "refresh" | "list" = "refresh") {
    setBusy(label);
    setError(null);
    try {
      await fn();
      if (after === "list") router.push("/supplier/orders");
      else router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(null);
    }
  }

  const post = (path: string, body?: unknown) => api(`/supplier/orders/${p.orderId}/${path}`, { method: "POST", body: body ?? {} });
  const msLeft = new Date(p.acceptBy).getTime() - now;
  const left = () => {
    const m = Math.max(0, Math.floor(msLeft / 60_000));
    return t("fulfil.hoursShort", { h: Math.floor(m / 60), m: m % 60 });
  };
  const driverSelect = (id: string, value: string, onChange: (v: string) => void) => (
    <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {p.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.vehiclePlate ? ` · ${d.vehiclePlate}` : ""}</option>)}
    </select>
  );
  const declineForm = (kind: "decline" | "release") => (
    <div className="mt-3 space-y-3 rounded-[10px] border border-line p-3">
      <h3 className="font-semibold">{kind === "decline" ? t("fulfil.declineTitle") : t("fulfil.releaseTitle")}</h3>
      <p className="text-sm text-muted">{kind === "decline" ? t("fulfil.declineHint") : t("fulfil.releaseHint")}</p>
      <div role="radiogroup" className="grid gap-1.5">
        {DECLINE.map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm">
            <input type="radio" name={`${kind}-reason`} className="size-4 accent-aqua-600" checked={reason === r} onChange={() => setReason(r)} />
            {t(`fulfil.declineReason.${r}`)}
          </label>
        ))}
      </div>
      {reason === "OTHER" ? (
        <div>
          <label htmlFor={`${kind}-note`} className="mb-1 block text-sm font-medium">{t("fulfil.declineNote")}</label>
          <textarea id={`${kind}-note`} className={`${inputCls} min-h-20`} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      ) : null}
      <button
        type="button" className={btnCls("danger")} disabled={!!busy || (reason === "OTHER" && !note.trim())}
        onClick={() => run(kind, () => post(kind, { reason, note: note.trim() || undefined }), "list")}
      >
        {busy === kind ? t("common.loading") : kind === "decline" ? t("fulfil.declineConfirm") : t("fulfil.release")}
      </button>
    </div>
  );

  if (!p.canAct) return <Banner tone="warn">{t("catalogue.needsActive")}</Banner>;

  return (
    <div className="space-y-4">
      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}

      {p.status === "AWAITING_SUPPLIER" ? (
        <Card tint>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">{t("fulfil.openTasks")}</h2>
            <span className={`text-sm font-semibold ${msLeft <= 0 ? "text-bad" : "text-aqua-700"}`}>
              {msLeft <= 0 ? t("fulfil.deadlinePassed") : t("fulfil.timeLeft", { time: left() })}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btnCls("primary")} disabled={!!busy} onClick={() => run("accept", () => post("accept"))}>
              {busy === "accept" ? t("common.loading") : t("fulfil.accept")}
            </button>
            <button type="button" className={btnCls("secondary")} disabled={!!busy} onClick={() => setShowDecline((v) => !v)} aria-expanded={showDecline}>
              {t("fulfil.decline")}
            </button>
          </div>
          {showDecline ? declineForm("decline") : null}
        </Card>
      ) : null}

      {p.status === "ACCEPTED" || p.status === "ASSIGNED" ? (
        <Card>
          <h2 className="mb-2 font-bold">{t("fulfil.assignTitle")}</h2>
          {p.status === "ACCEPTED" ? <p className="mb-3 text-sm text-muted">{t("fulfil.acceptedInfo")}</p> : null}
          {p.drivers.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm">{t("fulfil.noDrivers")}</p>
              <Link href="/supplier/drivers" className={btnCls("secondary")}>{t("fulfil.manageDrivers")}</Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1">
                <label htmlFor="drv" className="mb-1 block text-sm font-medium">{t("fulfil.pickDriver")}</label>
                {driverSelect("drv", driverId, setDriverId)}
              </div>
              <button type="button" className={btnCls("primary")} disabled={!!busy || !driverId || (p.status === "ASSIGNED" && driverId === p.currentDriverId)} onClick={() => run("assign", () => post("assign", { driverId }))}>
                {busy === "assign" ? t("common.loading") : p.status === "ASSIGNED" ? t("fulfil.changeDriver") : t("fulfil.assign")}
              </button>
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <button type="button" className={btnCls("ghost", "!px-0")} onClick={() => setShowRelease((v) => !v)} aria-expanded={showRelease}>{t("fulfil.releaseTitle")}</button>
            {showRelease ? declineForm("release") : null}
          </div>
        </Card>
      ) : null}

      {p.status === "FAILED_ATTEMPT" ? (
        <Card>
          <h2 className="mb-2 font-bold">{t("fulfil.rescheduleTitle")}</h2>
          {p.attempts >= p.maxAttempts ? (
            <Banner tone="warn">{t("fulfil.noMoreAttempts")}</Banner>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted">{t("fulfil.rescheduleHint", { n: p.maxAttempts - p.attempts })}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="slot" className="mb-1 block text-sm font-medium">{t("fulfil.newWindow")}</label>
                  <select id="slot" className={inputCls} value={slot} onChange={(e) => setSlot(e.target.value)} disabled={!slots}>
                    {(slots ?? []).map((s) => <option key={s.start} value={s.start}>{fmtWhen(s.start, locale)}</option>)}
                  </select>
                </div>
                {p.drivers.length > 0 ? (
                  <div>
                    <label htmlFor="drv2" className="mb-1 block text-sm font-medium">{t("fulfil.pickDriver")}</label>
                    {driverSelect("drv2", driverId, setDriverId)}
                  </div>
                ) : null}
              </div>
              <button type="button" className={btnCls("primary")} disabled={!!busy || !slot} onClick={() => run("reschedule", () => post("reschedule", { windowStart: slot, driverId: driverId || undefined }))}>
                {busy === "reschedule" ? t("common.loading") : t("fulfil.reschedule")}
              </button>
            </div>
          )}
          <div className="mt-4 space-y-2 border-t border-line pt-3">
            <label htmlFor="cf" className="block text-sm font-medium">{t("fulfil.cancelFailedReason")}</label>
            <input id="cf" className={inputCls} value={cancelReason} maxLength={300} onChange={(e) => setCancelReason(e.target.value)} />
            <button type="button" className={btnCls("danger")} disabled={!!busy || cancelReason.trim().length < 2} onClick={() => run("cancel", () => post("cancel-failed", { reason: cancelReason.trim() }))}>
              {t("fulfil.cancelFailed")}
            </button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
