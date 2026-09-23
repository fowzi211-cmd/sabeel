import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { dictionaries, getI18n } from "@/i18n";
import { I18nProvider } from "@/i18n/provider";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: `${t("common.appName")} — ${t("common.tagline")}`, template: `%s · ${t("common.appName")}` },
    description: t("home.heroText"),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, dir } = await getI18n();
  return (
    <html lang={locale} dir={dir} className={`${plexArabic.variable} ${inter.variable}`}>
      <body className="flex min-h-screen flex-col antialiased">
        <I18nProvider locale={locale} dict={dictionaries[locale]}>
          <Header />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
          <footer className="no-print border-t border-line px-4 py-4 text-center text-xs text-muted">
            © Sabeel · سبيل
          </footer>
        </I18nProvider>
      </body>
    </html>
  );
}
