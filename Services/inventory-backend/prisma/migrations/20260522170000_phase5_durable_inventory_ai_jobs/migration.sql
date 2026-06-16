-- CreateTable
CREATE TABLE "inventory_ai_jobs" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "parentJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_ai_jobs_idempotencyKey_key" ON "inventory_ai_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "inventory_ai_jobs_assetId_createdAt_idx" ON "inventory_ai_jobs"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_ai_jobs_jobType_status_scheduledAt_idx" ON "inventory_ai_jobs"("jobType", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "inventory_ai_jobs_status_scheduledAt_idx" ON "inventory_ai_jobs"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "inventory_ai_jobs" ADD CONSTRAINT "inventory_ai_jobs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ai_jobs" ADD CONSTRAINT "inventory_ai_jobs_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "inventory_ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
