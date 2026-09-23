import type { Prisma, Role } from "@prisma/client";
import { db } from "./db";

export interface RequestMeta {
  ip: string | null;
  ua: string | null;
}

export interface AuditEntry {
  actor?: { id: string; roles: Role[] } | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
  meta?: RequestMeta | null;
}

const json = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/** Append-only (a database trigger forbids UPDATE and DELETE). Never put secrets in before/after. */
export async function audit(e: AuditEntry, tx: Prisma.TransactionClient | typeof db = db): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: e.actor?.id ?? null,
      actorRole: e.actor?.roles.join(",") ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      before: json(e.before),
      after: json(e.after),
      note: e.note ?? null,
      ip: e.meta?.ip ?? null,
      userAgent: e.meta?.ua?.slice(0, 300) ?? null,
    },
  });
}
