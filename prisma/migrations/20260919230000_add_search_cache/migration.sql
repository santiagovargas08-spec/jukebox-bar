CREATE TABLE "SearchCache" (
  "queryKey" VARCHAR(160) NOT NULL,
  "query" VARCHAR(160) NOT NULL,
  "results" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SearchCache_pkey" PRIMARY KEY ("queryKey")
);

CREATE INDEX "SearchCache_expiresAt_idx"
ON "SearchCache"("expiresAt");

CREATE INDEX "SearchCache_updatedAt_idx"
ON "SearchCache"("updatedAt");
