"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";
import { Banner, btnCls } from "./ui";

export function SubmitPanel({ ready, blockers }: { ready: boolean; blockers: string[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = (b: string) =>
    b.startsWith("doc:") ? `${t("supplier.missing.docPrefix")}${t(`supplier.docKind.${b.slice(4)}`)}` : t(`supplier.missing.${b}`);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/supplier/submit", { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-muted">{t("supplier.submitText")}</p>
      {!ready ? (
        <Banner tone="warn">
          {t("supplier.submitBlocked")}
          <ul className="mt-1 list-disc ps-5">
            {blockers.map((b) => (
              <li key={b}>{label(b)}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
      <button type="button" className={btnCls("primary")} disabled={!ready || busy} onClick={submit}>
        {busy ? t("common.loading") : t("supplier.submitButton")}
      </button>
    </div>
  );
}
