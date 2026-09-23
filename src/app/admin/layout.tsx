import { AdminNav } from "@/components/AdminNav";
import { requirePage } from "@/lib/guards";
import { hasRole } from "@/lib/session";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { user } = await requirePage({ path: "/admin", roles: ["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE"] });
  const r = user.roles;

  const items = [
    { href: "/admin", key: "dashboard", show: true },
    { href: "/admin/suppliers", key: "suppliers", show: hasRole(r, "ADMIN_OPS", "ADMIN_SUPPORT") },
    { href: "/admin/orders", key: "orders", show: true },
    { href: "/admin/disputes", key: "disputes", show: hasRole(r, "ADMIN_OPS", "ADMIN_SUPPORT") },
    { href: "/admin/brands", key: "brands", show: hasRole(r, "ADMIN_OPS", "ADMIN_SUPPORT") },
    { href: "/admin/districts", key: "districts", show: hasRole(r, "ADMIN_OPS", "ADMIN_SUPPORT") },
    { href: "/admin/terms", key: "terms", show: true },
    { href: "/admin/fees", key: "fees", show: hasRole(r, "ADMIN_OPS", "ADMIN_FINANCE") },
    { href: "/admin/fee-invoices", key: "feeInvoices", show: hasRole(r, "ADMIN_OPS", "ADMIN_FINANCE") },
    { href: "/admin/reviews", key: "reviews", show: hasRole(r, "ADMIN_OPS", "ADMIN_SUPPORT") },
    { href: "/admin/audit", key: "audit", show: hasRole(r, "ADMIN_OPS", "ADMIN_FINANCE") },
    { href: "/admin/users", key: "users", show: r.includes("SUPER_ADMIN") },
  ].filter((i) => i.show);

  return (
    <div>
      <AdminNav items={items} />
      {children}
    </div>
  );
}
