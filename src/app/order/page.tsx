import { OrderWizard } from "@/components/OrderWizard";
import { pageMeta } from "@/i18n/meta";
import { requirePage } from "@/lib/guards";
import { capForPaidCount } from "@/lib/trust";
import { hasAcceptedCurrent } from "@/server/terms";

export const generateMetadata = pageMeta("order.title");

export default async function OrderPage({ searchParams }: PageProps<"/order">) {
  const sp = await searchParams;
  const { user } = await requirePage({ path: "/order" });
  const type = (Array.isArray(sp.type) ? sp.type[0] : sp.type) === "self" ? "SELF_USE" : "DONATION";

  const terms = await hasAcceptedCurrent({ userId: user.id, supplierId: null, type: "BUYER_TERMS" });
  return (
    <OrderWizard
      type={type}
      hasName={!!user.name?.trim()}
      termsAccepted={!terms.doc || terms.accepted}
      capHalalas={capForPaidCount(user.paidOrdersCount)}
    />
  );
}
