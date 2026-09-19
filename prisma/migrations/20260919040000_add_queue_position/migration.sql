-- Preserve QueueItem.createdAt as historical metadata.
-- Queue ordering now uses an explicit integer position per bar.
ALTER TABLE "QueueItem"
ADD COLUMN "position" INTEGER;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "barId"
      ORDER BY "createdAt" ASC, "id" ASC
    )::INTEGER AS "position"
  FROM "QueueItem"
)
UPDATE "QueueItem" AS q
SET "position" = ranked."position"
FROM ranked
WHERE q."id" = ranked."id";

ALTER TABLE "QueueItem"
ALTER COLUMN "position" SET NOT NULL;

CREATE INDEX "QueueItem_barId_position_idx"
ON "QueueItem"("barId", "position");

CREATE INDEX "SongHistory_barId_playedAt_idx"
ON "SongHistory"("barId", "playedAt");

CREATE INDEX "Payment_barId_paidAt_idx"
ON "Payment"("barId", "paidAt");
