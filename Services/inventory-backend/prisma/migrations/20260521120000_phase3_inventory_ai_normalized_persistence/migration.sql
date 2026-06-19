-- CreateTable
CREATE TABLE "asset_spec_snapshots" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "normalizedSpecs" JSONB NOT NULL DEFAULT '{}',
    "lookupMode" TEXT NOT NULL DEFAULT 'unknown',
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "confidence" DOUBLE PRECISION,
    "evidenceStatus" TEXT NOT NULL DEFAULT 'insufficient_source_evidence',
    "evidenceReason" TEXT,
    "provider" TEXT,
    "ruleVersion" TEXT,
    "variant" TEXT,
    "snapshotHash" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_spec_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_spec_evidence" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "provider" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceDomain" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "extractedFields" JSONB,
    "sourceConfidence" DOUBLE PRECISION,
    "isTrusted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_spec_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_telemetry_samples" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "telemetrySource" TEXT NOT NULL,
    "rawSignals" JSONB NOT NULL DEFAULT '{}',
    "derivedStatus" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "activeHours" DOUBLE PRECISION,
    "idleHours" DOUBLE PRECISION,
    "offlineHours" DOUBLE PRECISION,
    "utilization" JSONB,
    "consumptionScore" DOUBLE PRECISION,
    "qualityImpactScore" DOUBLE PRECISION,
    "sampleHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_telemetry_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_lifespan_predictions" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "predictedLifespanYears" DOUBLE PRECISION NOT NULL,
    "predictedEolDate" TIMESTAMP(3),
    "monthsRemaining" DOUBLE PRECISION,
    "failureRisk" DOUBLE PRECISION,
    "qualityTier" TEXT,
    "confidence" DOUBLE PRECISION,
    "evidenceLevel" TEXT,
    "modelVersion" TEXT,
    "predictionSource" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "reason" TEXT,
    "explanation" TEXT,
    "workingHours" DOUBLE PRECISION,
    "operationalState" TEXT,
    "telemetryStatus" TEXT,
    "specEvidenceStatus" TEXT,
    "isDisplayOnly" BOOLEAN NOT NULL DEFAULT false,
    "previousPredictionId" TEXT,
    "deltaLifespanYears" DOUBLE PRECISION,
    "deltaMonthsRemaining" DOUBLE PRECISION,
    "generatedBy" TEXT,
    "provider" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_lifespan_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_eol_assessments" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "predictedEolDate" TIMESTAMP(3),
    "monthsRemaining" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceLevel" TEXT NOT NULL,
    "predictionSource" TEXT NOT NULL,
    "telemetryStatus" TEXT NOT NULL,
    "specEvidenceStatus" TEXT NOT NULL,
    "suitableForProcurementPlanning" BOOLEAN NOT NULL DEFAULT false,
    "procurementRecommended" BOOLEAN NOT NULL DEFAULT false,
    "procurementWindowMonths" INTEGER,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_eol_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_procurement_candidates" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "eolAssessmentId" TEXT,
    "candidateStatus" TEXT NOT NULL DEFAULT 'open',
    "predictedEolDate" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "procurementWindowMonths" INTEGER,
    "recommendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "dismissedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_procurement_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_spec_snapshots_assetId_createdAt_idx" ON "asset_spec_snapshots"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "asset_spec_snapshots_verificationStatus_idx" ON "asset_spec_snapshots"("verificationStatus");

-- CreateIndex
CREATE INDEX "asset_spec_snapshots_evidenceStatus_idx" ON "asset_spec_snapshots"("evidenceStatus");

-- CreateIndex
CREATE INDEX "asset_spec_snapshots_snapshotHash_idx" ON "asset_spec_snapshots"("snapshotHash");

-- CreateIndex
CREATE INDEX "asset_spec_evidence_assetId_createdAt_idx" ON "asset_spec_evidence"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "asset_spec_evidence_sourceDomain_idx" ON "asset_spec_evidence"("sourceDomain");

-- CreateIndex
CREATE INDEX "asset_spec_evidence_fetchedAt_idx" ON "asset_spec_evidence"("fetchedAt");

-- CreateIndex
CREATE INDEX "asset_spec_evidence_contentHash_idx" ON "asset_spec_evidence"("contentHash");

-- CreateIndex
CREATE INDEX "asset_telemetry_samples_assetId_observedAt_idx" ON "asset_telemetry_samples"("assetId", "observedAt");

-- CreateIndex
CREATE INDEX "asset_telemetry_samples_derivedStatus_observedAt_idx" ON "asset_telemetry_samples"("derivedStatus", "observedAt");

-- CreateIndex
CREATE INDEX "asset_telemetry_samples_telemetrySource_observedAt_idx" ON "asset_telemetry_samples"("telemetrySource", "observedAt");

-- CreateIndex
CREATE INDEX "asset_telemetry_samples_sampleHash_idx" ON "asset_telemetry_samples"("sampleHash");

-- CreateIndex
CREATE INDEX "asset_lifespan_predictions_assetId_createdAt_idx" ON "asset_lifespan_predictions"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "asset_lifespan_predictions_trigger_createdAt_idx" ON "asset_lifespan_predictions"("trigger", "createdAt");

-- CreateIndex
CREATE INDEX "asset_lifespan_predictions_isDisplayOnly_createdAt_idx" ON "asset_lifespan_predictions"("isDisplayOnly", "createdAt");

-- CreateIndex
CREATE INDEX "asset_lifespan_predictions_requestId_idx" ON "asset_lifespan_predictions"("requestId");

-- CreateIndex
CREATE INDEX "asset_eol_assessments_assetId_generatedAt_idx" ON "asset_eol_assessments"("assetId", "generatedAt");

-- CreateIndex
CREATE INDEX "asset_eol_assessments_status_confidence_idx" ON "asset_eol_assessments"("status", "confidence");

-- CreateIndex
CREATE INDEX "asset_eol_assessments_procurementRecommended_procurementWindowMonths_idx" ON "asset_eol_assessments"("procurementRecommended", "procurementWindowMonths");

-- CreateIndex
CREATE INDEX "asset_procurement_candidates_assetId_candidateStatus_idx" ON "asset_procurement_candidates"("assetId", "candidateStatus");

-- CreateIndex
CREATE INDEX "asset_procurement_candidates_candidateStatus_recommendedAt_idx" ON "asset_procurement_candidates"("candidateStatus", "recommendedAt");

-- AddForeignKey
ALTER TABLE "asset_spec_snapshots" ADD CONSTRAINT "asset_spec_snapshots_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_spec_evidence" ADD CONSTRAINT "asset_spec_evidence_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "asset_spec_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_spec_evidence" ADD CONSTRAINT "asset_spec_evidence_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_telemetry_samples" ADD CONSTRAINT "asset_telemetry_samples_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_lifespan_predictions" ADD CONSTRAINT "asset_lifespan_predictions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_lifespan_predictions" ADD CONSTRAINT "asset_lifespan_predictions_previousPredictionId_fkey" FOREIGN KEY ("previousPredictionId") REFERENCES "asset_lifespan_predictions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_eol_assessments" ADD CONSTRAINT "asset_eol_assessments_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_procurement_candidates" ADD CONSTRAINT "asset_procurement_candidates_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_procurement_candidates" ADD CONSTRAINT "asset_procurement_candidates_eolAssessmentId_fkey" FOREIGN KEY ("eolAssessmentId") REFERENCES "asset_eol_assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

