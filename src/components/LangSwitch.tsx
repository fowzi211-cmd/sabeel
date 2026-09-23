"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { api } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";

export function LangSwitch({ signedIn }: { signedIn: boolean }) {
  const { locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = locale === "ar" ? "en" : "ar";

  const switchTo = () => {
    document.cookie = `sabeel_lang=${next}; path=/; max-age=31536000; samesite=lax`;
    start(async () => {
      if (signedIn) await api("/me", { method: "PATCH", body: { language: next.toUpperCase() } }).catch(() => undefined);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={switchTo}
      disabled={pending}
      className="rounded-full border border-white/40 px-3 py-1 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-60"
      aria-label={next === "ar" ? "التبديل إلى العربية" : "Switch to English"}
    >
      {next === "ar" ? "العربية" : "English"}
    </button>
  );
}
