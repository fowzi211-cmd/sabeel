import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getCurrentSession, hasRole, isAdmin, type CurrentSession } from "./session";

/** Only same-site relative paths may be used as a post-login destination (no open redirect). */
export function safeNext(next: string | string[] | undefined, fallback = "/"): string {
  const v = Array.isArray(next) ? next[0] : next;
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return fallback;
  return v;
}

/** Where a signed-in user lands by default. */
export function homeFor(roles: readonly Role[]): string {
  if (isAdmin(roles)) return "/admin";
  if (roles.includes("SUPPLIER_ADMIN")) return "/supplier";
  if (roles.includes("DRIVER") && !roles.includes("BUYER")) return "/driver";
  return "/";
}

/**
 * Server-component guard. Redirects instead of rendering when the visitor is not allowed.
 * The API routes enforce the same rules independently — pages are not the security boundary.
 */
export async function requirePage(opts: {
  path: string;
  roles?: Role[];
  allowMfaPending?: boolean;
}): Promise<CurrentSession> {
  const s = await getCurrentSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(opts.path)}`);
  if (s.mfaPending && !opts.allowMfaPending) {
    redirect(`/2fa${s.mfaEnrolmentNeeded ? "?setup=1&" : "?"}next=${encodeURIComponent(opts.path)}`);
  }
  if (opts.roles && !hasRole(s.user.roles, ...opts.roles)) redirect("/");
  return s;
}
