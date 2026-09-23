"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/provider";

/** Portal sections for an approved supplier. */
export function SupplierSubnav() {
  const path = usePathname();
  const { t } = useI18n();
  const items = [
    { href: "/supplier", label: t("supplier.title"), exact: true },
    { href: "/supplier/catalogue", label: t("catalogue.title") },
    { href: "/supplier/zones", label: t("zones.title") },
    { href: "/supplier/orders", label: t("sorders.title") },
    { href: "/supplier/drivers", label: t("drivers.title") },
    { href: "/supplier/payments", label: t("payments.title") },
    { href: "/supplier/fees", label: t("supplierFees.title") },
    { href: "/supplier/reviews", label: t("supplierReviews.title") },
  ];
  return (
    <nav aria-label="Supplier" className="mb-5 flex flex-wrap gap-1.5 border-b border-line pb-3">
      {items.map((i) => {
        const active = i.exact ? path === i.href : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${active ? "bg-aqua-600 text-white" : "bg-white text-aqua-700 ring-1 ring-line hover:bg-aqua-100"}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
