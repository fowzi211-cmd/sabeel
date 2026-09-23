import { redirect } from "next/navigation";
import { pageMeta } from "@/i18n/meta";
import { TwoFactor } from "@/components/TwoFactor";
import { homeFor, safeNext } from "@/lib/guards";
import { getCurrentSession, isPrivileged } from "@/lib/session";

export const generateMetadata = pageMeta("twofa.verifyTitle");

export default async function TwoFactorPage({ searchParams }: PageProps<"/2fa">) {
  const sp = await searchParams;
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isPrivileged(current.user.roles)) redirect("/");

  const next = safeNext(sp.next, homeFor(current.user.roles));
  // Already verified this session: nothing to do here.
  if (!current.mfaPending) redirect(next);

  return <TwoFactor mode={current.mfaEnrolmentNeeded ? "setup" : "verify"} next={next} />;
}
