"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client-api";
import { fmtSlot } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { kvGet, kvSet, outboxAdd, outboxList, type FailedItem, type OutboxItem } from "@/lib/driver-offline";
import { flushOutbox } from "@/lib/driver-sync";
import { AgreementText } from "../AgreementText";
import { Banner, Card, Chip, btnCls } from "../ui";
import { DriverJob } from "./DriverJob";
import type { AckDoc, Job, JobsResponse, LocalPhoto, PhotoKind, ViewJob } from "./types";

/** Server data + what is queued on this phone = what the driver should see right now (optimistic). */
function overlay(job: Job, queued: OutboxItem[]): ViewJob {
  const mine = queued.filter((i) => i.jobId === job.id);
  const v: ViewJob = { ...job, pendingPhotos: [], pendingCount: mine.length, pendingConfirm: false };
  for (const i of mine) {
    if (i.type === "START" && v.deliveryStatus === "ASSIGNED") { v.deliveryStatus = "EN_ROUTE"; v.orderStatus = "OUT_FOR_DELIVERY"; }
    if (i.type === "ARRIVED" && (v.deliveryStatus === "EN_ROUTE" || v.deliveryStatus === "ASSIGNED")) v.deliveryStatus = "ARRIVED";
    if (i.type === "PHOTO" && i.blob) v.pendingPhotos.push({ clientId: String(i.payload.clientId), kind: i.payload.kind as PhotoKind, blob: i.blob } satisfies LocalPhoto);
    if (i.type === "CONFIRM") { v.deliveryStatus = "DELIVERED"; v.proofSubmitted = true; v.pendingConfirm = true; }
    if (i.type === "FAIL") v.deliveryStatus = "FAILED";
    if (i.type === "PIN") v.proposedPin = { lat: Number(i.payload.lat), lng: Number(i.payload.lng), note: null };
  }
  return v;
}

