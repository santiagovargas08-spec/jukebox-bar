-- Add the central administrator entity without changing existing bar data.
CREATE TABLE "MasterAdmin" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterAdmin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MasterAdmin_email_key" ON "MasterAdmin"("email");
CREATE INDEX "MasterAdmin_active_idx" ON "MasterAdmin"("active");
