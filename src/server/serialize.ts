import type { Supplier } from "@prisma/client";

/** Fields that must never leave the server (encrypted national ID). */
export function safeSupplier<T extends Supplier>(s: T): Omit<T, "idNumberEnc"> {
  const { idNumberEnc: _omit, ...rest } = s;
  void _omit;
  return rest;
}

/** Storage keys are internal; clients download through the authorised /api/v1/files/[id] route. */
export function safeDocument<T extends { fileKey: string }>(d: T): Omit<T, "fileKey"> {
  const { fileKey: _omit, ...rest } = d;
  void _omit;
  return rest;
}