const hashJob = () => (typeof location !== "undefined" ? new URLSearchParams(location.hash.replace(/^#/, "")).get("job") : null);

export function DriverApp({ ackDoc }: { ackDoc: AckDoc | null }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<JobsResponse | null>(null);
  const [queued, setQueued] = useState<OutboxItem[]>([]);
  const [failed, setFailed] = useState<FailedItem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const syncingRef = useRef(false);
  const rerunRef = useRef(false);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const r = await api<JobsResponse>("/driver/jobs");
      setData(r);
      setOnline(true);
      setLastSync(Date.now());
      void kvSet("jobs", r);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSignedOut(true);
      else setOnline(false);
      return false;
    }
  }, []);

  const sync = useCallback(async () => {
    // A call that arrives mid-run (the driver queued something meanwhile) asks for one more pass.
    if (syncingRef.current) {
      rerunRef.current = true;
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    try {
      do {
        rerunRef.current = false;
        const r = await flushOutbox();
        if (r.signedOut) setSignedOut(true);
        if (r.failed.length > 0) setFailed(((await kvGet<FailedItem[]>("failed")) ?? []).slice(-5));
        setQueued(await outboxList());
        if (!r.offline && !r.signedOut) await load();
        else if (r.offline) {
          setOnline(false);
          rerunRef.current = false; // nothing more can be sent right now
        }
      } while (rerunRef.current);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [load]);

  const enqueue = useCallback(async (item: Omit<OutboxItem, "id" | "createdAt" | "tries">) => {
    await outboxAdd(item);
    setQueued(await outboxList());
  }, []);

  // First paint from the phone's own copy, then talk to the server.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [cached, q, f] = await Promise.all([kvGet<JobsResponse>("jobs"), outboxList(), kvGet<FailedItem[]>("failed")]);
      if (!alive) return;
      if (cached) setData(cached);
      setQueued(q);
      setFailed((f ?? []).slice(-5));
      setSelected(hashJob());
      setReady(true);
      void sync();
    })();
    return () => { alive = false; };
  }, [sync]);

  // Keep going: when the connection returns, when the app comes back to the front, and every 30 s.
  useEffect(() => {
    const goOnline = () => { setOnline(true); void sync(); };
    const goOffline = () => setOnline(false);
    const visible = () => { if (document.visibilityState === "visible") void sync(); };
    const hash = () => setSelected(hashJob());
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("hashchange", hash);
    window.addEventListener("popstate", hash);
    document.addEventListener("visibilitychange", visible);
    const id = setInterval(() => void sync(), 30_000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("popstate", hash);
      document.removeEventListener("visibilitychange", visible);
      clearInterval(id);
    };
  }, [sync]);

  // Installable + offline-capable shell. In development it is opt-in (?sw=1) so stale caches never confuse debugging.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const dev = process.env.NODE_ENV !== "production";
    if (dev && !new URLSearchParams(location.search).has("sw")) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  const jobs = useMemo(() => (data?.jobs ?? []).map((j) => overlay(j, queued)), [data, queued]);
  const recent = data?.history ?? [];
  // A finished delivery moves to "recent" on the server but stays openable, so the driver sees its result.
  const current = selected ? [...jobs, ...recent.map((j) => overlay(j, queued))].find((j) => j.id === selected) ?? null : null;
  // The open job lives in the URL hash so the back button works and a reload returns to the same screen.
  const openJob = (id: string) => {
    window.history.pushState(null, "", `#job=${id}`);
    setSelected(id);
  };
  const goBack = () => {
    window.history.pushState(null, "", window.location.pathname + window.location.search);
    setSelected(null);
  };

  if (signedOut) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        <Banner tone="warn" role="alert">{t("driverApp.signedOut")}</Banner>
        <a href="/login?next=/driver" className={btnCls("primary", "w-full")}>{t("common.signIn")}</a>
      </div>
    );
  }

  if (!ready) return <p className="text-muted">{t("common.loading")}</p>;

  if (data?.ackRequired && ackDoc) return <AckGate doc={ackDoc} onDone={() => void load()} />;

  return (
    <div className="mx-auto max-w-md space-y-4">
      {!online ? <Banner tone="warn" role="status">{t("driverApp.offline")}</Banner> : null}
      {queued.length > 0 ? (
        <Banner tone="info" role="status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{syncing ? t("driverApp.syncing") : t("driverApp.queue", { n: queued.length })}</span>
            <button type="button" className={btnCls("secondary", "!min-h-9 !py-1 text-sm")} disabled={syncing} onClick={() => void sync()}>{t("driverApp.syncNow")}</button>
          </div>
        </Banner>
      ) : null}
      {failed.length > 0 ? (
        <Banner tone="bad" role="alert">
          <ul className="space-y-1">
            {failed.map((f) => <li key={f.at}><span className="ltr-iso font-mono">{f.orderNo}</span>: {t("driverApp.syncFailed", { msg: locale === "ar" ? f.ar : f.en })}</li>)}
          </ul>
          <button type="button" className={btnCls("ghost", "!min-h-9 !px-0 text-sm")} onClick={() => { setFailed([]); void kvSet("failed", []); }}>{t("driverApp.dismiss")}</button>
        </Banner>
      ) : null}

      {current ? (
        <DriverJob key={current.id} job={current} online={online} enqueue={enqueue} sync={sync} onBack={goBack} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold">{t("driverApp.hello", { name: (data?.driverName ?? "").split(/\s+/)[0] })}</h1>
            <button type="button" className={btnCls("secondary", "!min-h-9 !py-1 text-sm")} disabled={syncing} onClick={() => void sync()}>{syncing ? t("driverApp.syncing") : t("driverApp.refresh")}</button>
          </div>
          {lastSync ? <div className="text-xs text-muted">{t("driverApp.lastSync", { time: new Date(lastSync).toLocaleTimeString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) })}</div> : null}

          <h2 className="font-bold">{t("driverApp.jobs")}</h2>
          {jobs.length === 0 ? <Card><p className="text-muted">{t("driverApp.noJobs")}</p></Card> : null}
          <ul className="space-y-3">
            {jobs.map((j) => (
              <li key={j.id}>
                <button type="button" onClick={() => openJob(j.id)} className="block w-full rounded-xl border border-line bg-white p-4 text-start hover:border-aqua-500">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="ltr-iso font-mono font-semibold">{j.orderNo}</span>
                    <span className="flex gap-1.5">
                      {j.pendingCount > 0 ? <Chip tone="warn">{t("driverApp.queue", { n: j.pendingCount })}</Chip> : null}
                      <Chip tone={j.deliveryStatus === "DELIVERED" ? "ok" : j.deliveryStatus === "FAILED" ? "bad" : "info"}>{t(`driverApp.status.${j.deliveryStatus}`)}</Chip>
                    </span>
                  </div>
                  <div className="mt-1 text-sm">{fmtSlot(j.window.start, j.window.end, locale)}</div>
                  <div className="mt-1 text-sm text-muted">{locale === "ar" ? j.district.nameAr : j.district.nameEn}{j.destination.recipientName ? ` · ${j.destination.recipientName}` : ""}</div>
                </button>
              </li>
            ))}
          </ul>

          {recent.length > 0 ? (
            <>
              <h2 className="pt-2 font-bold">{t("driverApp.history")}</h2>
              <ul className="space-y-2">
                {recent.map((j) => (
                  <li key={j.id} className="rounded-xl border border-line bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="ltr-iso font-mono">{j.orderNo}</span>
                      <Chip tone="ok">{t("driverApp.status.DELIVERED")}</Chip>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="text-xs text-muted">{t("driverApp.installHint")}</p>
        </>
      )}
    </div>
  );
}

function AckGate({ doc, onDone }: { doc: AckDoc; onDone: () => void }) {
  const { t, locale } = useI18n();
  const [lang, setLang] = useState<"AR" | "EN">(locale === "ar" ? "AR" : "EN");
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api("/terms/accept", { body: { type: "DRIVER_ACK", version: doc.version, language: lang, confirmRead: true } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-xl font-bold">{t("driverApp.ackTitle")}</h1>
      <p className="text-muted">{t("driverApp.ackIntro")}</p>
      <AgreementText titleAr={doc.titleAr} titleEn={doc.titleEn} bodyAr={doc.bodyAr} bodyEn={doc.bodyEn} onLanguage={setLang} maxHeightClass="max-h-80" />
      {!doc.legalReviewed ? <p className="text-xs font-semibold text-warn">{t("common.draftBadge")}</p> : null}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-4 accent-aqua-600" checked={read} onChange={(e) => setRead(e.target.checked)} />
        <span>{t("driverApp.ackAccept")}</span>
      </label>
      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
      <button type="button" className={btnCls("primary", "w-full")} disabled={!read || busy} onClick={accept}>{busy ? t("common.loading") : t("driverApp.ackButton")}</button>
    </div>
  );
}
