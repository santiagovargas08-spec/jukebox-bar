-- Migración incremental para bases creadas con prisma db push antes de Prisma Migrate.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'BAR_ADMIN', 'DJ', 'OPERATOR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PlaybackStatus" AS ENUM ('IDLE', 'PLAYING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "reference" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdminUser" (
    "id" SERIAL NOT NULL,
    "barId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "role" "AdminRole" NOT NULL DEFAULT 'OPERATOR',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlaybackState" (
    "id" SERIAL NOT NULL,
    "barId" INTEGER NOT NULL,
    "queueItemId" INTEGER,
    "videoId" TEXT,
    "title" TEXT,
    "name" TEXT,
    "thumbnail" TEXT,
    "startedAt" TIMESTAMP(3),
    "status" "PlaybackStatus" NOT NULL DEFAULT 'IDLE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybackState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminUser_barId_active_idx" ON "AdminUser"("barId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_barId_email_key" ON "AdminUser"("barId", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "PlaybackState_barId_key" ON "PlaybackState"("barId");
CREATE INDEX IF NOT EXISTS "Payment_reference_idx" ON "Payment"("reference");

-- CreateIndex (puede existir en bases nuevas)
DO $$ BEGIN
  CREATE UNIQUE INDEX "QueueItem_barId_videoId_key" ON "QueueItem"("barId", "videoId");
EXCEPTION
  WHEN duplicate_table THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_barId_fkey" FOREIGN KEY ("barId") REFERENCES "Bar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PlaybackState" ADD CONSTRAINT "PlaybackState_barId_fkey" FOREIGN KEY ("barId") REFERENCES "Bar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
