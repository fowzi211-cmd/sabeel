import { DriverApp } from "@/components/driver/DriverApp";
import { pageMeta } from "@/i18n/meta";
import { requirePage } from "@/lib/guards";
import { getCurrentTerms } from "@/server/terms";

export const generateMetadata = pageMeta("driverApp.title");

/**
 * The shell is identical for every driver (no personal data in the HTML) so the service worker can keep a
 * copy for offline starts; jobs are fetched by the client and cached on the phone.
 */
export default async function DriverPage() {
  await requirePage({ path: "/driver", roles: ["DRIVER"] });
  const doc = await getCurrentTerms("DRIVER_ACK");
  return (
    <DriverApp
      ackDoc={doc ? { version: doc.version, titleAr: doc.titleAr, titleEn: doc.titleEn, bodyAr: doc.bodyAr, bodyEn: doc.bodyEn, legalReviewed: !!doc.legalReviewedAt } : null}
    />
  );
}
