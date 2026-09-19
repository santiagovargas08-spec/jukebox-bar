-- Optional idempotency key for subscription activation requests.
ALTER TABLE "Payment"
ADD COLUMN "idempotencyKey" VARCHAR(128);

CREATE UNIQUE INDEX "Payment_barId_idempotencyKey_key"
ON "Payment"("barId", "idempotencyKey");
