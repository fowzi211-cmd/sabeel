import { z } from "zod";
import { Prisma, type Role, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { normalizeSaudiMobile } from "@/lib/validate";

type Actor = { id: string; roles: Role[] };

export const STAFF_ROLES: Role[] = ["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE", "SUPER_ADMIN"];

/** Never expose anything that could leak a secret; the TOTP secret stays server-side. */
export function publicUser(u: User) {
  return {
    id: u.id,
    mobile: u.mobile,
    name: u.name,
    email: u.email,
    language: u.language,
    roles: u.roles,
    totpEnabled: !!u.totpEnabledAt,
    trustTier: u.trustTier,
  };
}

/** First successful code = account creation. New accounts are buyers; roles are granted elsewhere. */
export async function loginOrRegister(mobile: string, meta: RequestMeta, lang: "AR" | "EN") {
  const existing = await db.user.findUnique({ where: { mobile } });
  if (existing) {
    if (existing.status !== "ACTIVE") throw new AppError("ACCOUNT_BLOCKED");
    const user = await db.user.update({
      where: { id: existing.id },
      data: { lastLoginAt: new Date(), mobileVerifiedAt: existing.mobileVerifiedAt ?? new Date() },
    });
    return { user, isNew: false };
  }
  const user = await db.user.create({
    data: { mobile, language: lang, mobileVerifiedAt: new Date(), lastLoginAt: new Date() },
  });
  await audit({ actor: { id: user.id, roles: user.roles }, action: "user.registered", entity: "User", entityId: user.id, meta });
  return { user, isNew: true };
}

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(120).optional().or(z.literal("")),
  language: z.enum(["AR", "EN"]).optional(),
});

export async function updateProfile(user: User, patch: z.infer<typeof profileSchema>, meta: RequestMeta) {
  const data: Prisma.UserUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.email !== undefined) data.email = patch.email || null;
  if (patch.language !== undefined) data.language = patch.language;
  const updated = await db.user.update({ where: { id: user.id }, data });
  await audit({ actor: user, action: "user.profile_updated", entity: "User", entityId: user.id, after: Object.keys(data), meta });
  return updated;
}

// ───────────── staff management (super-admin only; enforced by the routes) ─────────────
export const staffSchema = z.object({
  mobile: z.string().trim().min(1),
  name: z.string().trim().min(2).max(80),
  roles: z.array(z.enum(["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE", "SUPER_ADMIN"])).min(1),
});

export async function createStaffUser(admin: Actor, input: z.infer<typeof staffSchema>, meta: RequestMeta) {
  const mobile = normalizeSaudiMobile(input.mobile);
  if (!mobile) throw new AppError("MOBILE_INVALID", { field: "mobile" });
  const existing = await db.user.findUnique({ where: { mobile } });
  const roles = Array.from(new Set<Role>(["BUYER", ...(existing?.roles ?? []), ...input.roles]));
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data: { roles, name: existing.name ?? input.name } })
    : await db.user.create({ data: { mobile, name: input.name, roles } });
  await audit({ actor: admin, action: "user.staff_granted", entity: "User", entityId: user.id, before: existing?.roles, after: roles, meta });
  return user;
}

export async function setStaffRoles(admin: Actor, userId: string, roles: Role[], meta: RequestMeta) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("NOT_FOUND");
  const nonStaff = user.roles.filter((r) => !STAFF_ROLES.includes(r));
  const next = Array.from(new Set<Role>([...nonStaff, ...roles.filter((r) => STAFF_ROLES.includes(r))]));

  if (user.roles.includes("SUPER_ADMIN") && !next.includes("SUPER_ADMIN")) {
    const others = await db.user.count({ where: { roles: { has: "SUPER_ADMIN" }, id: { not: userId }, status: "ACTIVE" } });
    if (others === 0) throw new AppError("CONFLICT", { message: "There must always be at least one super-admin" });
  }
  const updated = await db.user.update({ where: { id: userId }, data: { roles: next } });
  // Roles changed: existing sessions must not keep stale privileges.
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ actor: admin, action: "user.roles_changed", entity: "User", entityId: userId, before: user.roles, after: next, meta });
  return updated;
}

export async function resetUserTotp(admin: Actor, userId: string, meta: RequestMeta) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("NOT_FOUND");
  await db.user.update({ where: { id: userId }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null } });
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ actor: admin, action: "user.totp_reset", entity: "User", entityId: userId, meta });
}

export function listUsers(q?: string) {
  const digits = q?.replace(/[^\d+]/g, "");
  return db.user.findMany({
    where: q
      ? { OR: [{ mobile: { contains: digits || q } }, { name: { contains: q, mode: "insensitive" } }] }
      : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, mobile: true, name: true, roles: true, status: true, totpEnabledAt: true, createdAt: true, lastLoginAt: true },
  });
}
