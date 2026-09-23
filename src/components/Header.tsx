import Link from "next/link";
import { getI18n } from "@/i18n";
import { getCurrentSession, hasRole, isAdmin } from "@/lib/session";
import { LangSwitch } from "./LangSwitch";
import { SignOutButton } from "./SignOutButton";

export async function Header() {
  const { t } = await getI18n();
  const current = await getCurrentSession();
  const roles = current?.user.roles ?? [];
  const link = "rounded-full px-3 py-1 text-sm font-medium text-white/90 hover:bg-white/15 hover:text-white";

  return (
    <header className="sticky top-0 z-30 bg-aqua-700 text-white shadow-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Link href="/" className="flex items-baseline gap-2 text-lg font-bold">
          <span>{t("common.appName")}</span>
          <span className="text-xs font-medium opacity-75" dir="ltr">
            Sabeel
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1" aria-label="Main">
          {current && !current.mfaPending ? (
            <>
              <Link href="/order" className={link}>
                {t("nav.orderWater")}
              </Link>
              <Link href="/orders" className={link}>
                {t("nav.myOrders")}
              </Link>
              <Link href="/account" className={link}>
                {t("common.account")}
              </Link>
              {roles.includes("DRIVER") && (
                <Link href="/driver" className={link}>
                  {t("nav.driver")}
                </Link>
              )}
              {hasRole(roles, "SUPPLIER_ADMIN") && (
                <Link href="/supplier" className={link}>
                  {t("common.supplierPortal")}
                </Link>
              )}
              {isAdmin(roles) && (
                <Link href="/admin" className={link}>
                  {t("common.admin")}
                </Link>
              )}
            </>
          ) : null}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <LangSwitch signedIn={!!current} />
          {current ? (
            <SignOutButton />
          ) : (
            <Link href="/login" className="rounded-full bg-white px-3.5 py-1 text-sm font-semibold text-aqua-700 hover:bg-aqua-100">
              {t("common.signIn")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
