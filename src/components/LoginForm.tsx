"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { toWesternDigits } from "@/lib/validate";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Field, btnCls, inputCls } from "./ui";

interface RequestRes {
  mobile: string;
  cooldownSeconds: number;
  devCode?: string;
}
interface VerifyRes {
  next: string;
  user: { name: string | null };
}

export function LoginForm({ next }: { next: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<"mobile" | "code">("mobile");
  const [mobile, setMobile] = useState("");
  const [normalized, setNormalized] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const fail = (e: unknown) => {
    if (e instanceof ApiError) setError({ msg: e.messageFor(locale), field: e.field });
    else setError({ msg: t("common.error") });
  };

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<RequestRes>("/auth/otp/request", { body: { mobile, lang: locale.toUpperCase() } });
      setNormalized(res.mobile);
      setDevCode(res.devCode ?? null);
      setCooldown(res.cooldownSeconds);
      setCode("");
      setStep("code");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<VerifyRes>("/auth/otp/verify", {
        body: { mobile: normalized, code: toWesternDigits(code).trim(), lang: locale.toUpperCase() },
      });
      let dest = next !== "/" ? next : res.next;
      if (res.next.startsWith("/2fa")) {
        dest = `${res.next}${res.next.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
      } else if (res.next === "/account") {
        dest = `/account?next=${encodeURIComponent(next)}`;
      }
      router.replace(dest);
      router.refresh();
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold">{t("auth.title")}</h1>

      {step === "mobile" ? (
        <form onSubmit={sendCode} className="mt-4 space-y-4" noValidate>
          <p className="text-muted">{t("auth.intro")}</p>
          <Field label={t("auth.mobileLabel")} htmlFor="mobile" error={error?.field === "mobile" ? error.msg : null}>
            <input
              id="mobile"
              type="tel"
              dir="ltr"
              autoComplete="tel-national"
              inputMode="tel"
              placeholder={t("auth.mobileHint")}
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className={`${inputCls} text-start`}
              autoFocus
            />
          </Field>
          {error && error.field !== "mobile" ? <Banner tone="bad" role="alert">{error.msg}</Banner> : null}
          <button type="submit" disabled={busy || mobile.trim().length < 9} className={btnCls("primary", "w-full")}>
            {busy ? t("common.loading") : t("auth.sendCode")}
          </button>
          <p className="text-xs text-muted">{t("auth.termsNote")}</p>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-4 space-y-4" noValidate>
          <p className="text-muted">
            {t("auth.codeSentTo", { mobile: "" })}
            <span className="ltr-iso font-semibold text-ink">{normalized}</span>
          </p>
          {devCode ? <Banner tone="warn">{t("common.devMode", { code: devCode })}</Banner> : null}
          <Field label={t("auth.codeLabel")} htmlFor="code">
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${inputCls} text-center text-2xl tracking-[0.5em]`}
              autoFocus
            />
          </Field>
          {error ? <Banner tone="bad" role="alert">{error.msg}</Banner> : null}
          <button type="submit" disabled={busy || toWesternDigits(code).trim().length !== 6} className={btnCls("primary", "w-full")}>
            {busy ? t("common.loading") : t("auth.verify")}
          </button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="font-semibold text-aqua-700 underline disabled:no-underline disabled:opacity-50" disabled={cooldown > 0 || busy} onClick={() => sendCode()}>
              {cooldown > 0 ? t("auth.resendIn", { s: cooldown }) : t("auth.resend")}
            </button>
            <button type="button" className="text-muted underline" onClick={() => { setStep("mobile"); setError(null); }}>
              {t("auth.changeNumber")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
