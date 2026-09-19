-- Optional idempotency key for subscription activation requests.
ALTER TABLE "Payment"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Payment_barId_idempotencyKey_key"
ON "Payment"("barId", "idempotencyKey");

CREATE INDEX "Payment_idempotencyKey_idx"
ON "Payment"("idempotencyKey");
