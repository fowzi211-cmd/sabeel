import { cache } from "react";
import { cookies } from "next/headers";
import type { Role, Session, User } from "@prisma/client";
import { db } from "./db";
import { randomToken, sha256Hex } from "./crypto";
import { getEnv } from "./env";
import type { RequestMeta } from "./audit";

export const SESSION_COOKIE = "sabeel_session";

const DAY = 86_400_000;
/** Roles that must complete two-step verification before using their portal. */
const PRIVILEGED: Role[] = ["SUPPLIER_ADMIN", "ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE", "SUPER_ADMIN"];
const ADMIN_ROLES: Role[] = ["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE", "SUPER_ADMIN"];

export const isPrivileged = (roles: readonly Role[]) => roles.some((r) => PRIVILEGED.includes(r));
export const isAdmin = (roles: readonly Role[]) => roles.some((r) => ADMIN_ROLES.includes(r));
export const hasRole = (roles: readonly Role[], ...wanted: Role[]) =>
  roles.includes("SUPER_ADMIN") || wanted.some((r) => roles.includes(r));

export type SessionUser = User;
export interface CurrentSession {
  session: Session;
  user: SessionUser;
  /** Privileged account whose session has not passed two-step verification yet. */
  mfaPending: boolean;
  /** Privileged account that still has to enrol an authenticator app. */
  mfaEnrolmentNeeded: boolean;
}

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: getEnv().APP_ORIGIN.startsWith("https://"),
  path: "/",
  expires,
});

export async function createSession(userId: string, roles: readonly Role[], meta: RequestMeta) {
  const token = randomToken(32);
  // Privileged sessions are short (12 h); everyone else 7 days.
  const expiresAt = new Date(Date.now() + (isPrivileged(roles) ? DAY / 2 : 7 * DAY));
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      expiresAt,
      ip: meta.ip,
      userAgent: meta.ua?.slice(0, 300) ?? null,
    },
  });
  return { token, expiresAt };
}

export async function writeSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", { ...cookieOptions(new Date(0)), maxAge: 0 });
}

/** Resolves the signed-in user for this request, or null. Deduplicated per request. */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== "ACTIVE") return null;

  // Touch at most every 5 minutes to avoid a write per request.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }

  const { user, ...bare } = session;
  const privileged = isPrivileged(user.roles);
  return {
    session: bare,
    user,
    mfaPending: privileged && !bare.mfaVerifiedAt,
    mfaEnrolmentNeeded: privileged && !user.totpEnabledAt,
  };
});

export async function revokeCurrentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({
      where: { tokenHash: sha256Hex(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  await clearSessionCookie();
}
