import { cookies } from "next/headers";
import { ar, type Dict } from "./ar";
import { en } from "./en";

export type Locale = "ar" | "en";
export const LANG_COOKIE = "sabeel_lang";

export const dictionaries: Record<Locale, Dict> = { ar, en };

/** Reads the visitor's language (cookie), defaulting to Arabic. */
export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return v === "en" ? "en" : "ar";
}

/** Looks up "a.b.c" in a dictionary and fills {placeholders}. Unknown keys return the key itself. */
export function translate(dict: Dict, key: string, vars?: Record<string, string | number>): string {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  if (typeof node !== "string") return key;
  return vars ? node.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)) : node;
}

/** Server-component helper: `const { t, locale, dir } = await getI18n();` */
export async function getI18n() {
  const locale = await getLocale();
  const dict = dictionaries[locale];
  return {
    locale,
    dir: locale === "ar" ? ("rtl" as const) : ("ltr" as const),
    t: (key: string, vars?: Record<string, string | number>) => translate(dict, key, vars),
  };
}
