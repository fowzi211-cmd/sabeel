import type { Metadata } from "next";
import { getI18n } from "./index";

/** `export const generateMetadata = pageMeta("admin.nav.fees");` — browser-tab titles follow the visitor's language. */
export const pageMeta = (key: string) => async (): Promise<Metadata> => {
  const { t } = await getI18n();
  return { title: t(key) };
};
