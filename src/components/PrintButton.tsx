"use client";

import { useI18n } from "@/i18n/provider";
import { btnCls } from "./ui";

export function PrintButton() {
  const { t } = useI18n();
  return (
    <button type="button" className={btnCls("primary", "no-print")} onClick={() => window.print()}>
      {t("certificate.print")}
    </button>
  );
}
