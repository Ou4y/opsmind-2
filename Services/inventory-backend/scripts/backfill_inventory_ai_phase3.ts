import { prisma } from '../src/lib/prisma';
import { sha256 } from '../src/services/asset-ai-canonical/hash';

declare const process: {
  argv: string[];
  exitCode?: number;
};

type Counts = {
  assetsScanned: number;
  specSnapshotsCreated: number;
  telemetrySamplesCreated: number;
  lifespanPredictionsCreated: number;
  skippedExisting: number;
  skippedVerifiedProtection: number;
  errors: number;
};

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const values = raw
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function normalizeSpecs(specs: Record<string, any>): Record<string, any> {
  const corrected = specs.specVerificationCorrections;
  const aiDetected = specs.aiDetectedSpecs;
  if (corrected && typeof corrected === 'object' && Object.keys(corrected).length > 0) return corrected;
  if (aiDetected && typeof aiDetected === 'object' && Object.keys(aiDetected).length > 0) return aiDetected;
  return specs;
}

function verificationStatus(raw: unknown): string {
  const normalized = String(raw || '').trim().toLowerCase();
  if (['verified', 'corrected', 'rejected', 'pending', 'needs_review'].includes(normalized)) return normalized;
  return 'pending';
}

function evidenceStatus(raw: unknown): string {
  const normalized = String(raw || '').trim().toLowerCase();
  if (['trusted', 'insufficient_source_evidence', 'llm_or_heuristic_only'].includes(normalized)) return normalized;
  return 'insufficient_source_evidence';
}

