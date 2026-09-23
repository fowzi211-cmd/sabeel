"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";
import { Banner, Field, btnCls, inputCls } from "./ui";

export function ProfileForm({
  mobile,
  initialName,
  initialEmail,
  next,
  termsAccepted,
}: {
  mobile: string;
  initialName: string;
  initialEmail: string;
  next?: string;
  /** Continue to `next` only once the terms are also accepted; otherwise the terms card does it. */
  termsAccepted: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await api("/me", { method: "PATCH", body: { name, email } });
      setMsg({ tone: "ok", text: t("common.saved") });
      router.refresh();
      if (next && next !== "/account" && termsAccepted) router.push(next);
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof ApiError ? err.messageFor(locale) : t("common.error"), field: err instanceof ApiError ? err.field : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label={t("common.mobile")} htmlFor="mobile-ro">
        <input id="mobile-ro" dir="ltr" readOnly value={mobile} className={`${inputCls} bg-page text-start`} />
      </Field>
      <Field label={t("account.fullName")} htmlFor="name" hint={t("account.nameHelp")} error={msg?.field === "name" ? msg.text : null}>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoComplete="name" />
      </Field>
      <Field label={`${t("common.email")} (${t("common.optional")})`} htmlFor="email" error={msg?.field === "email" ? msg.text : null}>
        <input id="email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} text-start`} autoComplete="email" />
      </Field>
      {msg && !msg.field ? <Banner tone={msg.tone} role="status">{msg.text}</Banner> : null}
      <button type="submit" disabled={busy || name.trim().length < 2} className={btnCls("primary")}>
        {busy ? t("common.loading") : t("account.saveProfile")}
      </button>
    </form>
  );
}
