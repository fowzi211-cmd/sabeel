"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client-api";
import { FAIL_REASONS } from "@/lib/fulfilment";
import { fmtSlot } from "@/lib/format";
import { distanceMetres } from "@/lib/geo";
import { useI18n } from "@/i18n/provider";
import type { OutboxItem } from "@/lib/driver-offline";
import { Banner, Card, Chip, btnCls, inputCls } from "../ui";
import { CameraCapture, type Captured } from "./CameraCapture";
import type { Fix, PhotoKind, ViewJob } from "./types";

/** One position reading, or null if the phone cannot give one quickly. Never blocks the driver for long. */
export function getFix(timeoutMs = 6000): Promise<Fix | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, at: Date.now() }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 20_000 },
    );
  });
}

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2, 12)}`);

interface Props {
  job: ViewJob;
  online: boolean;
  enqueue: (item: Omit<OutboxItem, "id" | "createdAt" | "tries">) => Promise<void>;
  /** Push queued work to the server and reload jobs. Resolves once the attempt is over. */
  sync: () => Promise<void>;
  onBack: () => void;
}

/** One delivery, step by step: navigate → start → arrive → recipient code + photos → confirm (or record a failure). */
export function DriverJob({ job, online, enqueue, sync, onBack }: Props) {
  const { t, locale } = useI18n();
  const [camera, setCamera] = useState<PhotoKind | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(job.items.map((i) => [i.id, i.qtyPacks])));
  const [outsideReason, setOutsideReason] = useState("");
  const [bypassReason, setBypassReason] = useState("");
  const [batchNote, setBatchNote] = useState("");
  const [notes, setNotes] = useState("");
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const [failing, setFailing] = useState(false);
  const [failReason, setFailReason] = useState<(typeof FAIL_REASONS)[number]>("RECIPIENT_ABSENT");
  const [failNote, setFailNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  const d = job.destination;
  const target = job.proposedPin ?? { lat: d.lat, lng: d.lng };
  const status = job.deliveryStatus;
  const isIos = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const links = {
    google: `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`,
    apple: `https://maps.apple.com/?daddr=${target.lat},${target.lng}&dirflg=d`,
    waze: `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`,
  };

  // Keep a fresh position while a delivery is under way (also shown to the driver as "am I at the site?").
  useEffect(() => {
    if (status !== "EN_ROUTE" && status !== "ARRIVED") return;
    let stop = false;
    const tick = () => getFix(5000).then((f) => { if (!stop && f) setFix(f); });
    void tick();
    const id = setInterval(tick, 20_000);
    return () => { stop = true; clearInterval(id); };
  }, [status]);

  // Thumbnails for photos that are still only on this phone.
  const previews = useMemo(() => job.pendingPhotos.map((p) => ({ ...p, url: URL.createObjectURL(p.blob) })), [job.pendingPhotos]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const goodsPhotos = [...job.photos.filter((p) => p.kind !== "FAILURE"), ...job.pendingPhotos.filter((p) => p.kind !== "FAILURE")];
  const hasBrand = goodsPhotos.some((p) => p.kind === "BRAND_LABEL");
  const hasFailurePhoto = [...job.photos, ...job.pendingPhotos].some((p) => p.kind === "FAILURE");
  const usable = fix && fix.accuracyM <= 150 ? fix : null;
  const distance = usable ? Math.min(distanceMetres({ lat: d.lat, lng: d.lng }, usable), job.proposedPin ? distanceMetres(job.proposedPin, usable) : Infinity) : null;
  const needsOutside = distance === null || distance > job.radiusM;
  const needsBypass = !job.codeVerified;
  const totalQty = Object.values(qty).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
  const photosOk = goodsPhotos.length >= 2 && hasBrand;
  const canConfirm = photosOk && totalQty > 0 && (!needsOutside || outsideReason.trim().length > 1) && (!needsBypass || bypassReason.trim().length > 1);

  const wrap = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(null);
    }
  };

  const clientAt = () => new Date().toISOString();
  const start = () => wrap("start", async () => {
    await enqueue({ jobId: job.id, orderNo: job.orderNo, type: "START", payload: { clientAt: clientAt() } });
    await sync();
  });
  const arrive = () => wrap("arrive", async () => {
    const f = fix ?? (await getFix(4000));
    await enqueue({ jobId: job.id, orderNo: job.orderNo, type: "ARRIVED", payload: { clientAt: clientAt(), ...(f ? { lat: f.lat, lng: f.lng } : {}) } });
    await sync();
  });
  const proposePin = () => wrap("pin", async () => {
    const f = fix ?? (await getFix(6000));
    if (!f) return setPinMsg(t("driverApp.gpsNone"));
    await enqueue({ jobId: job.id, orderNo: job.orderNo, type: "PIN", payload: { lat: f.lat, lng: f.lng } });
    setPinMsg(t("driverApp.pinSent"));
    await sync();
  });

  const captured = (kind: PhotoKind) => (c: Captured) => {
    setCamera(null);
    void wrap("photo", async () => {
      const f = (await getFix(3000)) ?? fix;
      if (f) setFix(f);
      await enqueue({
        jobId: job.id, orderNo: job.orderNo, type: "PHOTO", blob: c.blob,
        payload: { clientId: uid(), kind, capturedAt: c.capturedAt.toISOString(), source: c.source, ...(f ? { lat: f.lat, lng: f.lng, accuracyM: f.accuracyM } : {}) },
      });
      await sync();
    });
  };

  const confirm = () => wrap("confirm", async () => {
    const f = (await getFix(5000)) ?? fix;
    const ok = f && f.accuracyM <= 150 ? f : null;
    await enqueue({
      jobId: job.id, orderNo: job.orderNo, type: "CONFIRM",
      payload: {
        items: job.items.map((i) => ({ itemId: i.id, deliveredQtyPacks: Math.max(0, Math.min(i.qtyPacks, Math.floor(qty[i.id] ?? 0))) })),
        ...(ok ? { lat: ok.lat, lng: ok.lng, accuracyM: ok.accuracyM } : {}),
        outsideReason: outsideReason.trim() || undefined, otpBypassReason: bypassReason.trim() || undefined,
        batchNote: batchNote.trim() || undefined, notes: notes.trim() || undefined,
        confirmedAt: clientAt(), offline: !navigator.onLine,
      },
    });
    await sync();
  });

  const fail = () => wrap("fail", async () => {
    const f = fix ?? (await getFix(3000));
    await enqueue({
      jobId: job.id, orderNo: job.orderNo, type: "FAIL",
      payload: { reason: failReason, note: failNote.trim() || undefined, clientAt: clientAt(), ...(f ? { lat: f.lat, lng: f.lng } : {}) },
    });
    setFailing(false);
    await sync();
  });

  /** Recipient code steps talk to the server live: they need a connection and the arrival to be recorded first. */
  const sendCode = () => wrap("code", async () => {
    setCodeMsg(null);
    if (job.pendingCount > 0) await sync();
    try {
      const r = await api<{ sendsLeft: number; devCode?: string }>(`/driver/jobs/${job.id}/recipient-code`, { method: "POST", body: {} });
      setCodeMsg({ tone: "ok", text: `${t("driverApp.codeSent", { n: r.sendsLeft })}${r.devCode ? ` ${t("driverApp.codeDev", { code: r.devCode })}` : ""}` });
    } catch (e) {
      setCodeMsg({ tone: "bad", text: e instanceof ApiError && e.status === 0 ? t("driverApp.codeNeedsNet") : e instanceof ApiError ? e.messageFor(locale) : t("common.error") });
    }
  });
  const verifyCode = () => wrap("verify", async () => {
    setCodeMsg(null);
    try {
      await api(`/driver/jobs/${job.id}/recipient-code/verify`, { method: "POST", body: { code } });
      setCode("");
      setCodeMsg({ tone: "ok", text: t("driverApp.codeVerified") });
      await sync();
    } catch (e) {
      setCodeMsg({ tone: "bad", text: e instanceof ApiError && e.status === 0 ? t("driverApp.codeNeedsNet") : e instanceof ApiError ? e.messageFor(locale) : t("common.error") });
    }
  });

  const shot = (kind: PhotoKind, label: string) => (
    <button type="button" className={btnCls(kind === "BRAND_LABEL" && !hasBrand ? "primary" : "secondary", "w-full")} disabled={!!busy} onClick={() => setCamera(kind)}>
      📷 {label}
    </button>
  );

  const photoStrip = (kinds: PhotoKind[]) => (
    <ul className="mt-2 flex flex-wrap gap-2">
      {job.photos.filter((p) => kinds.includes(p.kind)).map((p) => (
        <li key={p.id} className="relative size-16 overflow-hidden rounded-lg border border-line bg-page">
          {/* Private route; the driver may open the photos they took. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/v1/proof-photos/${p.id}`} alt={t(`fulfil.photoKind.${p.kind}`)} className="size-full object-cover" />
        </li>
      ))}
      {previews.filter((p) => kinds.includes(p.kind)).map((p) => (
        <li key={p.clientId} className="relative size-16 overflow-hidden rounded-lg border border-warn bg-page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={t(`fulfil.photoKind.${p.kind}`)} className="size-full object-cover" />
          <span className="absolute inset-x-0 bottom-0 bg-warn/90 px-1 text-center text-[10px] text-white">{t("driverApp.pending")}</span>
        </li>
      ))}
    </ul>
  );

  const line = (label: string, value: React.ReactNode) => value ? (
    <div className="grid gap-0.5 border-t border-line py-2 first:border-0"><dt className="text-xs text-muted">{label}</dt><dd className="font-medium">{value}</dd></div>
  ) : null;

  return (
    <div className="space-y-4 pb-24">
      <button type="button" className={btnCls("ghost", "!px-0")} onClick={onBack}>← {t("driverApp.back")}</button>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="ltr-iso font-mono text-lg font-bold">{job.orderNo}</h2>
          <Chip tone={status === "DELIVERED" ? "ok" : status === "FAILED" ? "bad" : "info"}>{t(`driverApp.status.${status}`)}</Chip>
        </div>
        <dl className="mt-2">
          {line(t("driverApp.window"), fmtSlot(job.window.start, job.window.end, locale))}
          {line(t("driverApp.district"), locale === "ar" ? job.district.nameAr : job.district.nameEn)}
          {line(t("driverApp.recipient"), d.recipientName ? <>{d.recipientName}{d.recipientMobile ? <> · <span className="ltr-iso">{d.recipientMobile}</span></> : null}</> : null)}
          {line(t("driverApp.landmark"), d.landmark)}
          {line(t("driverApp.accessNotes"), d.accessNotes)}
          {line(t("driverApp.note"), job.note)}
          {line(t("orders.supplier"), locale === "ar" ? job.supplier.nameAr : job.supplier.nameEn)}
        </dl>
        <div className="mt-2 border-t border-line pt-2 text-sm text-muted">
          {job.anonymous ? t("driverApp.anonymousDonor") : job.donor ? t("driverApp.donor", { name: job.donor }) : null}
        </div>
        <div className="mt-2 border-t border-line pt-2">
          <div className="mb-1 text-xs text-muted">{t("driverApp.items")}</div>
          <ul className="space-y-1">
            {job.items.map((i) => <li key={i.id} className="font-medium">{locale === "ar" ? i.brandNameAr : i.brandNameEn} — {t("orders.packLine", { ml: i.bottleMl, n: i.bottlesPerPack })} × {i.qtyPacks}</li>)}
          </ul>
        </div>
      </Card>

      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
      {job.pendingCount > 0 ? <Banner tone="warn" role="status">{online ? t("driverApp.syncing") : t("driverApp.offlineSaved")} · {t("driverApp.queue", { n: job.pendingCount })}</Banner> : null}

      {status !== "DELIVERED" && status !== "FAILED" ? (
        <Card>
          <a href={isIos ? links.apple : links.google} target="_blank" rel="noreferrer" className={btnCls("primary", "w-full !min-h-14 text-lg")}>🧭 {t("driverApp.navigate")}</a>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <a className={btnCls("secondary", "!min-h-10 flex-1 !py-1.5")} href={links.google} target="_blank" rel="noreferrer">Google Maps</a>
            <a className={btnCls("secondary", "!min-h-10 flex-1 !py-1.5")} href={links.apple} target="_blank" rel="noreferrer">Apple Maps</a>
            <a className={btnCls("secondary", "!min-h-10 flex-1 !py-1.5")} href={links.waze} target="_blank" rel="noreferrer">Waze</a>
          </div>
          {d.recipientMobile ? <a href={`tel:${d.recipientMobile}`} className={btnCls("secondary", "mt-2 w-full !min-h-12")}>📞 {t("driverApp.call")}</a> : null}
        </Card>
      ) : null}

      {status === "ASSIGNED" ? (
        <button type="button" className={btnCls("primary", "w-full !min-h-14 text-lg")} disabled={!!busy} onClick={start}>{busy === "start" ? t("common.loading") : t("driverApp.start")}</button>
      ) : null}

      {status === "EN_ROUTE" ? (
        <div className="space-y-3">
          <button type="button" className={btnCls("primary", "w-full !min-h-14 text-lg")} disabled={!!busy} onClick={arrive}>{busy === "arrive" ? t("common.loading") : t("driverApp.arrived")}</button>
          <button type="button" className={btnCls("ghost", "w-full text-sm")} disabled={!!busy} onClick={proposePin}>{t("driverApp.proposePin")}</button>
          {pinMsg ? <Banner tone="info" role="status">{pinMsg}</Banner> : null}
        </div>
      ) : null}

      {status === "ARRIVED" ? (
        <>
          <Card>
            <h3 className="font-bold">{t("driverApp.codeTitle")}</h3>
            {job.codeVerified ? (
              <div className="mt-2"><Banner tone="ok">{t("driverApp.codeVerified")}</Banner></div>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-muted">{t("driverApp.codeIntro")}</p>
                <button type="button" className={btnCls("secondary", "w-full")} disabled={!!busy || !online || job.codeSendsLeft <= 0} onClick={sendCode}>{t("driverApp.sendCode")}</button>
                <div className="flex gap-2">
                  <input aria-label={t("driverApp.enterCode")} placeholder={t("driverApp.enterCode")} dir="ltr" inputMode="numeric" maxLength={6} className={`${inputCls} text-center font-mono text-lg tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                  <button type="button" className={btnCls("primary")} disabled={!!busy || !online || code.length !== 6} onClick={verifyCode}>{t("driverApp.verifyCode")}</button>
                </div>
                {!online ? <Banner tone="warn">{t("driverApp.codeNeedsNet")}</Banner> : null}
              </div>
            )}
            {codeMsg ? <div className="mt-2"><Banner tone={codeMsg.tone} role="status">{codeMsg.text}</Banner></div> : null}
          </Card>

          <Card>
            <h3 className="font-bold">{t("driverApp.photosTitle")}</h3>
            <p className="mb-3 text-sm text-muted">{t("driverApp.photosIntro")}</p>
            <div className="grid gap-2">
              {shot("BRAND_LABEL", t("driverApp.takeBrand"))}
              {shot("DELIVERED_GOODS", t("driverApp.takeGoods"))}
              {shot("SITE", t("driverApp.takeSite"))}
            </div>
            {photoStrip(["BRAND_LABEL", "DELIVERED_GOODS", "SITE"])}
            <div className="mt-2 text-sm text-muted">{t("driverApp.photoCount", { n: goodsPhotos.length })}</div>
          </Card>

          <Card>
            <h3 className="mb-2 font-bold">{t("driverApp.qtyTitle")}</h3>
            <ul className="space-y-2">
              {job.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{locale === "ar" ? i.brandNameAr : i.brandNameEn} — {t("orders.packLine", { ml: i.bottleMl, n: i.bottlesPerPack })}</span>
                  <span className="flex items-center gap-2">
                    <input aria-label={t("driverApp.qtyTitle")} type="number" min={0} max={i.qtyPacks} inputMode="numeric" dir="ltr" className={`${inputCls} !w-20 text-center`} value={qty[i.id] ?? 0} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })} />
                    <span className="text-sm text-muted">{t("driverApp.qtyOf", { n: i.qtyPacks })}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h3 className="mb-2 font-bold">{t("driverApp.gpsTitle")}</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {distance === null ? <Chip tone="warn">{t("driverApp.gpsNone")}</Chip> : distance <= job.radiusM ? <Chip tone="ok">{t("driverApp.gpsOk", { m: distance })}</Chip> : <Chip tone="warn">{t("driverApp.gpsFar", { m: distance })}</Chip>}
              <button type="button" className={btnCls("ghost", "!min-h-9 !py-1")} onClick={() => getFix(8000).then((f) => f && setFix(f))}>{t("driverApp.gpsGet")}</button>
            </div>
            {needsOutside ? (
              <div className="mt-2">
                <label htmlFor="out" className="mb-1 block text-sm font-medium">{t("driverApp.outsideReason")}</label>
                <textarea id="out" className={`${inputCls} min-h-16`} maxLength={300} value={outsideReason} onChange={(e) => setOutsideReason(e.target.value)} />
              </div>
            ) : null}
            {needsBypass ? (
              <div className="mt-2">
                <label htmlFor="byp" className="mb-1 block text-sm font-medium">{t("driverApp.bypassLabel")}</label>
                <textarea id="byp" className={`${inputCls} min-h-16`} maxLength={300} value={bypassReason} onChange={(e) => setBypassReason(e.target.value)} />
              </div>
            ) : null}
            <div className="mt-2 grid gap-2">
              <input aria-label={t("driverApp.batchInput")} placeholder={t("driverApp.batchInput")} className={inputCls} maxLength={200} value={batchNote} onChange={(e) => setBatchNote(e.target.value)} />
              <input aria-label={t("driverApp.notesInput")} placeholder={t("driverApp.notesInput")} className={inputCls} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </Card>

          {!photosOk ? <Banner tone="info">{t("driverApp.needPhotos")}</Banner> : null}
          <button type="button" className={btnCls("primary", "w-full !min-h-14 text-lg")} disabled={!!busy || !canConfirm} onClick={confirm}>{busy === "confirm" ? t("common.loading") : t("driverApp.confirmBtn")}</button>
        </>
      ) : null}

      {status === "DELIVERED" ? (
        <Card tint>
          <h3 className="text-lg font-bold">{t("driverApp.doneTitle")}</h3>
          <p className="text-sm">{t("driverApp.doneText")}</p>
        </Card>
      ) : null}

      {status === "FAILED" ? <Banner tone="warn">{t("driverApp.failedInfo")} {t("driverApp.waitingSupplier")}</Banner> : null}

      {(status === "EN_ROUTE" || status === "ARRIVED") && !job.pendingConfirm ? (
        <Card>
          <button type="button" className={btnCls("ghost", "!px-0")} onClick={() => setFailing((v) => !v)} aria-expanded={failing}>{t("driverApp.failStart")}</button>
          {failing ? (
            <div className="mt-2 space-y-2">
              <h3 className="font-bold">{t("driverApp.failTitle")}</h3>
              <label htmlFor="fr" className="block text-sm font-medium">{t("driverApp.failReason")}</label>
              <select id="fr" className={inputCls} value={failReason} onChange={(e) => setFailReason(e.target.value as (typeof FAIL_REASONS)[number])}>
                {FAIL_REASONS.map((r) => <option key={r} value={r}>{t(`fulfil.failReason.${r}`)}</option>)}
              </select>
              <input aria-label={t("driverApp.failNote")} placeholder={t("driverApp.failNote")} className={inputCls} maxLength={300} value={failNote} onChange={(e) => setFailNote(e.target.value)} />
              {shot("FAILURE", t("driverApp.failPhoto"))}
              {photoStrip(["FAILURE"])}
              <button type="button" className={btnCls("danger", "w-full")} disabled={!!busy || !hasFailurePhoto || (failReason === "OTHER" && !failNote.trim())} onClick={fail}>{t("driverApp.failConfirm")}</button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {camera ? (
        <CameraCapture
          label={camera === "BRAND_LABEL" ? t("driverApp.takeBrand") : camera === "DELIVERED_GOODS" ? t("driverApp.takeGoods") : camera === "SITE" ? t("driverApp.takeSite") : t("driverApp.takeFailure")}
          onCapture={captured(camera)} onCancel={() => setCamera(null)}
        />
      ) : null}
    </div>
  );
}
