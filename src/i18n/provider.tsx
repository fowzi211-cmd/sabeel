"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Dict } from "./ar";

type Locale = "ar" | "en";
type T = (key: string, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: T;
}

const Ctx = createContext<I18nValue | null>(null);

function lookup(dict: Dict, key: string, vars?: Record<string, string | number>): string {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else return key;
  }
  if (typeof node !== "string") return key;
  return vars ? node.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)) : node;
}

export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dict; children: ReactNode }) {
  const value = useMemo<I18nValue>(
    () => ({ locale, dir: locale === "ar" ? "rtl" : "ltr", t: (k, v) => lookup(dict, k, v) }),
    [locale, dict],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}