function parseOptionalDate(raw: unknown): Date | null {
  if (!raw) return null;
  const parsed = new Date(String(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function backfillAsset(asset: { customId: string; specifications: any; createdAt: Date }, dryRun: boolean, counts: Counts) {
  const specs = (asset.specifications as Record<string, any>) || {};

  const normalized = normalizeSpecs(specs);
  const sourceUrls = asStringArray(specs.aiSpecSourceUrls).sort();
  const snapshotHash = sha256({
    normalizedSpecs: normalized,
    lookupMode: specs.aiSpecLookupMode || 'unknown',
    verificationStatus: verificationStatus(specs.specVerificationStatus),
    evidenceStatus: evidenceStatus(specs.aiSpecEvidenceStatus),
    sourceUrlsHash: sha256(sourceUrls),
    context: 'legacy_backfill',
  });

  const latestSnapshot = await prisma.assetSpecSnapshot.findFirst({
    where: { assetId: asset.customId },
    orderBy: { createdAt: 'desc' },
  });

  if (latestSnapshot?.snapshotHash === snapshotHash) {
    counts.skippedExisting += 1;
  } else if (
    latestSnapshot &&
    ['verified', 'corrected'].includes(String(latestSnapshot.verificationStatus || '').toLowerCase()) &&
    !['verified', 'corrected'].includes(verificationStatus(specs.specVerificationStatus))
  ) {
    counts.skippedVerifiedProtection += 1;
  } else {
    if (!dryRun) {
      const createdSnapshot = await prisma.assetSpecSnapshot.create({
        data: {
          assetId: asset.customId,
          normalizedSpecs: normalized,
          lookupMode: String(specs.aiSpecLookupMode || 'legacy'),
          verificationStatus: verificationStatus(specs.specVerificationStatus),
          confidence: Number.isFinite(Number(specs.aiSpecConfidence)) ? Number(specs.aiSpecConfidence) : null,
          evidenceStatus: evidenceStatus(specs.aiSpecEvidenceStatus),
          evidenceReason: specs.aiSpecEvidenceReason ? String(specs.aiSpecEvidenceReason) : 'Backfilled from legacy asset specifications JSON.',
          provider: specs.aiSpecSource ? String(specs.aiSpecSource) : 'legacy-json',
          ruleVersion: specs.aiSpecRuleVersion ? String(specs.aiSpecRuleVersion) : null,
          variant: specs.aiSpecVariant ? String(specs.aiSpecVariant) : null,
          snapshotHash,
          reviewedBy: specs.specVerificationReviewedBy ? String(specs.specVerificationReviewedBy) : null,
          reviewedAt: parseOptionalDate(specs.specVerificationReviewedAt),
        },
      });

      if (sourceUrls.length > 0) {
        await prisma.assetSpecEvidence.createMany({
          data: sourceUrls.map((url) => ({
            snapshotId: createdSnapshot.id,
            assetId: asset.customId,
            provider: specs.aiSpecSource ? String(specs.aiSpecSource) : 'legacy-json',
            sourceUrl: url,
            sourceDomain: (() => {
              try {
                return new URL(url).hostname.toLowerCase();
              } catch {
                return null;
              }
            })(),
            fetchedAt: parseOptionalDate(specs.aiSpecDetectedAt),
            contentHash: sha256({ url, normalized }),
            extractedFields: specs.aiSpecFieldConfidence && typeof specs.aiSpecFieldConfidence === 'object'
              ? specs.aiSpecFieldConfidence
              : {},
            sourceConfidence: Number.isFinite(Number(specs.aiSpecConfidence)) ? Number(specs.aiSpecConfidence) : null,
            isTrusted: evidenceStatus(specs.aiSpecEvidenceStatus) === 'trusted',
          })),
          skipDuplicates: false,
        });
      }
    }
    counts.specSnapshotsCreated += 1;
  }

  const telemetryTimestamp = parseOptionalDate(specs.lastTelemetryAt || specs.operationalStateUpdatedAt);
  if (telemetryTimestamp) {
    const derivedStatus = String(specs.operationalState || 'unknown');
    const sampleHash = sha256({
      assetId: asset.customId,
      observedAt: telemetryTimestamp.toISOString(),
      telemetrySource: 'legacy-json-backfill',
      derivedStatus,
      workingHours: Number(specs.workingHours || 0),
    });
    const existingSample = await prisma.assetTelemetrySample.findFirst({
      where: { assetId: asset.customId, sampleHash },
      orderBy: { createdAt: 'desc' },
    });

    if (existingSample) {
      counts.skippedExisting += 1;
    } else {
      if (!dryRun) {
        await prisma.assetTelemetrySample.create({
          data: {
            assetId: asset.customId,
            observedAt: telemetryTimestamp,
            telemetrySource: 'legacy-json-backfill',
            rawSignals: {
              workingHours: Number(specs.workingHours || 0),
              workingHoursSource: specs.workingHoursSource || null,
              trackWorkingHours: specs.trackWorkingHours === true || String(specs.trackWorkingHours || '').toLowerCase() === 'true',
            },
            derivedStatus,
            confidence: ['online_in_use', 'online_idle', 'offline'].includes(derivedStatus) ? 0.75 : 0.35,
            reason: 'Backfilled from legacy specifications JSON telemetry fields.',
            activeHours: derivedStatus === 'online_in_use' ? Number(specs.workingHours || 0) : null,
            idleHours: derivedStatus === 'online_idle' ? Number(specs.workingHours || 0) : null,
            offlineHours: derivedStatus === 'offline' ? Number(specs.workingHours || 0) : null,
            sampleHash,
          },
        });
      }
      counts.telemetrySamplesCreated += 1;
    }
  }

  const lifecyclePrediction = specs.lifecyclePrediction && typeof specs.lifecyclePrediction === 'object'
    ? specs.lifecyclePrediction
    : null;
  if (lifecyclePrediction && Number.isFinite(Number(lifecyclePrediction.predictedLifespanYears))) {
    const modelVersion = String(lifecyclePrediction.modelVersion || '');
    const predictedYears = Number(lifecyclePrediction.predictedLifespanYears);
    const latestPrediction = await prisma.assetLifespanPrediction.findFirst({
      where: { assetId: asset.customId, isDisplayOnly: false },
      orderBy: { createdAt: 'desc' },
    });
    const isSamePrediction = latestPrediction
      && Number(latestPrediction.predictedLifespanYears) === predictedYears
      && String(latestPrediction.modelVersion || '') === modelVersion
      && String(latestPrediction.reason || '') === String(lifecyclePrediction.reason || '');

    if (isSamePrediction) {
      counts.skippedExisting += 1;
    } else {
      if (!dryRun) {
        await prisma.assetLifespanPrediction.create({
          data: {
            assetId: asset.customId,
            predictedLifespanYears: predictedYears,
            failureRisk: Number.isFinite(Number(lifecyclePrediction.failureRisk)) ? Number(lifecyclePrediction.failureRisk) : null,
            qualityTier: lifecyclePrediction.qualityTier ? String(lifecyclePrediction.qualityTier) : null,
            modelVersion: modelVersion || null,
            predictionSource: modelVersion.toLowerCase().includes('fallback') ? 'fallback_category_default' : 'legacy_persisted_snapshot',
            trigger: 'legacy_backfill',
            reason: lifecyclePrediction.reason ? String(lifecyclePrediction.reason) : 'legacy_backfill',
            explanation: lifecyclePrediction.explanation ? String(lifecyclePrediction.explanation) : null,
            workingHours: Number.isFinite(Number(lifecyclePrediction.workingHours)) ? Number(lifecyclePrediction.workingHours) : null,
            operationalState: lifecyclePrediction.operationalState ? String(lifecyclePrediction.operationalState) : null,
            telemetryStatus: specs.operationalState ? String(specs.operationalState) : null,
            specEvidenceStatus: evidenceStatus(specs.aiSpecEvidenceStatus),
            isDisplayOnly: false,
            previousPredictionId: latestPrediction?.id || null,
            generatedBy: 'inventory-backend-backfill',
            provider: 'legacy-json',
          },
        });
      }
      counts.lifespanPredictionsCreated += 1;
    }
  }
}

async function main() {
  const args = new Set<string>(process.argv.slice(2));
  const dryRun = !args.has('--write');
  const limitArg = process.argv.find((arg: string) => arg.startsWith('--limit='));
  const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1])) : 1000;

  const counts: Counts = {
    assetsScanned: 0,
    specSnapshotsCreated: 0,
    telemetrySamplesCreated: 0,
    lifespanPredictionsCreated: 0,
    skippedExisting: 0,
    skippedVerifiedProtection: 0,
    errors: 0,
  };

  console.log(`[Phase3Backfill] mode=${dryRun ? 'dry-run' : 'write'} limit=${limit}`);
  const assets = await prisma.asset.findMany({
    select: {
      customId: true,
      specifications: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  for (const asset of assets) {
    counts.assetsScanned += 1;
    try {
      await backfillAsset(asset, dryRun, counts);
    } catch (error: any) {
      counts.errors += 1;
      console.error(`[Phase3Backfill] asset=${asset.customId} failed: ${error.message}`);
    }
  }

  console.log('[Phase3Backfill] summary');
  console.log(JSON.stringify(counts, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(`[Phase3Backfill] fatal: ${error?.message || error}`);
  process.exitCode = 1;
  await prisma.$disconnect();
});
