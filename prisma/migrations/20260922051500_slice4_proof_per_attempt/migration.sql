-- A delivery can now have more than one successful attempt over its life (e.g. a REDELIVER dispute
-- outcome): ProofOfDelivery moves from one-per-delivery to one-per-(delivery, attempt). No existing
-- row loses data — every current row simply gets a companion unique index instead of a solo one.
DROP INDEX IF EXISTS "ProofOfDelivery_deliveryId_key";
CREATE UNIQUE INDEX "ProofOfDelivery_deliveryId_attempt_key" ON "ProofOfDelivery" ("deliveryId", "attempt");
