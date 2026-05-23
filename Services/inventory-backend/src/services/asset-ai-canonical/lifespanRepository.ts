import { prisma } from '../../lib/prisma';

export type PersistLifespanPredictionInput = {
  assetId: string;
  predictedLifespanYears: number;
  failureRisk?: number | null;
  qualityTier?: string | null;
  modelVersion?: string | null;
  predictionSource: string;
  trigger: string;
  reason?: string | null;
  explanation?: string | null;
  workingHours?: number | null;
  operationalState?: string | null;
  telemetryStatus?: string | null;
  specEvidenceStatus?: string | null;
  startDate?: Date | null;
  confidence?: number | null;
  evidenceLevel?: string | null;
  requestId?: string | null;
  provider?: string | null;
  generatedBy?: string | null;
};

function clampConfidence(rawValue: unknown): number | null {
  const confidence = Number(rawValue);
  if (!Number.isFinite(confidence)) return null;
  return Math.min(1, Math.max(0, confidence));
}

function computePredictedEolDate(startDate: Date | null | undefined, lifespanYears: number): Date | null {
  if (!startDate || Number.isNaN(startDate.getTime())) return null;
  if (!Number.isFinite(lifespanYears) || lifespanYears <= 0) return null;
  const result = new Date(startDate);
  result.setDate(result.getDate() + Math.round(lifespanYears * 365.25));
  return Number.isNaN(result.getTime()) ? null : result;
}

function monthsRemaining(from: Date, to: Date | null): number | null {
  if (!to) return null;
  const months = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
  return Number.isFinite(months) ? Number(months.toFixed(1)) : null;
}

export async function getLatestPersistedLifespanPrediction(assetId: string) {
  return prisma.assetLifespanPrediction.findFirst({
    where: {
      assetId,
      isDisplayOnly: false,
    },
    orderBy: [{ createdAt: 'desc' }],
  });
}

export async function persistLifespanPrediction(input: PersistLifespanPredictionInput) {
  const previous = await getLatestPersistedLifespanPrediction(input.assetId);
  const predictedEolDate = computePredictedEolDate(input.startDate, input.predictedLifespanYears);
  const remainingMonths = monthsRemaining(new Date(), predictedEolDate);
  const deltaYears = previous ? Number((input.predictedLifespanYears - Number(previous.predictedLifespanYears || 0)).toFixed(3)) : null;
  const deltaMonths = previous && remainingMonths !== null && previous.monthsRemaining !== null
    ? Number((remainingMonths - Number(previous.monthsRemaining)).toFixed(3))
    : null;

  return prisma.assetLifespanPrediction.create({
    data: {
      assetId: input.assetId,
      predictedLifespanYears: input.predictedLifespanYears,
      predictedEolDate,
      monthsRemaining: remainingMonths,
      failureRisk: Number.isFinite(Number(input.failureRisk)) ? Number(input.failureRisk) : null,
      qualityTier: input.qualityTier ? String(input.qualityTier) : null,
      confidence: clampConfidence(input.confidence),
      evidenceLevel: input.evidenceLevel ? String(input.evidenceLevel) : null,
      modelVersion: input.modelVersion ? String(input.modelVersion) : null,
      predictionSource: String(input.predictionSource || 'unknown'),
      trigger: String(input.trigger || 'manual_recalculation'),
      reason: input.reason ? String(input.reason) : null,
      explanation: input.explanation ? String(input.explanation) : null,
      workingHours: Number.isFinite(Number(input.workingHours)) ? Number(input.workingHours) : null,
      operationalState: input.operationalState ? String(input.operationalState) : null,
      telemetryStatus: input.telemetryStatus ? String(input.telemetryStatus) : null,
      specEvidenceStatus: input.specEvidenceStatus ? String(input.specEvidenceStatus) : null,
      isDisplayOnly: false,
      previousPredictionId: previous?.id || null,
      deltaLifespanYears: deltaYears,
      deltaMonthsRemaining: deltaMonths,
      generatedBy: input.generatedBy ? String(input.generatedBy) : 'inventory-backend',
      provider: input.provider ? String(input.provider) : 'inventory-ai-service',
      requestId: input.requestId ? String(input.requestId) : null,
    },
  });
}

