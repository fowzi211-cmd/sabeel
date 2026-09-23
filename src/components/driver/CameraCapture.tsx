"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { Banner, btnCls } from "../ui";

export interface Captured {
  blob: Blob;
  capturedAt: Date;
  /** CAMERA = live capture inside the app; FILE = the browser's file picker (flagged for review on the server). */
  source: "CAMERA" | "FILE";
}

const MAX_W = 1600;

/**
 * Live camera capture. There is deliberately no "choose from gallery": proof photos must be taken now, here.
 * If the camera cannot be opened, a file input with `capture` is offered and the photo is flagged for review.
 */
export function CameraCapture({ label, onCapture, onCancel }: { label: string; onCapture: (c: Captured) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) return setFallback(true);
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: MAX_W } }, audio: false });
        if (cancelled) return s.getTracks().forEach((tr) => tr.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch {
        if (!cancelled) setFallback(true);
      }
    }
    void start();
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, MAX_W / v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) onCapture({ blob, capturedAt: new Date(), source: "CAMERA" });
    }, "image/jpeg", 0.82);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3" role="dialog" aria-modal="true" aria-label={label}>
      <div className="mb-2 text-center text-sm font-semibold text-white">{label}</div>
      {fallback ? (
        <div className="m-auto w-full max-w-sm space-y-3 rounded-xl bg-white p-4">
          <Banner tone="warn">{t("driverApp.camDenied")}</Banner>
          <input
            type="file" accept="image/*" capture="environment" className="w-full text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onCapture({ blob: f, capturedAt: new Date(), source: "FILE" });
            }}
          />
        </div>
      ) : (
        <div className="relative m-auto w-full max-w-md flex-1 overflow-hidden rounded-xl bg-black">
          <video ref={video} playsInline muted className="size-full object-cover" />
        </div>
      )}
      <div className="mt-3 flex items-center justify-center gap-3">
        <button type="button" className={btnCls("secondary")} onClick={onCancel}>{t("driverApp.cancel")}</button>
        {!fallback ? (
          <button type="button" className={btnCls("primary", "!min-h-14 !px-8 text-lg")} disabled={!ready} onClick={snap}>{t("driverApp.capture")}</button>
        ) : null}
      </div>
    </div>
  );
}
