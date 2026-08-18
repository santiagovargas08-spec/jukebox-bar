-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'BAR_ADMIN', 'DJ', 'OPERATOR');

-- CreateEnum
CREATE TYPE "PlaybackStatus" AS ENUM ('IDLE', 'PLAYING');

-- CreateTable
CREATE TABLE "Bar" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" SERIAL NOT NULL,
    "barId" INTEGER NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'TRIAL',
    "plan" "PlanType",
    "trialStartedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarSettings" (
    "id" SERIAL NOT NULL,
    "barId" INTEGER NOT NULL,
    "displayName" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "welcomeMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BarSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "barId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
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
CREATE TABLE "QueueItem" (
    "id" SERIAL NOT NULL,
    "barId" INTEGER NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thumbnail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SongHistory" (
    "id" SERIAL NOT NULL,
    "barId" INTEGER NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thumbnail" TEXT,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SongHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "barId" INTEGER NOT NULL,
    "licenseId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "plan" "PlanType" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "createdBy" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybackState" (
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
CREATE UNIQUE INDEX "Bar_slug_key" ON "Bar"("slug");

-- CreateIndex
CREATE INDEX "Bar_active_idx" ON "Bar"("active");

-- CreateIndex
CREATE UNIQUE INDEX "License_barId_key" ON "License"("barId");

-- CreateIndex
CREATE INDEX "License_status_idx" ON "License"("status");

-- CreateIndex
CREATE INDEX "License_expiresAt_idx" ON "License"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BarSettings_barId_key" ON "BarSettings"("barId");

-- CreateIndex
CREATE INDEX "User_barId_idx" ON "User"("barId");

-- CreateIndex
CREATE INDEX "AdminUser_barId_active_idx" ON "AdminUser"("barId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_barId_email_key" ON "AdminUser"("barId", "email");

-- CreateIndex
CREATE INDEX "QueueItem_barId_idx" ON "QueueItem"("barId");

-- CreateIndex
CREATE INDEX "QueueItem_videoId_idx" ON "QueueItem"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "QueueItem_barId_videoId_key" ON "QueueItem"("barId", "videoId");

-- CreateIndex
CREATE INDEX "SongHistory_barId_idx" ON "SongHistory"("barId");

-- CreateIndex
CREATE INDEX "SongHistory_playedAt_idx" ON "SongHistory"("playedAt");

-- CreateIndex
CREATE INDEX "Payment_barId_idx" ON "Payment"("barId");

-- CreateIndex
CREATE INDEX "Payment_licenseId_idx" ON "Payment"("licenseId");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- CreateIndex
CREATE INDEX "Payment_reference_idx" ON "Payment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackState_barId_key" ON "PlaybackState"("barId");

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_barId_fkey" FOREIGN KEY ("barId") REFERENCES "Bar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarSettings" ADD CONSTRAINT "BarSettings_barId_fkey" FOREIGN KEY ("barId") REFERENCES "Bar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_barId_fkey" FOREIGN KEY ("barId") REFERENCES "Bar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_barId_fkey" FOREIGN KEY ("barId") REFERENCES "Bar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_barId_fkey" FOREIGN KEY ("barId") REFERENCES "Bar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongHistory" ADD CONSTRAINT "SongHistory_barId_fkey" FOREIGN KEY ("barId") REFERENCES "Bar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_barId_fkey" FOREIGN KEY ("barId") REFERENCES "Bar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackState" ADD CONSTRAINT "PlaybackState_barId_fkey" FOREIGN KEY ("barId") REFERENCES "Bar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
