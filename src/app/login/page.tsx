import { redirect } from "next/navigation";
import { pageMeta } from "@/i18n/meta";
import { LoginForm } from "@/components/LoginForm";
import { homeFor, safeNext } from "@/lib/guards";
import { getCurrentSession } from "@/lib/session";

export const generateMetadata = pageMeta("auth.title");

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const current = await getCurrentSession();
  if (current && !current.mfaPending) redirect(next !== "/" ? next : homeFor(current.user.roles));
  return <LoginForm next={next} />;
}
