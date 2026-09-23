"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/provider";

export function AdminNav({ items }: { items: { href: string; key: string }[] }) {
  const path = usePathname();
  const { t } = useI18n();
  return (
    <nav aria-label="Admin" className="mb-6 flex flex-wrap gap-1.5 border-b border-line pb-3">
      {items.map((i) => {
        const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${active ? "bg-aqua-600 text-white" : "bg-white text-aqua-700 ring-1 ring-line hover:bg-aqua-100"}`}
          >
            {t(`admin.nav.${i.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
