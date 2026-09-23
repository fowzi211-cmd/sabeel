"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { toWesternDigits } from "@/lib/validate";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Field, btnCls, inputCls } from "./ui";

interface Setup {
  qrDataUrl: string;
  secretBase32: string;
}

export function TwoFactor({ mode, next }: { mode: "setup" | "verify"; next: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (mode !== "setup" || started.current) return;
    started.current = true; // avoid creating two secrets under React strict mode
    api<Setup>("/me/2fa/setup", { method: "POST" })
      .then(setSetup)
      .catch((e) => setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error")));
  }, [mode, locale, t]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(mode === "setup" ? "/me/2fa/enable" : "/auth/2fa/verify", { body: { token: toWesternDigits(token).trim() } });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.messageFor(locale) : t("common.error"));
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold">{t(mode === "setup" ? "twofa.setupTitle" : "twofa.verifyTitle")}</h1>
      <p className="mt-2 text-muted">{t(mode === "setup" ? "twofa.setupIntro" : "twofa.verifyIntro")}</p>

      {mode === "setup" && setup ? (
        <div className="mt-4 space-y-3 text-center">
          <p className="text-sm font-medium">{t("twofa.scan")}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qrDataUrl} alt="QR" width={200} height={200} className="mx-auto rounded-lg border border-line" />
          <p className="text-xs text-muted">{t("twofa.manualKey")}</p>
          <p className="ltr-iso select-all break-all rounded bg-page px-2 py-1 font-mono text-sm">{setup.secretBase32}</p>
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
        <Field label={t("twofa.enterCode")} htmlFor="token">
          <input
            id="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            maxLength={7}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className={`${inputCls} text-center text-2xl tracking-[0.4em]`}
            autoFocus
          />
        </Field>
        {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
        <button type="submit" disabled={busy || (mode === "setup" && !setup) || toWesternDigits(token).replace(/\s/g, "").length !== 6} className={btnCls("primary", "w-full")}>
          {busy ? t("common.loading") : t(mode === "setup" ? "twofa.enable" : "twofa.verify")}
        </button>
        {mode === "verify" ? <p className="text-xs text-muted">{t("twofa.lostDevice")}</p> : null}
      </form>
    </Card>
  );
}
