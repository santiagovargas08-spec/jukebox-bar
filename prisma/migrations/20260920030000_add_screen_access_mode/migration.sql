ALTER TABLE "BarSettings"
ADD COLUMN "screenAuthRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "screenAccessKey" VARCHAR(64);
