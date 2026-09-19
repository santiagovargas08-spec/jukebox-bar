CREATE TABLE "AdminAuditLog" (
  "id" SERIAL NOT NULL,
  "requestId" TEXT,
  "actorId" INTEGER,
  "actorEmail" TEXT,
  "actorRole" TEXT,
  "action" TEXT NOT NULL,
  "barId" INTEGER,
  "entityType" TEXT,
  "entityId" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditLog_createdAt_idx"
ON "AdminAuditLog"("createdAt");

CREATE INDEX "AdminAuditLog_barId_createdAt_idx"
ON "AdminAuditLog"("barId", "createdAt");

CREATE INDEX "AdminAuditLog_actorEmail_createdAt_idx"
ON "AdminAuditLog"("actorEmail", "createdAt");

CREATE INDEX "AdminAuditLog_action_createdAt_idx"
ON "AdminAuditLog"("action", "createdAt");

CREATE INDEX "AdminAuditLog_requestId_idx"
ON "AdminAuditLog"("requestId");

CREATE INDEX "AdminAuditLog_entityType_entityId_idx"
ON "AdminAuditLog"("entityType", "entityId");
