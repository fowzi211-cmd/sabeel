"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { api } from "@/lib/client-api";
import { clearDriverData, outboxList } from "@/lib/driver-offline";
import { useI18n } from "@/i18n/provider";

export function SignOutButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          // A driver's unsent deliveries live only on this phone: never throw them away silently.
          const unsent = await outboxList().catch(() => []);
          if (unsent.length > 0 && !window.confirm(t("driverApp.signOutPending"))) return;
          await api("/auth/logout", { method: "POST" }).catch(() => undefined);
          await clearDriverData().catch(() => undefined);
          router.push("/");
          router.refresh();
        })
      }
      className="rounded-full border border-white/40 px-3 py-1 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-60"
    >
      {t("common.signOut")}
    </button>
  );
}
